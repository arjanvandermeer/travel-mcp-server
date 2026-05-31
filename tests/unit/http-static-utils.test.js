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

  it('builds no-store static headers', () => {
    assert.deepStrictEqual(getStaticHeaders('text/css'), {
      'Content-Type': 'text/css',
      'Cache-Control': 'no-store, max-age=0',
    });
  });

  it('only renders analytics for valid measurement IDs', () => {
    assert.strictEqual(renderGoogleAnalyticsTag('not-valid'), '');
    assert.strictEqual(renderGoogleAnalyticsTag('GTM-ABC123DEF').includes('googletagmanager.com/gtag/js'), false);
    assert.ok(renderGoogleAnalyticsTag('G-ABC123DEF4').includes('G-ABC123DEF4'));
  });

  it('renders route-aware analytics that suppresses PDP tracking', () => {
    const html = renderGoogleAnalyticsTag('G-ABC123DEF4');

    assert.ok(html.includes('window.__travelAnalytics'));
    assert.ok(html.includes("indexOf('/poi/') === 0"));
    assert.ok(html.includes('send_page_view: false'));
    assert.ok(html.includes("window.gtag('event', 'page_view'"));
    assert.ok(!html.includes('<script async src="https://www.googletagmanager.com/gtag/js'));
  });

  it('adds asset versions and optional analytics to the web index', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-index-'));
    const filePath = path.join(tmpDir, 'index.html');
    fs.writeFileSync(filePath, '<head><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon.png" type="image/png"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/dossier.css"></head><body><span>__APP_COMMIT__</span><script src="/js/app.js"></script></body>');

    const html = renderWebIndex(filePath, {
      versionInfo: { gitCommitShort: 'abc123', buildTime: '2026-05-17T00:00:00Z' },
      measurementId: 'G-ABC123DEF4',
    });

    assert.ok(html.includes('/css/style.css?v=abc123-2026-05-17T00%3A00%3A00Z'));
    assert.ok(html.includes('/css/dossier.css?v=abc123-2026-05-17T00%3A00%3A00Z'));
    assert.ok(html.includes('/js/app.js?v=abc123-2026-05-17T00%3A00%3A00Z'));
    assert.ok(html.includes('href="/favicon.ico"'));
    assert.ok(html.includes('href="/favicon.png"'));
    assert.ok(html.includes('<span>abc123</span>'));
    assert.ok(html.includes('G-ABC123DEF4'));
  });
});
