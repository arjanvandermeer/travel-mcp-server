import { describe, it } from 'node:test';
import assert from 'node:assert';
import { addResourceUris, removeNullFields } from '../../src/response-utils.js';

describe('removeNullFields', () => {
  it('removes null and undefined fields recursively', () => {
    const result = removeNullFields({
      keep: 'value',
      missing: null,
      nested: {
        empty: undefined,
        keepZero: 0,
        list: [{ name: 'A', website: null }],
      },
    });

    assert.deepStrictEqual(result, {
      keep: 'value',
      nested: {
        keepZero: 0,
        list: [{ name: 'A' }],
      },
    });
  });

  it('preserves Date instances', () => {
    const date = new Date('2026-05-17T00:00:00.000Z');
    assert.strictEqual(removeNullFields({ date }).date, date);
  });
});

describe('addResourceUris', () => {
  it('adds resource URIs to POI arrays', () => {
    const result = addResourceUris(
      [{ osm_id: 'node/123', name: 'Cafe' }],
      'https://travel.example.com/'
    );

    assert.deepStrictEqual(result, [{
      osm_id: 'node/123',
      name: 'Cafe',
      resource_uri: 'ui://travel.example.com/poi/node/123',
    }]);
  });

  it('adds URLs to a single POI object', () => {
    const result = addResourceUris(
      { osm_id: 'way/456', name: 'Hotel' },
      'https://travel.example.com'
    );

    assert.strictEqual(result.resource_uri, 'ui://travel.example.com/poi/way/456');
  });

  it('returns non-POI values unchanged', () => {
    assert.strictEqual(addResourceUris(null, 'https://travel.example.com'), null);
    assert.deepStrictEqual(addResourceUris({ name: 'Missing ID' }, 'https://travel.example.com'), { name: 'Missing ID' });
  });
});
