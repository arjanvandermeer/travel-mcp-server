#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CONFIG = 'ops/ec2-pull-deploy.config.json';
const DEFAULT_RETRIES = 12;
const DEFAULT_RETRY_DELAY_MS = 5000;

class SkipDeploy extends Error {}

function log(message) {
  console.log(`[deploy] ${new Date().toISOString()} ${message}`);
}

function fail(message) {
  console.error(`[deploy] ${new Date().toISOString()} ERROR ${message}`);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function commandWithUser(command, runAs) {
  if (!runAs || process.getuid?.() !== 0) return command;
  return ['sudo', '-H', '-u', runAs, '--', ...command];
}

function run(command, options = {}) {
  const fullCommand = commandWithUser(command, options.runAs);
  log(`run: ${fullCommand.join(' ')}${options.cwd ? ` (${options.cwd})` : ''}`);
  const result = spawnSync(fullCommand[0], fullCommand.slice(1), {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.status !== 0) {
    const detail = options.capture ? `${result.stderr || result.stdout || ''}`.trim() : '';
    throw new Error(`${fullCommand.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }

  return options.capture ? result.stdout.trim() : '';
}

function git(repo, args, options = {}) {
  return run(['git', ...args], { cwd: repo.path, runAs: repo.runAs, capture: true, ...options });
}

function assertClean(repo) {
  const status = git(repo, ['status', '--porcelain']);
  if (status) {
    throw new SkipDeploy(`${repo.name} has local changes on EC2; refusing to deploy\n${status}`);
  }
}

function getHead(repo, ref = 'HEAD') {
  return git(repo, ['rev-parse', ref]);
}

function checkoutExact(repo, sha) {
  git(repo, ['checkout', repo.branch]);
  git(repo, ['reset', '--hard', sha]);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function githubHeaders(config) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'travel-ec2-pull-deploy',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env[config.githubTokenEnv || 'GITHUB_TOKEN'];
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubJson(url, config) {
  const script = `
    const res = await fetch(${JSON.stringify(url)}, { headers: ${JSON.stringify(githubHeaders(config))} });
    if (!res.ok) throw new Error(String(res.status) + ' ' + await res.text());
    console.log(JSON.stringify(await res.json()));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return JSON.parse(output);
}

function ciPassed(config, repo, sha) {
  if (!repo.ci?.required) return true;
  const url = new URL(`https://api.github.com/repos/${repo.github}/actions/runs`);
  url.searchParams.set('head_sha', sha);
  url.searchParams.set('branch', repo.branch);
  url.searchParams.set('event', 'push');
  url.searchParams.set('per_page', '20');

  const runs = githubJson(url.toString(), config).workflow_runs || [];
  const matchingRuns = repo.ci.workflow
    ? runs.filter(run => run.name === repo.ci.workflow)
    : runs;

  if (matchingRuns.some(run => run.status === 'completed' && run.conclusion === 'success')) {
    return true;
  }

  if (matchingRuns.some(run => run.status === 'completed' && run.conclusion && run.conclusion !== 'success')) {
    throw new SkipDeploy(`${repo.name} CI failed for ${sha}`);
  }

  log(`${repo.name}: CI has not passed for ${sha} yet`);
  return false;
}

function runCommands(repo, commands = []) {
  for (const command of commands) {
    run(command, { cwd: repo.path, runAs: repo.runAs });
  }
}

function restartService(repo) {
  if (!repo.service) return;
  run(['systemctl', 'restart', repo.service]);
}

function healthCheck(repo) {
  if (!repo.healthCheck) return true;
  const retries = repo.healthCheck.retries || DEFAULT_RETRIES;
  const delayMs = repo.healthCheck.delayMs || DEFAULT_RETRY_DELAY_MS;
  const command = repo.healthCheck.command;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
    if (result.status === 0) return true;
    log(`${repo.name}: health check failed (${attempt}/${retries})`);
    if (attempt < retries) sleep(delayMs);
  }

  return false;
}

function stateFor(state, repoName) {
  state.repos ||= {};
  state.repos[repoName] ||= { blockedShas: {} };
  state.repos[repoName].blockedShas ||= {};
  return state.repos[repoName];
}

function markBlocked(state, repo, sha, reason) {
  const repoState = stateFor(state, repo.name);
  repoState.blockedShas[sha] = {
    reason,
    blockedAt: new Date().toISOString(),
  };
}

function deployRepo(config, state, repo) {
  log(`${repo.name}: checking ${repo.github} ${repo.branch}`);
  assertClean(repo);

  git(repo, ['fetch', repo.remote || 'origin', repo.branch, '--prune']);
  const currentSha = getHead(repo);
  const targetSha = getHead(repo, `${repo.remote || 'origin'}/${repo.branch}`);
  const repoState = stateFor(state, repo.name);

  if (repoState.blockedShas[targetSha]) {
    log(`${repo.name}: ${targetSha.slice(0, 12)} is blocked after a previous rollback; waiting for a newer commit`);
    return;
  }

  if (currentSha === targetSha) {
    log(`${repo.name}: already at ${targetSha.slice(0, 12)}`);
    return;
  }

  if (!ciPassed(config, repo, targetSha)) return;

  log(`${repo.name}: deploying ${targetSha.slice(0, 12)} from ${currentSha.slice(0, 12)}`);
  try {
    checkoutExact(repo, targetSha);
    runCommands(repo, repo.install || []);
    restartService(repo);
    if (!healthCheck(repo)) throw new Error('health check failed after deploy');
    repoState.lastSuccessfulSha = targetSha;
    repoState.lastDeployedAt = new Date().toISOString();
    log(`${repo.name}: deploy succeeded`);
  } catch (err) {
    fail(`${repo.name}: deploy failed: ${err.message}`);
    log(`${repo.name}: rolling back to ${currentSha.slice(0, 12)}`);
    try {
      checkoutExact(repo, currentSha);
      runCommands(repo, repo.install || []);
      restartService(repo);
      if (!healthCheck(repo)) {
        fail(`${repo.name}: rollback health check failed; manual intervention required`);
      }
    } finally {
      markBlocked(state, repo, targetSha, err.message);
      throw err;
    }
  }
}

function acquireLock(lockFile) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    return () => {
      fs.closeSync(fd);
      fs.rmSync(lockFile, { force: true });
    };
  } catch (err) {
    if (err.code === 'EEXIST') {
      log(`another deploy run is already active (${lockFile})`);
      process.exit(0);
    }
    throw err;
  }
}

function parseArgs() {
  const configIndex = process.argv.indexOf('--config');
  if (configIndex !== -1) return process.argv[configIndex + 1];
  return process.env.EC2_PULL_DEPLOY_CONFIG || DEFAULT_CONFIG;
}

function main() {
  const configPath = parseArgs();
  const config = readJson(configPath);
  if (!config?.repos?.length) throw new Error(`No repos configured in ${configPath}`);

  const releaseLock = acquireLock(config.lockFile || '/var/lock/ec2-pull-deploy.lock');
  const statePath = config.stateFile || '/var/lib/ec2-pull-deploy/state.json';
  const state = readJson(statePath, { repos: {} });
  let failed = false;

  try {
    for (const repo of config.repos) {
      try {
        deployRepo(config, state, repo);
      } catch (err) {
        if (err instanceof SkipDeploy) {
          log(`${repo.name}: skipped: ${err.message}`);
        } else {
          failed = true;
          fail(`${repo.name}: ${err.message}`);
        }
      } finally {
        writeJson(statePath, state);
      }
    }
  } finally {
    releaseLock();
  }

  if (failed) process.exitCode = 1;
}

main();
