import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  displayHostname,
  sanitizeEmailHref,
  sanitizeHttpUrl,
  sanitizeHttpUrlList,
  sanitizePhoneHref,
  sanitizePoiExternalUrls,
} from '../../src/url-utils.js';

describe('url utilities', () => {
  it('allows only http and https URLs', () => {
    assert.strictEqual(sanitizeHttpUrl('https://example.com/a'), 'https://example.com/a');
    assert.strictEqual(sanitizeHttpUrl('http://example.com/a'), 'http://example.com/a');
    assert.strictEqual(sanitizeHttpUrl('javascript:alert(1)'), null);
    assert.strictEqual(sanitizeHttpUrl('data:text/html,hi'), null);
  });

  it('sanitizes URL lists and preserves order', () => {
    assert.deepStrictEqual(sanitizeHttpUrlList([
      'https://example.com/a',
      'javascript:alert(1)',
      'https://example.com/a',
      'https://example.com/b',
    ]), ['https://example.com/a', 'https://example.com/b']);
  });

  it('sanitizes POI external URL fields', () => {
    const poi = sanitizePoiExternalUrls({
      photo_url: 'javascript:alert(1)',
      google_website: 'https://venue.example',
      google_maps_url: 'data:text/html,hi',
      google_photos: [
        { url: 'https://images.example/a.jpg' },
        { url: 'javascript:alert(1)' },
      ],
    });

    assert.strictEqual(poi.photo_url, null);
    assert.strictEqual(poi.google_website, 'https://venue.example/');
    assert.strictEqual(poi.google_maps_url, null);
    assert.deepStrictEqual(poi.google_photos, [{ url: 'https://images.example/a.jpg' }]);
  });

  it('builds safe contact hrefs', () => {
    assert.strictEqual(sanitizePhoneHref('+1 (555) 123-4567'), 'tel:+15551234567');
    assert.strictEqual(sanitizePhoneHref('call me'), null);
    assert.strictEqual(sanitizeEmailHref('hello@example.com'), 'mailto:hello@example.com');
    assert.strictEqual(sanitizeEmailHref('bad <x@example.com>'), null);
    assert.strictEqual(displayHostname('https://www.example.com/a'), 'example.com');
  });
});
