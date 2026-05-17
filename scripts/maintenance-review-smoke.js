#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });

  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  return result.stdout;
}

function parseGitHubOutput(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx), line.slice(idx + 1)];
      })
  );
}

function runGateSmoke(changedFiles, env) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-gate-'));
  const changedFilesPath = path.join(tempDir, 'changed-files.txt');
  const githubOutputPath = path.join(tempDir, 'github-output.txt');

  try {
    fs.writeFileSync(changedFilesPath, `${changedFiles.join('\n')}\n`);

    const stdout = run(process.execPath, ['scripts/maintenance-review-gate.js', changedFilesPath], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: githubOutputPath,
        ...env,
      },
    });

    const output = parseGitHubOutput(fs.readFileSync(githubOutputPath, 'utf8'));
    return { stdout, output };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const diffOutput = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
const changedFromHead = diffOutput.split(/\r?\n/).filter(Boolean);
console.log(`git diff-tree smoke found ${changedFromHead.length} changed file(s) for HEAD`);

const due = runGateSmoke(['src/index.js'], {
  ACTOR: 'arjanvandermeer',
  FORCE: 'false',
  LAST_REVIEW_AT: '2026-05-01T00:00:00Z',
  TODAY: '2026-05-17',
});
assert.equal(due.output.should_run, 'true');
assert.match(due.output.reason, /last review was 16 days ago/);

const lowSignal = runGateSmoke(['doc/regular-codebase-review.md'], {
  ACTOR: 'arjanvandermeer',
  FORCE: 'false',
  LAST_REVIEW_AT: '2026-05-01T00:00:00Z',
  TODAY: '2026-05-17',
});
assert.equal(lowSignal.output.should_run, 'false');
assert.match(lowSignal.output.reason, /no code-impacting files changed/);

console.log('maintenance review gate smoke passed');
