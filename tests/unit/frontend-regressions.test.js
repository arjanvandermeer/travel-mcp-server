import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, '../../web/js/app.js'), 'utf8');

describe('frontend regressions', () => {
  it('forces random city fallback from geolocation failure paths', () => {
    const forcedFallbackCalls = [...appJs.matchAll(/loadRandomCity\(\{ historyMode: 'replace', force: true \}\)/g)];

    assert.ok(forcedFallbackCalls.length >= 4, 'Geolocation and nearest-city fallbacks should force random discovery');
    assert.match(
      appJs,
      /if \(!force && this\.loading && this\._loadKey === loadKey\) return;/,
      'Random city guard should be bypassable for recovery paths'
    );
  });
});
