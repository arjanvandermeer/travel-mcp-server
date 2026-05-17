import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  decideMaintenanceReview,
  daysSince,
  getLatestReviewDate,
  hasCodeImpactingChanges,
} from '../../scripts/maintenance-review-gate.js';

const today = new Date('2026-05-17T00:00:00Z');

describe('maintenance-review-gate', () => {
  it('detects the latest dated Regular Codebase Review entry', () => {
    const todo = `
## Other Section
### 2026-05-16

## Regular Codebase Review
### 2026-05-01
### 2026-05-10
`;

    assert.strictEqual(getLatestReviewDate(todo), '2026-05-10');
  });

  it('ignores dated headings outside the Regular Codebase Review section', () => {
    const todo = `
## Regular Codebase Review
### 2026-05-01

## Another Dated Section
### 2026-05-16
`;

    assert.strictEqual(getLatestReviewDate(todo), '2026-05-01');
  });

  it('returns null when no dated review entry exists', () => {
    assert.strictEqual(getLatestReviewDate('# TODO\n\n## Regular Codebase Review\n'), null);
  });

  it('calculates age in whole UTC days', () => {
    assert.strictEqual(daysSince('2026-05-10', today), 7);
  });

  it('detects code-impacting paths', () => {
    assert.strictEqual(hasCodeImpactingChanges(['TODO.md', 'src/index.js']), true);
    assert.strictEqual(hasCodeImpactingChanges(['TODO.md', 'doc/regular-codebase-review.md']), false);
  });

  it('runs when forced even without code-impacting changes', () => {
    const result = decideMaintenanceReview({
      force: true,
      changedFiles: ['TODO.md'],
      todoText: '',
      today,
    });

    assert.deepStrictEqual(result, { shouldRun: true, reason: 'manual force run' });
  });

  it('skips bot-authored commits', () => {
    const result = decideMaintenanceReview({
      actor: 'github-actions[bot]',
      changedFiles: ['src/index.js'],
      todoText: '',
      today,
    });

    assert.strictEqual(result.shouldRun, false);
    assert.match(result.reason, /skipped bot actor/);
  });

  it('skips low-signal path-only commits', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['TODO.md'],
      todoText: '',
      today,
    });

    assert.deepStrictEqual(result, { shouldRun: false, reason: 'no code-impacting files changed' });
  });

  it('runs when no previous dated review exists', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['src/index.js'],
      todoText: '# TODO\n',
      today,
    });

    assert.strictEqual(result.shouldRun, true);
    assert.match(result.reason, /no previous dated/);
  });

  it('runs when the last review is at least seven days old', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['src/index.js'],
      todoText: '## Regular Codebase Review\n\n### 2026-05-10\n',
      today,
    });

    assert.strictEqual(result.shouldRun, true);
    assert.match(result.reason, /7 days ago/);
  });

  it('skips when the last review is too recent', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['src/index.js'],
      todoText: '## Regular Codebase Review\n\n### 2026-05-15\n',
      today,
    });

    assert.strictEqual(result.shouldRun, false);
    assert.match(result.reason, /minimum is 7/);
  });
});
