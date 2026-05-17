import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getStaticHeaders, obfuscateEmail, renderGoogleAnalyticsTag, renderWebIndex } from '../../src/http-static-utils.js';

describe('http static utils', () => {
  it('obfuscates email addresses for logs', () => {
    assert.strictEqual(obfuscateEmail('arjanvdm@gmail.com'), 'a...m@gm...om');
    assert.strictEqual(obfuscateEmail('invalid'), 'invalid');
  });

  it('builds no-cache static headers', () => {
    assert.deepStrictEqual(getStaticHeaders('text/css'), {
      'Content-Type': 'text/css',
      'Cache-Control': 'no-cache',
    });
  });

  it('only renders analytics for valid measurement IDs', () => {
    assert.strictEqual(renderGoogleAnalyticsTag('not-valid'), '');
    assert.ok(renderGoogleAnalyticsTag('G-ABC123').includes('G-ABC123'));
  });

  it('adds asset versions and optional analytics to the web index', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-index-'));
    const filePath = path.join(tmpDir, 'index.html');
    fs.writeFileSync(filePath, '<head><link rel="stylesheet" href="/css/style.css"></head><body><script src="/js/app.js"></script></body>');

    const html = renderWebIndex(filePath, {
      versionInfo: { gitCommitShort: 'abc123', buildTime: '2026-05-17T00:00:00Z' },
      measurementId: 'G-ABC123',
    });

    assert.ok(html.includes('/css/style.css?v=abc123-2026-05-17T00%3A00%3A00Z'));
    assert.ok(html.includes('/js/app.js?v=abc123-2026-05-17T00%3A00%3A00Z'));
    assert.ok(html.includes('G-ABC123'));
  });
});
