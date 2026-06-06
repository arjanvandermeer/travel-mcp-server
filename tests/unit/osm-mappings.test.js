/**
 * Tests for OSM POI Mappings and Extraction Functions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  POI_MAPPINGS,
  getValidPOITypes,
  getPOICategories,
  evaluatePOICondition,
  matchPOIType,
  extractPOIData,
  shouldFilterPOI,
} from '../../src/lib/osm-mappings.js';

describe('POI_MAPPINGS', () => {
  it('should contain hotel mapping', () => {
    assert.strictEqual(POI_MAPPINGS['tourism=hotel'], 'hotel');
  });

  it('should contain restaurant mapping', () => {
    assert.strictEqual(POI_MAPPINGS['amenity=restaurant'], 'restaurant');
  });

  it('should contain museum mapping', () => {
    assert.strictEqual(POI_MAPPINGS['tourism=museum'], 'museum');
  });

  it('should have all expected accommodation types', () => {
    assert.strictEqual(POI_MAPPINGS['tourism=hotel'], 'hotel');
    assert.strictEqual(POI_MAPPINGS['tourism=hostel'], 'hostel');
    assert.strictEqual(POI_MAPPINGS['tourism=guest_house'], 'guest_house');
    assert.strictEqual(POI_MAPPINGS['tourism=motel'], 'motel');
    assert.strictEqual(POI_MAPPINGS['tourism=resort'], 'resort');
    assert.strictEqual(POI_MAPPINGS['tourism=apartment'], 'apartment');
    assert.strictEqual(POI_MAPPINGS['tourism=camp_site'], 'camp_site');
    assert.strictEqual(POI_MAPPINGS['tourism=chalet'], 'chalet');
    assert.strictEqual(POI_MAPPINGS['tourism=bed_and_breakfast'], 'bed_and_breakfast');
  });

  it('should have all expected food types', () => {
    assert.strictEqual(POI_MAPPINGS['amenity=restaurant'], 'restaurant');
    assert.strictEqual(POI_MAPPINGS['amenity=cafe'], 'cafe');
    assert.strictEqual(POI_MAPPINGS['amenity=bar'], 'bar');
    assert.strictEqual(POI_MAPPINGS['amenity=pub'], 'pub');
  });

  it('should have neighborhood livability support types', () => {
    assert.strictEqual(POI_MAPPINGS['shop=supermarket'], 'supermarket');
    assert.strictEqual(POI_MAPPINGS['amenity=pharmacy'], 'pharmacy');
    assert.strictEqual(POI_MAPPINGS['highway=bus_stop'], 'bus_stop');
    assert.strictEqual(POI_MAPPINGS['railway=station'], 'train_station');
    assert.strictEqual(POI_MAPPINGS['railway=subway_entrance'], 'subway_station');
    assert.strictEqual(POI_MAPPINGS['railway=tram_stop'], 'tram_stop');
    assert.strictEqual(POI_MAPPINGS['public_transport=station'], 'transit_station');
  });
});

describe('getValidPOITypes', () => {
  it('should return an array', () => {
    const types = getValidPOITypes();
    assert.ok(Array.isArray(types));
  });

  it('should contain hotel', () => {
    const types = getValidPOITypes();
    assert.ok(types.includes('hotel'));
  });

  it('should contain restaurant', () => {
    const types = getValidPOITypes();
    assert.ok(types.includes('restaurant'));
  });

  it('should not have duplicates', () => {
    const types = getValidPOITypes();
    const uniqueTypes = [...new Set(types)];
    assert.strictEqual(types.length, uniqueTypes.length);
  });
});

describe('getPOICategories', () => {
  it('should return an object', () => {
    const categories = getPOICategories();
    assert.ok(typeof categories === 'object');
  });

  it('should have tourism category', () => {
    const categories = getPOICategories();
    assert.ok(Array.isArray(categories.tourism));
    assert.ok(categories.tourism.includes('hotel'));
  });

  it('should have amenity category', () => {
    const categories = getPOICategories();
    assert.ok(Array.isArray(categories.amenity));
    assert.ok(categories.amenity.includes('restaurant'));
  });

  it('should have historic category', () => {
    const categories = getPOICategories();
    assert.ok(Array.isArray(categories.historic));
    assert.ok(categories.historic.includes('castle'));
  });
});

describe('evaluatePOICondition', () => {
  it('should return true for matching tag', () => {
    const tags = { tourism: 'hotel', name: 'Test Hotel' };
    assert.strictEqual(evaluatePOICondition(tags, 'tourism=hotel'), true);
  });

  it('should return false for non-matching tag', () => {
    const tags = { tourism: 'hotel', name: 'Test Hotel' };
    assert.strictEqual(evaluatePOICondition(tags, 'tourism=museum'), false);
  });

  it('should return false for missing tag', () => {
    const tags = { name: 'Test' };
    assert.strictEqual(evaluatePOICondition(tags, 'tourism=hotel'), false);
  });

  it('should return false for null tags', () => {
    assert.strictEqual(evaluatePOICondition(null, 'tourism=hotel'), false);
  });

  it('should return false for undefined tags', () => {
    assert.strictEqual(evaluatePOICondition(undefined, 'tourism=hotel'), false);
  });

  it('should handle amenity tags', () => {
    const tags = { amenity: 'restaurant', cuisine: 'thai' };
    assert.strictEqual(evaluatePOICondition(tags, 'amenity=restaurant'), true);
    assert.strictEqual(evaluatePOICondition(tags, 'amenity=cafe'), false);
  });
});

describe('matchPOIType', () => {
  it('should match hotel when type is "all"', () => {
    const tags = { tourism: 'hotel', name: 'Grand Hotel' };
    assert.strictEqual(matchPOIType(tags, 'all'), 'hotel');
  });

  it('should match restaurant when type is "all"', () => {
    const tags = { amenity: 'restaurant', cuisine: 'italian' };
    assert.strictEqual(matchPOIType(tags, 'all'), 'restaurant');
  });

  it('should return null for non-POI tags when type is "all"', () => {
    const tags = { building: 'yes', name: 'Some Building' };
    assert.strictEqual(matchPOIType(tags, 'all'), null);
  });

  it('should match specific type when requested', () => {
    const tags = { tourism: 'hotel', stars: '5' };
    assert.strictEqual(matchPOIType(tags, 'hotel'), 'hotel');
  });

  it('should return null when specific type does not match', () => {
    const tags = { amenity: 'restaurant' };
    assert.strictEqual(matchPOIType(tags, 'hotel'), null);
  });

  it('should return null for null tags', () => {
    assert.strictEqual(matchPOIType(null, 'all'), null);
  });

  it('should return null for empty tags', () => {
    assert.strictEqual(matchPOIType({}, 'all'), null);
  });

  it('should match first POI type when multiple apply', () => {
    // This tests deterministic behavior - should return first match
    const tags = { tourism: 'hotel' };
    const result = matchPOIType(tags, 'all');
    assert.strictEqual(result, 'hotel');
  });
});

describe('extractPOIData', () => {
  const baseItem = {
    id: 12345,
    type: 'node',
    lat: 13.75,
    lon: 100.50,
    tags: {
      name: 'Test Hotel',
      tourism: 'hotel',
    },
  };

  it('should extract basic POI data', () => {
    const poi = extractPOIData(baseItem, 'hotel', 'thailand');

    assert.strictEqual(poi.osm_id, 12345);
    assert.strictEqual(poi.osm_type, 'node');
    assert.strictEqual(poi.poi_type, 'hotel');
    assert.strictEqual(poi.name, 'Test Hotel');
    assert.strictEqual(poi.latitude, 13.75);
    assert.strictEqual(poi.longitude, 100.50);
    assert.strictEqual(poi.source_region, 'thailand');
  });

  it('should extract address from addr:* tags', () => {
    const item = {
      ...baseItem,
      tags: {
        ...baseItem.tags,
        'addr:housenumber': '123',
        'addr:street': 'Main Street',
        'addr:city': 'Bangkok',
        'addr:postcode': '10110',
      },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.address, '123 Main Street, Bangkok, 10110');
  });

  it('should not split house number and street with a comma', () => {
    const item = {
      ...baseItem,
      tags: {
        ...baseItem.tags,
        'addr:housenumber': '2',
        'addr:street': 'Avenue of the Americas',
        'addr:city': 'New York',
        'addr:postcode': '10013',
      },
    };

    const poi = extractPOIData(item, 'hotel', 'new-york-latest');
    assert.strictEqual(poi.address, '2 Avenue of the Americas, New York, 10013');
  });

  it('should extract phone number', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, phone: '+66 2 123 4567' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.phone, '+66 2 123 4567');
  });

  it('should extract contact:phone as fallback', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, 'contact:phone': '+66 2 987 6543' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.phone, '+66 2 987 6543');
  });

  it('should extract email', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, email: 'info@test.com' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.email, 'info@test.com');
  });

  it('should extract website', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, website: 'https://test.com' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.website, 'https://test.com/');
  });

  it('should reject relative and local websites', () => {
    const relative = extractPOIData({
      ...baseItem,
      tags: { ...baseItem.tags, website: '/property' },
    }, 'hotel', 'thailand');
    const local = extractPOIData({
      ...baseItem,
      tags: { ...baseItem.tags, website: 'http://localhost:3000/property' },
    }, 'hotel', 'thailand');

    assert.strictEqual(relative.website, null);
    assert.strictEqual(local.website, null);
  });

  it('should extract star rating', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, stars: '5' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.stars, 5);
  });

  it('should normalize star rating with extra characters', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, stars: '4 stars' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.stars, 4);
  });

  it('should reject invalid star rating (> 5)', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, stars: '7' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.stars, null);
  });

  it('should reject invalid star rating (0)', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, stars: '0' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.stars, null);
  });

  it('should extract room count', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, rooms: '100' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.rooms, 100);
  });

  it('should reject negative room count', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, rooms: '-5' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.rooms, null);
  });

  it('should reject excessively large room count', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, rooms: '999999999' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.rooms, null);
  });

  it('should extract cuisine for restaurants', () => {
    const item = {
      id: 999,
      type: 'node',
      lat: 13.75,
      lon: 100.50,
      tags: {
        name: 'Thai Kitchen',
        amenity: 'restaurant',
        cuisine: 'thai;asian',
      },
    };

    const poi = extractPOIData(item, 'restaurant', 'thailand');
    assert.strictEqual(poi.cuisine, 'thai;asian');
  });

  it('should extract opening_hours', () => {
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, opening_hours: 'Mo-Fr 09:00-18:00' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.opening_hours, 'Mo-Fr 09:00-18:00');
  });

  it('should truncate very long names', () => {
    const longName = 'A'.repeat(600);
    const item = {
      ...baseItem,
      tags: { ...baseItem.tags, name: longName },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.name.length, 500);
  });

  it('should default to node type if not specified', () => {
    const item = {
      id: 999,
      lat: 13.75,
      lon: 100.50,
      tags: { name: 'Test' },
    };

    const poi = extractPOIData(item, 'hotel', 'thailand');
    assert.strictEqual(poi.osm_type, 'node');
  });

  it('should include all tags in osm_tags', () => {
    const poi = extractPOIData(baseItem, 'hotel', 'thailand');
    assert.deepStrictEqual(poi.osm_tags, baseItem.tags);
  });

  it('should return null name_en for English names', () => {
    const poi = extractPOIData(baseItem, 'hotel', 'thailand');
    assert.strictEqual(poi.name_en, null);
  });

  it('should include name_en field for Thai names', () => {
    const item = {
      id: 99999,
      type: 'node',
      lat: 7.88,
      lon: 98.38,
      tags: { name: 'ภูเก็ต', tourism: 'attraction' },
    };
    const poi = extractPOIData(item, 'attraction', 'thailand');
    assert.ok('name_en' in poi);
    assert.ok(poi.name_en);
  });

  it('should use tags name:en if available', () => {
    const item = {
      id: 88888,
      type: 'node',
      lat: 13.75,
      lon: 100.50,
      tags: { name: 'วัดพระแก้ว', 'name:en': 'Temple of the Emerald Buddha', tourism: 'attraction' },
    };
    const poi = extractPOIData(item, 'attraction', 'thailand');
    assert.strictEqual(poi.name_en, 'Temple of the Emerald Buddha');
  });
});

describe('shouldFilterPOI', () => {
  it('should not filter POI with valid name', () => {
    assert.strictEqual(shouldFilterPOI({ name: 'Grand Hotel' }), false);
  });

  it('should filter POI with null name', () => {
    assert.strictEqual(shouldFilterPOI({ name: null }), true);
  });

  it('should filter POI with undefined name', () => {
    assert.strictEqual(shouldFilterPOI({ name: undefined }), true);
  });

  it('should filter POI with empty string name', () => {
    assert.strictEqual(shouldFilterPOI({ name: '' }), true);
  });

  it('should filter POI with whitespace-only name', () => {
    assert.strictEqual(shouldFilterPOI({ name: '   ' }), true);
  });

  it('should filter POI with "unknown" name (lowercase)', () => {
    assert.strictEqual(shouldFilterPOI({ name: 'unknown' }), true);
  });

  it('should filter POI with "Unknown" name (mixed case)', () => {
    assert.strictEqual(shouldFilterPOI({ name: 'Unknown' }), true);
  });

  it('should filter POI with "UNKNOWN" name (uppercase)', () => {
    assert.strictEqual(shouldFilterPOI({ name: 'UNKNOWN' }), true);
  });

  it('should not filter POI with name containing "unknown"', () => {
    assert.strictEqual(shouldFilterPOI({ name: 'Unknown Hotel Name' }), false);
  });
});
