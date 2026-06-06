import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { createFormatStore, preferHttpsForSameHost, safeHttpUrl } from '../../web/js/format-store.js';

describe('format store', () => {
  let originalWindow;

  before(() => {
    originalWindow = global.window;
    global.window = { location: { origin: 'https://travel.example' } };
  });

  after(() => {
    global.window = originalWindow;
  });

  it('prefers HTTPS when Google and OSM websites share a host', () => {
    assert.strictEqual(
      preferHttpsForSameHost('http://www.roxyhotelnyc.com/', 'https://www.roxyhotelnyc.com/'),
      'https://www.roxyhotelnyc.com/',
    );

    const format = createFormatStore();
    assert.strictEqual(format.bestWebsite({
      google_website: 'http://www.roxyhotelnyc.com/',
      osm_website: 'https://www.roxyhotelnyc.com/',
    }), 'https://www.roxyhotelnyc.com/');
  });

  it('does not resolve relative or local URLs against the app origin', () => {
    assert.strictEqual(safeHttpUrl('/poi/123'), '');
    assert.strictEqual(safeHttpUrl('localhost'), '');
    assert.strictEqual(safeHttpUrl('http://localhost:3000/place'), '');
    assert.strictEqual(safeHttpUrl('https://127.0.0.1/place'), '');
    assert.strictEqual(safeHttpUrl('https://example.com/place'), 'https://example.com/place');

    const format = createFormatStore();
    assert.strictEqual(format.bestWebsite({
      google_website: '/property',
      osm_website: 'localhost',
      website: 'http://localhost:3000/place',
    }), '');
  });
});
