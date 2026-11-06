import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFormatStore } from '../../web/js/format-store.js';
import { apiDelete, apiGet, apiPost } from '../../web/js/api.js';

describe('PDP browser module dependencies', () => {
  it('loads the actual dependency graph without retired modules', () => {
    const format = createFormatStore();
    assert.equal(format.bestAddress({ google_address: 'Test address' }), 'Test address');
    assert.equal(format.openStatus({}), 'Hours not listed');
    assert.equal(typeof apiGet, 'function');
    assert.equal(typeof apiPost, 'function');
    assert.equal(typeof apiDelete, 'function');
  });

  it('versions both helper imports with the entry module build', () => {
    const source = readFileSync(new URL('../../web/js/poi-app.js', import.meta.url), 'utf8');
    assert.match(source, /new URL\(import\.meta\.url\)\.searchParams\.get\('v'\)/);
    assert.ok(source.includes('import(`./api.js${moduleQuery}`)'));
    assert.ok(source.includes('import(`./format-store.js${moduleQuery}`)'));
  });
});
