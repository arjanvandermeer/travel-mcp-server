import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildFailureIssueBody,
  buildStateIssueBody,
  failedRuns,
  fallbackCheckpoint,
  filterNewRuns,
  parseCheckpoint,
} from '../../scripts/actions-log-monitor.js';

describe('actions-log-monitor', () => {
  it('parses and falls back from checkpoint markers', () => {
    assert.strictEqual(
      parseCheckpoint('<!-- actions-log-monitor:last_checked_at=2026-05-17T12:30:00.000Z -->'),
      '2026-05-17T12:30:00.000Z'
    );
    assert.strictEqual(parseCheckpoint('no marker'), null);
    assert.strictEqual(
      fallbackCheckpoint(new Date('2026-05-17T12:30:00.000Z'), 2),
      '2026-05-17T10:30:00.000Z'
    );
  });

  it('returns only new runs and excludes the monitor workflow itself', () => {
    const runs = [
      { id: 1, name: 'CI', created_at: '2026-05-17T12:00:00.000Z', updated_at: '2026-05-17T12:00:00.000Z' },
      { id: 2, name: 'Monitor GitHub Actions logs', created_at: '2026-05-17T12:30:00.000Z', updated_at: '2026-05-17T12:30:00.000Z' },
      { id: 3, name: 'CI', created_at: '2026-05-17T12:20:00.000Z', updated_at: '2026-05-17T12:20:00.000Z' },
      { id: 4, name: 'CI', created_at: '2026-05-17T12:05:00.000Z', updated_at: '2026-05-17T12:25:00.000Z' },
    ];

    assert.deepStrictEqual(
      filterNewRuns(runs, {
        since: '2026-05-17T12:10:00.000Z',
        monitorWorkflowName: 'Monitor GitHub Actions logs',
      }).map(run => run.id),
      [3, 4]
    );
  });

  it('treats non-success completed runs as failures worth reporting', () => {
    const runs = [
      { id: 1, status: 'completed', conclusion: 'success' },
      { id: 2, status: 'completed', conclusion: 'failure' },
      { id: 3, status: 'in_progress', conclusion: null },
      { id: 4, status: 'completed', conclusion: 'timed_out' },
    ];

    assert.deepStrictEqual(failedRuns(runs).map(run => run.id), [2, 4]);
  });

  it('builds durable state and failure issue bodies', () => {
    const failures = [{
      id: 100,
      name: 'CI',
      run_number: 42,
      conclusion: 'failure',
      head_branch: 'main',
      head_sha: 'abc123',
      html_url: 'https://github.example/run/42',
    }];
    const stateBody = buildStateIssueBody({
      checkedAt: '2026-05-17T12:30:00.000Z',
      since: '2026-05-17T12:00:00.000Z',
      newRuns: failures,
      failures,
    });
    const failureBody = buildFailureIssueBody({
      checkedAt: '2026-05-17T12:30:00.000Z',
      failures,
      jobsByRun: new Map([[100, [{
        name: 'test',
        conclusion: 'failure',
        html_url: 'https://github.example/job/1',
      }]]]),
    });

    assert.match(stateBody, /actions-log-monitor:last_checked_at=2026-05-17T12:30:00.000Z/);
    assert.match(stateBody, /CI #42: failure/);
    assert.match(failureBody, /Failed jobs:/);
    assert.match(failureBody, /test: failure/);
  });
});
