import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { createFormatStore, preferHttpsForSameHost } from '../../web/js/format-store.js';

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
});
