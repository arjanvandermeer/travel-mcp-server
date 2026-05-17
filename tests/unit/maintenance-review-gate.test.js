import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  decideMaintenanceReview,
  daysSince,
  getReviewDate,
  hasCodeImpactingChanges,
} from '../../scripts/maintenance-review-gate.js';

const today = new Date('2026-05-17T00:00:00Z');

describe('maintenance-review-gate', () => {
  it('normalizes a previous review timestamp to a UTC date', () => {
    assert.strictEqual(getReviewDate('2026-05-10T15:30:00Z'), '2026-05-10');
  });

  it('returns null when no valid previous review timestamp exists', () => {
    assert.strictEqual(getReviewDate(''), null);
    assert.strictEqual(getReviewDate('not-a-date'), null);
  });

  it('calculates age in whole UTC days', () => {
    assert.strictEqual(daysSince('2026-05-10', today), 7);
  });

  it('detects code-impacting paths', () => {
    assert.strictEqual(hasCodeImpactingChanges(['doc/regular-codebase-review.md', 'src/index.js']), true);
    assert.strictEqual(hasCodeImpactingChanges(['doc/regular-codebase-review.md']), false);
  });

  it('runs when forced even without code-impacting changes', () => {
    const result = decideMaintenanceReview({
      force: true,
      changedFiles: ['doc/regular-codebase-review.md'],
      lastReviewAt: '',
      today,
    });

    assert.deepStrictEqual(result, { shouldRun: true, reason: 'manual force run' });
  });

  it('skips bot-authored commits', () => {
    const result = decideMaintenanceReview({
      actor: 'github-actions[bot]',
      changedFiles: ['src/index.js'],
      lastReviewAt: '',
      today,
    });

    assert.strictEqual(result.shouldRun, false);
    assert.match(result.reason, /skipped bot actor/);
  });

  it('skips low-signal path-only commits', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['doc/regular-codebase-review.md'],
      lastReviewAt: '',
      today,
    });

    assert.deepStrictEqual(result, { shouldRun: false, reason: 'no code-impacting files changed' });
  });

  it('runs when no previous successful review exists', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['src/index.js'],
      lastReviewAt: '',
      today,
    });

    assert.strictEqual(result.shouldRun, true);
    assert.match(result.reason, /no previous successful/);
  });

  it('runs when the last review is at least seven days old', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['src/index.js'],
      lastReviewAt: '2026-05-10T11:00:00Z',
      today,
    });

    assert.strictEqual(result.shouldRun, true);
    assert.match(result.reason, /7 days ago/);
  });

  it('skips when the last review is too recent', () => {
    const result = decideMaintenanceReview({
      changedFiles: ['src/index.js'],
      lastReviewAt: '2026-05-15T11:00:00Z',
      today,
    });

    assert.strictEqual(result.shouldRun, false);
    assert.match(result.reason, /minimum is 7/);
  });
});
