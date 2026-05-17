#!/usr/bin/env node

import fs from 'fs';
import { fileURLToPath } from 'url';

const CODE_IMPACTING_PATH_RE = /^(\.github\/workflows\/|cloudflare-oauth-worker\/|data\/|package\.json$|package-lock\.json$|scripts\/|slm\/|src\/|tests\/|web\/)/;

export function getReviewDate(reviewTimestamp) {
  if (!reviewTimestamp) return null;

  const parsed = new Date(reviewTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().split('T')[0];
}

export function daysSince(dateString, today = new Date()) {
  const previous = new Date(`${dateString}T00:00:00Z`);
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.floor((current - previous) / 86400000);
}

export function hasCodeImpactingChanges(files) {
  return files.some(file => CODE_IMPACTING_PATH_RE.test(file));
}

export function decideMaintenanceReview({
  actor = '',
  force = false,
  changedFiles = [],
  lastReviewAt = '',
  today = new Date(),
  minDays = 7,
} = {}) {
  if (force) {
    return { shouldRun: true, reason: 'manual force run' };
  }

  if (actor.endsWith('[bot]')) {
    return { shouldRun: false, reason: `skipped bot actor: ${actor}` };
  }

  if (!hasCodeImpactingChanges(changedFiles)) {
    return { shouldRun: false, reason: 'no code-impacting files changed' };
  }

  const latestReviewDate = getReviewDate(lastReviewAt);
  if (!latestReviewDate) {
    return { shouldRun: true, reason: 'no previous successful maintenance review run' };
  }

  const ageDays = daysSince(latestReviewDate, today);
  if (ageDays >= minDays) {
    return { shouldRun: true, reason: `last review was ${ageDays} days ago (${latestReviewDate})` };
  }

  return {
    shouldRun: false,
    reason: `last review was ${ageDays} days ago (${latestReviewDate}); minimum is ${minDays}`,
  };
}

function writeGitHubOutput(result) {
  if (!process.env.GITHUB_OUTPUT) return;

  fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=${result.shouldRun ? 'true' : 'false'}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `reason=${result.reason}\n`);
}

function main() {
  const changedFilesPath = process.argv[2];
  const changedFiles = changedFilesPath && fs.existsSync(changedFilesPath)
    ? fs.readFileSync(changedFilesPath, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];

  const today = process.env.TODAY ? new Date(`${process.env.TODAY}T00:00:00Z`) : new Date();

  const result = decideMaintenanceReview({
    actor: process.env.ACTOR || '',
    force: process.env.FORCE === 'true',
    changedFiles,
    lastReviewAt: process.env.LAST_REVIEW_AT || '',
    today,
    minDays: parseInt(process.env.MIN_DAYS || '7', 10),
  });

  writeGitHubOutput(result);
  console.log(`Decision: should_run=${result.shouldRun ? 'true' : 'false'}; reason=${result.reason}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
