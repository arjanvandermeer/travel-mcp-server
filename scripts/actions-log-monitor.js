#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

const STATE_MARKER_RE = /<!--\s*actions-log-monitor:last_checked_at=([^\s]+)\s*-->/;
const STATE_ISSUE_TITLE = '[automation] GitHub Actions log monitor';
const STATE_LABEL = 'automation:actions-log-monitor';
const REPORT_LABEL = 'ci-failure';
const DEFAULT_LOOKBACK_HOURS = 24;

export function parseCheckpoint(body = '') {
  const match = body.match(STATE_MARKER_RE);
  if (!match) return null;

  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function fallbackCheckpoint(now = new Date(), lookbackHours = DEFAULT_LOOKBACK_HOURS) {
  return new Date(now.getTime() - lookbackHours * 60 * 60 * 1000).toISOString();
}

export function filterNewRuns(runs, { since, monitorWorkflowName = '' } = {}) {
  const sinceTime = new Date(since).getTime();
  return runs
    .filter(run => new Date(run.updated_at || run.created_at).getTime() > sinceTime)
    .filter(run => run.name !== monitorWorkflowName)
    .sort((a, b) => new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at));
}

export function failedRuns(runs) {
  const failedConclusions = new Set(['action_required', 'cancelled', 'failure', 'startup_failure', 'timed_out']);
  return runs.filter(run => run.status === 'completed' && failedConclusions.has(run.conclusion));
}

export function buildStateIssueBody({ checkedAt, since, newRuns, failures }) {
  const lines = [
    `<!-- actions-log-monitor:last_checked_at=${checkedAt} -->`,
    '# GitHub Actions log monitor state',
    '',
    'This issue is used by the scheduled Actions monitor as durable state. Do not close it unless you want the monitor to recreate it and reset its checkpoint.',
    '',
    `Last checked: ${checkedAt}`,
    `Previous checkpoint: ${since}`,
    `New workflow runs seen: ${newRuns.length}`,
    `Failed workflow runs seen: ${failures.length}`,
  ];

  if (failures.length) {
    lines.push('', '## Latest failures');
    for (const run of failures.slice(0, 10)) {
      lines.push(`- ${run.name} #${run.run_number}: ${run.conclusion} on \`${run.head_branch}\` at ${run.html_url}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function buildFailureIssueBody({ checkedAt, failures, jobsByRun }) {
  const lines = [
    `Detected ${failures.length} failed GitHub Actions run${failures.length === 1 ? '' : 's'} at ${checkedAt}.`,
    '',
  ];

  for (const run of failures) {
    lines.push(`## ${run.name} #${run.run_number}`);
    lines.push(`- Conclusion: ${run.conclusion}`);
    lines.push(`- Branch: ${run.head_branch}`);
    lines.push(`- Commit: ${run.head_sha}`);
    lines.push(`- Run: ${run.html_url}`);

    const jobs = jobsByRun.get(run.id) || [];
    const failedJobs = jobs.filter(job => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped');
    if (failedJobs.length) {
      lines.push('- Failed jobs:');
      for (const job of failedJobs) {
        lines.push(`  - ${job.name}: ${job.conclusion} (${job.html_url})`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

class GitHubClient {
  constructor({ token, repository, fetchImpl = fetch }) {
    if (!token) throw new Error('GITHUB_TOKEN is required.');
    if (!repository || !repository.includes('/')) throw new Error('GITHUB_REPOSITORY must be owner/repo.');

    const [owner, repo] = repository.split('/');
    this.owner = owner;
    this.repo = repo;
    this.fetch = fetchImpl;
    this.baseUrl = 'https://api.github.com';
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'travel-actions-log-monitor',
    };
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...this.headers,
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API ${response.status} for ${path}: ${text}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  repoPath(path) {
    return `/repos/${this.owner}/${this.repo}${path}`;
  }

  async findStateIssue() {
    const data = await this.request(this.repoPath(`/issues?state=open&labels=${encodeURIComponent(STATE_LABEL)}&per_page=20`));
    return data.find(issue => issue.title === STATE_ISSUE_TITLE) || null;
  }

  async ensureLabel({ name, color, description }) {
    try {
      await this.request(this.repoPath(`/labels/${encodeURIComponent(name)}`));
    } catch {
      await this.request(this.repoPath('/labels'), {
        method: 'POST',
        body: JSON.stringify({
          name,
          color,
          description,
        }),
      });
    }
  }

  async createIssue({ title, body, labels = [] }) {
    return this.request(this.repoPath('/issues'), {
      method: 'POST',
      body: JSON.stringify({ title, body, labels }),
    });
  }

  async updateIssue(issueNumber, body) {
    return this.request(this.repoPath(`/issues/${issueNumber}`), {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  }

  async listWorkflowRuns() {
    const data = await this.request(this.repoPath('/actions/runs?per_page=100'));
    return data.workflow_runs || [];
  }

  async listJobs(runId) {
    const data = await this.request(this.repoPath(`/actions/runs/${runId}/jobs?per_page=100`));
    return data.jobs || [];
  }
}

async function main() {
  const checkedAt = new Date().toISOString();
  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
  });

  await client.ensureLabel({
    name: STATE_LABEL,
    color: '5319e7',
    description: 'State issue for the scheduled GitHub Actions log monitor',
  });
  await client.ensureLabel({
    name: REPORT_LABEL,
    color: 'd73a4a',
    description: 'Failure report created by the GitHub Actions log monitor',
  });
  let stateIssue = await client.findStateIssue();
  if (!stateIssue) {
    stateIssue = await client.createIssue({
      title: STATE_ISSUE_TITLE,
      body: buildStateIssueBody({
        checkedAt,
        since: fallbackCheckpoint(new Date(checkedAt)),
        newRuns: [],
        failures: [],
      }),
      labels: [STATE_LABEL],
    });
  }

  const since = parseCheckpoint(stateIssue.body || '') || fallbackCheckpoint(new Date(checkedAt), Number(process.env.LOOKBACK_HOURS || DEFAULT_LOOKBACK_HOURS));
  const runs = await client.listWorkflowRuns();
  const newRuns = filterNewRuns(runs, {
    since,
    monitorWorkflowName: process.env.MONITOR_WORKFLOW_NAME || 'Monitor GitHub Actions logs',
  });

  if (!newRuns.length) {
    console.log(`No new workflow runs since ${since}; checkpoint unchanged.`);
    return;
  }

  const failures = failedRuns(newRuns);
  const jobsByRun = new Map();
  for (const run of failures) {
    jobsByRun.set(run.id, await client.listJobs(run.id));
  }

  if (failures.length) {
    await client.createIssue({
      title: `GitHub Actions failures detected (${failures.length})`,
      body: buildFailureIssueBody({ checkedAt, failures, jobsByRun }),
      labels: [REPORT_LABEL],
    });
  }

  await client.updateIssue(stateIssue.number, buildStateIssueBody({
    checkedAt,
    since,
    newRuns,
    failures,
  }));

  console.log(`Checked ${newRuns.length} new workflow run(s); failures=${failures.length}; checkpoint=${checkedAt}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
