import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

describe('telemetry noise regressions', () => {
  it('does not turn routine auth and session lifecycle events into Sentry issues', () => {
    const indexHttp = readRepoFile('src/index-http.js');

    assert.doesNotMatch(indexHttp, /captureMessage\(`Auth success:/);
    assert.doesNotMatch(indexHttp, /captureMessage\('New session created'/);
    assert.doesNotMatch(indexHttp, /captureMessage\('Session expired, created new'/);
    assert.doesNotMatch(indexHttp, /captureMessage\(`Session cleanup:/);
  });

  it('counts provider calls with metrics instead of issue events', () => {
    const googlePlaces = readRepoFile('src/google-places.js');
    const openrouterSummaries = readRepoFile('src/openrouter-place-summaries.js');
    const telemetry = readRepoFile('src/telemetry.js');

    assert.doesNotMatch(googlePlaces, /captureMetricEvent\('google_places\.api_calls'/);
    assert.doesNotMatch(openrouterSummaries, /captureMetricEvent\('openrouter\.api_requests'/);
    assert.match(telemetry, /Sentry\.metrics\.count/);
    assert.doesNotMatch(telemetry, /Sentry\.metrics\.increment/);
    assert.doesNotMatch(telemetry, /Sentry\.captureMessage\(`metric:/);
  });
});
