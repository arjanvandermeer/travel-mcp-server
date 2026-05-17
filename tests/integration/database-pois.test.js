/**
 * Integration Tests for TravelDatabase POI Functions
 *
 * Tests searchPOIs, searchPOIsNearCoordinates, getPOIDetails
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TravelDatabase } from '../../src/database.js';
import { createMockDatabase } from '../mocks/db-mock.js';
import { dbResult, emptyResult } from '../fixtures/sample-data.js';

describe('TravelDatabase POI Search Functions', () => {
  let db;
  let mockPool;

  // Sample POI data for test responses
  const samplePOIs = [
    {
      osm_id: 12345,
      poi_type: 'hotel',
      name: 'Grand Hotel Bangkok',
      latitude: 13.75,
      longitude: 100.5,
      city: 'Bangkok',
      country_code: 'TH',
      google_place_id: 'ChIJ123',
      google_rating: 4.5,
      google_review_count: 1200,
      osm_stars: 5,
    },
    {
      osm_id: 12346,
      poi_type: 'restaurant',
      name: 'Thai Kitchen',
      latitude: 13.76,
      longitude: 100.51,
      city: 'Bangkok',
      country_code: 'TH',
      google_rating: 4.2,
      osm_cuisine: 'thai',
    },
  ];

  beforeEach(() => {
    mockPool = createMockDatabase({}, { throwOnUnmatched: false });
    // Mock getServerBaseUrl
    mockPool.setResponse('server_base_url', dbResult([{ value: 'https://example.com' }]));
    // Mock Google Places config with fake key to suppress warnings
    mockPool.setResponse('google_places_api_key', dbResult([{ value: 'test-fake-api-key' }]));
    mockPool.setResponse('google_places_enabled', dbResult([{ value: 'true' }]));
  });

  describe('searchPOIs', () => {
    describe('Case 1: Name search only', () => {
      it('should search POIs by name only', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand Hotel' });

        assert.ok(Array.isArray(results));
        assert.ok(mockPool.wasCalled('osm_pois'));
        // Should have called with ILIKE pattern
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.params?.includes('%Grand Hotel%'));
        assert.ok(searchCall, 'Should search with ILIKE pattern');
      });

      it('should filter by country code when provided', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand Hotel', countryCode: 'TH' });

        assert.ok(Array.isArray(results));
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c =>
          c.sql.includes('country_code') &&
          c.params?.includes('TH')
        );
        assert.ok(searchCall, 'Should filter by country code');
      });

      it('should filter by POI type when provided', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand', poiType: 'hotel' });

        assert.ok(Array.isArray(results));
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('poi_type'));
        assert.ok(searchCall, 'Should filter by POI type');
      });

      it('should support multiple POI types', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand',
          poiTypes: ['hotel', 'restaurant']
        });

        assert.ok(Array.isArray(results));
      });

      it('should add cuisine filters to name searches', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Kitchen',
          poiTypes: ['restaurant'],
          cuisine: ['sushi', 'japanese'],
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('p.cuisine ILIKE'));
        assert.ok(searchCall, 'Should include cuisine ILIKE clauses');
        assert.ok(searchCall.sql.includes(' OR '), 'Multiple cuisines should use OR logic');
        assert.ok(searchCall.params.includes('%sushi%'), 'Should bind first cuisine');
        assert.ok(searchCall.params.includes('%japanese%'), 'Should bind second cuisine');
      });

      it('should accept a single cuisine string', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Kitchen',
          poiTypes: ['restaurant'],
          cuisine: 'thai',
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('p.cuisine ILIKE'));
        assert.ok(searchCall, 'Should include cuisine ILIKE clause');
        assert.ok(searchCall.params.includes('%thai%'), 'Should bind single cuisine string');
      });

      it('should map dietary filters to parameterized OSM tag keys', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Kitchen',
          poiTypes: ['restaurant'],
          dietary: ['vegan', 'vegetarian', 'halal', 'kosher', 'gluten_free'],
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes("p.tags->>$"));
        assert.ok(searchCall, 'Should include parameterized tag lookups');
        assert.ok(searchCall.params.includes('diet:vegan'), 'Should bind vegan tag key');
        assert.ok(searchCall.params.includes('diet:vegetarian'), 'Should bind vegetarian tag key');
        assert.ok(searchCall.params.includes('diet:halal'), 'Should bind halal tag key');
        assert.ok(searchCall.params.includes('diet:kosher'), 'Should bind kosher tag key');
        assert.ok(searchCall.params.includes('diet:gluten_free'), 'Should bind gluten-free tag key');
        assert.ok(!searchCall.sql.includes('diet:vegan'), 'Tag keys should not be interpolated into SQL');
      });

      it('should map amenity filters to index-friendly OSM tag checks', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Grand Hotel',
          poiTypes: ['hotel'],
          amenities: ['wifi', 'pool', 'breakfast', 'air_conditioning', 'parking'],
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('p.tags ? $'));
        assert.ok(searchCall, 'Should include JSONB key-existence checks');
        assert.ok(searchCall.sql.includes('p.tags->>$'), 'Should reject explicit no values');
        assert.ok(searchCall.params.includes('internet_access'), 'Should bind wifi tag key');
        assert.ok(searchCall.params.includes('swimming_pool'), 'Should bind pool tag key');
        assert.ok(searchCall.params.includes('breakfast'), 'Should bind breakfast tag key');
        assert.ok(searchCall.params.includes('air_conditioning'), 'Should bind air conditioning tag key');
        assert.ok(searchCall.params.includes('parking'), 'Should bind parking tag key');
        assert.ok(!searchCall.sql.includes('internet_access'), 'Tag keys should not be interpolated into SQL');
      });
    });

    describe('Case 2: Location only search', () => {
      it('should search by city name', async () => {
        // Mock city lookup
        mockPool.setResponse('geonames_cities', dbResult([{
          geoname_id: 1609350,
          name: 'Bangkok',
          latitude: 13.75,
          longitude: 100.5,
          population: 8000000,
        }]));
        // Mock POI search near coordinates
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          cityName: 'Bangkok',
          countryCode: 'TH'
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by coordinates', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          latitude: 13.75,
          longitude: 100.5
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by zero latitude/longitude coordinates', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          latitude: 0,
          longitude: 0,
        });

        assert.ok(Array.isArray(results));
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('ST_DWithin'));
        assert.ok(searchCall, 'Should use coordinate search for zero values');
        assert.ok(searchCall.params.includes(0), 'Should pass zero coordinate values');
      });

      it('should return empty array when city not found', async () => {
        mockPool.setResponse('geonames_cities', emptyResult());

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          cityName: 'NonexistentCity',
          countryCode: 'XX'
        });

        assert.ok(Array.isArray(results));
        assert.strictEqual(results.length, 0);
      });
    });

    describe('Case 3: Name + Location combined', () => {
      it('should search by name and city', async () => {
        // Mock city lookup
        mockPool.setResponse('geonames_cities', dbResult([{
          geoname_id: 1609350,
          name: 'Bangkok',
          latitude: 13.75,
          longitude: 100.5,
          population: 8000000,
        }]));
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand Hotel',
          cityName: 'Bangkok',
          countryCode: 'TH'
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by name and coordinates', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand Hotel',
          latitude: 13.75,
          longitude: 100.5,
          radius: 10
        });

        assert.ok(Array.isArray(results));
      });
    });

    describe('Error cases', () => {
      it('should throw error when no search criteria provided', async () => {
        db = new TravelDatabase({ pool: mockPool });

        await assert.rejects(
          async () => db.searchPOIs({}),
          /Must provide either name, cityName, or coordinates/
        );
      });
    });
  });

  describe('searchPOIsNearCoordinates', () => {
    it('should search POIs near coordinates', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(13.75, 100.5, 10);

      assert.ok(Array.isArray(results));
      assert.ok(mockPool.wasCalled('ST_DWithin'));
    });

    it('should filter by type', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['hotel'], 50
      );

      assert.ok(Array.isArray(results));
    });

    it('should respect limit parameter', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, null, 5
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.params?.includes(5)
      );
      assert.ok(searchCall, 'Should pass limit to query');
    });

    it('should exclude specified OSM IDs', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, null, 50, null, [12345]
      );

      assert.ok(Array.isArray(results));
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('osm_id != ALL')
      );
      assert.ok(searchCall, 'Should include osm_id != ALL clause');
      assert.ok(searchCall.params.some(p => Array.isArray(p) && p.includes(12345)),
        'Should pass excludeOsmIds array as parameter');
    });

    it('should not include exclude clause when excludeOsmIds is null', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(13.75, 100.5, 10);

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin')
      );
      assert.ok(searchCall, 'Should have ST_DWithin query');
      assert.ok(!searchCall.sql.includes('osm_id != ALL'),
        'Should NOT include exclude clause when param is null');
    });

    it('should handle fractional radius (non-integer km)', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 1.5, null, 5
      );

      assert.ok(Array.isArray(results));
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin')
      );
      assert.ok(searchCall, 'Should have ST_DWithin query');
      assert.ok(searchCall.params.includes(1.5),
        'Should pass fractional radius as parameter');
      assert.ok(searchCall.sql.includes('::float8'),
        'Should cast radius to float8 to handle non-integer values');
    });

    it('should pass both typeFilter and excludeOsmIds together', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 1.5, ['restaurant', 'cafe'], 5, null, [12345]
      );

      assert.ok(Array.isArray(results));
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin')
      );
      assert.ok(searchCall.sql.includes('poi_type = ANY'),
        'Should include type filter');
      assert.ok(searchCall.sql.includes('osm_id != ALL'),
        'Should include exclude clause');
      // Verify parameter ordering: [lat, lon, radius, typeFilter, excludeOsmIds, limit]
      assert.strictEqual(searchCall.params[0], 13.75, 'First param should be latitude');
      assert.strictEqual(searchCall.params[1], 100.5, 'Second param should be longitude');
      assert.strictEqual(searchCall.params[2], 1.5, 'Third param should be radius');
      assert.deepStrictEqual(searchCall.params[3], ['restaurant', 'cafe'], 'Fourth param should be type filter');
      assert.deepStrictEqual(searchCall.params[4], [12345], 'Fifth param should be excludeOsmIds');
      assert.strictEqual(searchCall.params[5], 5, 'Sixth param should be limit');
    });

    it('should add cuisine filters to coordinate searches', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant'], 20, null, null, { cuisine: ['thai', 'japanese'] }
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes('p.cuisine ILIKE')
      );
      assert.ok(searchCall, 'Should include cuisine filter in coordinate query');
      assert.ok(searchCall.params.includes('%thai%'), 'Should bind thai cuisine');
      assert.ok(searchCall.params.includes('%japanese%'), 'Should bind japanese cuisine');
    });

    it('should add dietary filters to coordinate searches', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant'], 20, null, null, { dietary: ['vegan', 'kosher'] }
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes("p.tags->>$")
      );
      assert.ok(searchCall, 'Should include dietary filter in coordinate query');
      assert.ok(searchCall.params.includes('diet:vegan'), 'Should bind vegan tag key');
      assert.ok(searchCall.params.includes('diet:kosher'), 'Should bind kosher tag key');
    });

    it('should over-fetch coordinate searches when filtering by open_at', async () => {
      mockPool.setResponse('osm_pois', dbResult([
        { ...samplePOIs[1], osm_opening_hours: 'Mo-Su 10:00-22:00' },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant'], 20, null, null, null, false, 10, new Date(2026, 4, 18, 12, 0)
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes('p.opening_hours as osm_opening_hours')
      );
      assert.ok(searchCall, 'Should select OSM opening_hours for fallback filtering');
      assert.strictEqual(searchCall.params.at(-2), 60, 'Should over-fetch for post-filtering');
      assert.strictEqual(searchCall.params.at(-1), 0, 'Should reset offset when post-filtering by hours');
    });

    it('should filter by Google hours first and OSM opening_hours as fallback', () => {
      db = new TravelDatabase({ pool: mockPool });
      const openAt = new Date(2026, 4, 18, 12, 0);

      const results = db.filterOpenAt([
        {
          osm_id: 1,
          google_opening_hours: {
            periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
          },
          google_utc_offset_minutes: 0,
          osm_opening_hours: 'Mo-Fr 00:00-01:00',
        },
        {
          osm_id: 2,
          google_opening_hours: null,
          google_utc_offset_minutes: null,
          osm_opening_hours: 'Mo-Fr 10:00-22:00',
        },
        {
          osm_id: 3,
          google_opening_hours: null,
          google_utc_offset_minutes: null,
          osm_opening_hours: null,
        },
      ], openAt);

      assert.deepStrictEqual(results.map(p => p.osm_id), [1, 2]);
    });
  });

  describe('getPOIDetails', () => {
    const samplePOIDetail = {
      osm_id: 12345,
      poi_type: 'hotel',
      osm_name: 'Grand Hotel Bangkok',
      google_name: 'Grand Hotel Bangkok',
      osm_latitude: 13.75,
      osm_longitude: 100.5,
      city: 'Bangkok',
      country_code: 'TH',
      google_place_id: 'ChIJ123',
      google_rating: 4.5,
      google_review_count: 1200,
      mapping_status: 'active',
    };

    it('should get POI details by OSM ID', async () => {
      mockPool.setResponse('enriched_pois', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.strictEqual(result.osm_id, 12345);
    });

    it('should get POI details by Google Place ID', async () => {
      mockPool.setResponse('google_place_id', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(null, 'ChIJ123');

      assert.ok(result);
    });

    it('should return null when POI not found', async () => {
      mockPool.setResponse('enriched_pois', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(99999);

      assert.strictEqual(result, null);
    });

    it('should return null when no ID provided', async () => {
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails();

      assert.strictEqual(result, null);
    });

    it('should include enrichment status for active mapping', async () => {
      mockPool.setResponse('enriched_pois', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result._enrichment, 'Should have _enrichment object');
      assert.strictEqual(result._enrichment.status, 'complete');
    });

    it('should report pending enrichment status', async () => {
      const pendingPOI = { ...samplePOIDetail, mapping_status: 'pending', mapped_at: new Date() };
      mockPool.setResponse('enriched_pois', dbResult([pendingPOI]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result._enrichment, 'Should have _enrichment object');
      assert.strictEqual(result._enrichment.status, 'pending');
      assert.ok(result._enrichment.message?.includes('in progress'));
    });

    it('should not repeatedly restart stale pending enrichment while polling', async () => {
      const stalePendingPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: 'pending',
        mapped_at: new Date(Date.now() - 10 * 60 * 1000),
      };
      mockPool.setResponse('enriched_pois', dbResult([stalePendingPOI]));

      db = new TravelDatabase({ pool: mockPool });
      db.enrichOSMPOI = async () => {};

      const first = await db.getPOIDetails(12345);
      await new Promise(resolve => setImmediate(resolve));
      const second = await db.getPOIDetails(12345);

      assert.strictEqual(first._enrichment.status, 'pending');
      assert.ok(first._enrichment.message?.includes('restarted'));
      assert.strictEqual(second._enrichment.status, 'pending');
      assert.ok(second._enrichment.message?.includes('in progress'));
      assert.strictEqual(mockPool.callCount('UPDATE osm_google_mappings SET mapped_at = CURRENT_TIMESTAMP'), 1);
    });

    it('should not restart stale pending enrichment when daily quota is exhausted', async () => {
      const stalePendingPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: 'pending',
        mapped_at: new Date(Date.now() - 10 * 60 * 1000),
      };
      mockPool.setResponse('enriched_pois', dbResult([stalePendingPOI]));

      db = new TravelDatabase({ pool: mockPool });
      db.checkGoogleApiLimit = async () => ({ allowed: false, current: 500, limit: 500, remaining: 0 });

      const result = await db.getPOIDetails(12345);

      assert.strictEqual(result._enrichment.status, 'failed');
      assert.ok(result._enrichment.message?.includes('daily API limit'));
      assert.strictEqual(mockPool.callCount('UPDATE osm_google_mappings SET mapped_at = CURRENT_TIMESTAMP'), 0);
      const quotaCall = mockPool.getCalls().find(call =>
        call.sql.includes('INSERT INTO osm_google_mappings') &&
        call.params?.includes('error')
      );
      assert.ok(quotaCall, 'Should mark the mapping as error instead of pending');
    });

    it('should not start new enrichment when daily quota is exhausted', async () => {
      const unenrichedPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: null,
        mapped_at: null,
      };
      mockPool.setResponse('enriched_pois', dbResult([unenrichedPOI]));

      db = new TravelDatabase({ pool: mockPool });
      db.googlePlaces = { isEnabled: () => true };
      db.googlePlacesReady = Promise.resolve();
      db.checkGoogleApiLimit = async () => ({ allowed: false, current: 500, limit: 500, remaining: 0 });

      const result = await db.getPOIDetails(12345);

      assert.strictEqual(result._enrichment.status, 'failed');
      assert.ok(result._enrichment.message?.includes('daily API limit'));
      assert.strictEqual(mockPool.callCount("VALUES ($1, 'pending', CURRENT_TIMESTAMP)"), 0);
      const quotaCall = mockPool.getCalls().find(call =>
        call.sql.includes('INSERT INTO osm_google_mappings') &&
        call.params?.includes('error')
      );
      assert.ok(quotaCall, 'Should mark the mapping as error instead of pending');
    });

    it('should report failed enrichment for not_found status', async () => {
      const notFoundPOI = { ...samplePOIDetail, mapping_status: 'not_found', google_place_id: null };
      mockPool.setResponse('enriched_pois', dbResult([notFoundPOI]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result._enrichment, 'Should have _enrichment object');
      assert.strictEqual(result._enrichment.status, 'failed');
      assert.ok(result._enrichment.message?.includes('no matching location'));
    });

    it('should preserve Date fields (not convert to empty objects)', async () => {
      const enrichedAt = new Date('2025-06-15T12:00:00Z');
      const cacheExpires = new Date('2025-06-22T12:00:00Z');
      const poiWithDates = {
        ...samplePOIDetail,
        google_enriched_at: enrichedAt,
        google_cache_expires_at: cacheExpires,
        mapped_at: new Date('2025-06-15T11:00:00Z'),
      };
      mockPool.setResponse('enriched_pois', dbResult([poiWithDates]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result.google_enriched_at instanceof Date, 'google_enriched_at should remain a Date');
      assert.ok(result.google_cache_expires_at instanceof Date, 'google_cache_expires_at should remain a Date');
      assert.strictEqual(result.google_enriched_at.toISOString(), enrichedAt.toISOString());
      assert.strictEqual(result.google_cache_expires_at.toISOString(), cacheExpires.toISOString());
    });

    it('should remove null fields but preserve all non-null values', async () => {
      const poiWithNulls = {
        ...samplePOIDetail,
        osm_phone: null,
        osm_email: null,
        osm_website: 'https://example.com',
        google_rating: 4.5,
        osm_stars: 0,
      };
      mockPool.setResponse('enriched_pois', dbResult([poiWithNulls]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.strictEqual(result.osm_phone, undefined, 'Null fields should be removed');
      assert.strictEqual(result.osm_email, undefined, 'Null fields should be removed');
      assert.strictEqual(result.osm_website, 'https://example.com', 'Non-null strings should be preserved');
      assert.strictEqual(result.google_rating, 4.5, 'Numbers should be preserved');
      assert.strictEqual(result.osm_stars, 0, 'Falsy non-null values (0) should be preserved');
    });

    it('should preserve all field types through the full data pipeline', async () => {
      // Simulates a realistic enriched_pois row with every field type
      // that PostgreSQL/pg driver returns: strings, numbers, booleans,
      // Date objects, arrays, nested objects (JSONB), and nulls.
      const fullPOI = {
        // Core identifiers (integers, strings)
        osm_id: 12345,
        osm_type: 'node',
        poi_type: 'restaurant',

        // OSM string fields
        osm_name: 'Thai Kitchen',
        osm_address: '789 Silom Road, Bangkok',
        osm_phone: '+66 2 345 6789',
        osm_email: 'info@thaikitchen.com',
        osm_website: 'https://thaikitchen.com',
        osm_opening_hours: 'Mo-Su 10:00-22:00',
        osm_cuisine: 'thai;international',
        osm_wheelchair: 'yes',
        osm_brand: 'Thai Kitchen',
        osm_operator: null, // null - should be stripped
        source_region: 'thailand',

        // OSM numeric fields (including zero and falsy values)
        osm_latitude: 13.7450,
        osm_longitude: 100.5300,
        osm_stars: 0, // falsy but valid
        osm_rooms: null, // null - should be stripped
        osm_beds: null, // null - should be stripped

        // OSM JSONB (nested object)
        osm_tags: { brand: 'Thai Kitchen', cuisine: 'thai;international', name: 'Thai Kitchen' },

        // OSM Date
        osm_imported_at: new Date('2025-01-15T10:00:00Z'),

        // City/country strings
        city: 'Bangkok',
        country_code: 'TH',
        city_geoname_id: 1609350,

        // Google Places string fields
        google_place_id: 'ChIJ456',
        google_name: 'Thai Kitchen Restaurant',
        google_display_name: { text: 'Thai Kitchen Restaurant', languageCode: 'en' }, // JSONB object
        google_address: '789 Silom Road, Bang Rak, Bangkok 10500',
        google_short_address: '789 Silom Road',
        google_international_phone: '+66 2 345 6789',
        google_phone: '02-345-6789',
        google_website: 'https://thaikitchen.com',
        google_maps_url: 'https://maps.google.com/?cid=123456',
        google_primary_type: 'restaurant',
        google_primary_type_display: 'Restaurant',
        google_editorial_summary: 'Authentic Thai cuisine in the heart of Silom.',
        google_price_level: 'PRICE_LEVEL_MODERATE',
        google_business_status: 'OPERATIONAL',
        google_plus_code: '7P52PG9R+5W',

        // Google Places numeric fields
        google_rating: 4.3,
        google_review_count: 850,
        google_latitude: 13.7451,
        google_longitude: 100.5301,
        google_utc_offset_minutes: 420,

        // Google Places JSONB arrays
        google_types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
        google_photos: [
          { name: 'places/ChIJ456/photos/abc', heightPx: 1200, widthPx: 1600 },
          { name: 'places/ChIJ456/photos/def', heightPx: 800, widthPx: 1200 },
        ],
        google_reviews: [
          {
            authorAttribution: { displayName: 'John Doe', uri: 'https://maps.google.com/user1' },
            rating: 5,
            text: { text: 'Best Thai food in Bangkok!' },
            relativePublishTimeDescription: '2 weeks ago',
          },
          {
            authorAttribution: { displayName: 'Jane Smith' },
            rating: 4,
            text: { text: 'Great pad thai and green curry.' },
            relativePublishTimeDescription: '1 month ago',
          },
        ],
        google_address_components: [
          { longText: '789', shortText: '789', types: ['street_number'] },
          { longText: 'Silom Road', shortText: 'Silom Rd', types: ['route'] },
        ],

        // Google Places JSONB objects
        google_opening_hours: {
          openNow: true,
          weekdayDescriptions: ['Monday: 10:00–22:00', 'Tuesday: 10:00–22:00'],
        },
        google_current_opening_hours: { openNow: true },
        google_service_options: { dineIn: true, takeout: true, delivery: false },
        google_accessibility: { wheelchairAccessibleEntrance: true, wheelchairAccessibleSeating: true },
        google_amenities: {
          restroom: true,
          goodForChildren: true,
          paymentOptions: { acceptsCreditCards: true },
        },

        // Google Places Date fields
        google_enriched_at: new Date('2025-06-15T12:00:00Z'),
        google_cache_expires_at: new Date('2025-06-22T12:00:00Z'),

        // Mapping metadata (strings, numbers, Date)
        mapping_status: 'active',
        match_confidence: 0.95,
        match_method: 'name_proximity',
        match_distance_meters: 12.5,
        mapping_notes: null, // null - should be stripped
        mapped_at: new Date('2025-06-15T11:59:00Z'),
        last_verified_at: new Date('2025-06-15T12:00:00Z'),
      };

      mockPool.setResponse('enriched_pois', dbResult([fullPOI]));
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result, 'Should return a result');

      // Strings preserved
      assert.strictEqual(result.osm_name, 'Thai Kitchen');
      assert.strictEqual(result.osm_cuisine, 'thai;international');
      assert.strictEqual(result.google_editorial_summary, 'Authentic Thai cuisine in the heart of Silom.');
      assert.strictEqual(result.google_place_id, 'ChIJ456');

      // Numbers preserved (including zero)
      assert.strictEqual(result.google_rating, 4.3);
      assert.strictEqual(result.google_review_count, 850);
      assert.strictEqual(result.osm_stars, 0, 'Zero should be preserved');
      assert.strictEqual(result.match_confidence, 0.95);
      assert.strictEqual(result.match_distance_meters, 12.5);
      assert.strictEqual(result.google_utc_offset_minutes, 420);

      // Null fields stripped
      assert.strictEqual(result.osm_operator, undefined, 'Null string should be stripped');
      assert.strictEqual(result.osm_rooms, undefined, 'Null number should be stripped');
      assert.strictEqual(result.mapping_notes, undefined, 'Null should be stripped');

      // Date objects preserved as Dates (not empty objects)
      assert.ok(result.google_enriched_at instanceof Date, 'google_enriched_at should be Date');
      assert.ok(result.google_cache_expires_at instanceof Date, 'google_cache_expires_at should be Date');
      assert.ok(result.osm_imported_at instanceof Date, 'osm_imported_at should be Date');
      assert.ok(result.mapped_at instanceof Date, 'mapped_at should be Date');
      assert.ok(result.last_verified_at instanceof Date, 'last_verified_at should be Date');
      assert.strictEqual(result.google_enriched_at.toISOString(), '2025-06-15T12:00:00.000Z');

      // Arrays preserved
      assert.ok(Array.isArray(result.google_types), 'google_types should be array');
      assert.strictEqual(result.google_types.length, 4);
      assert.strictEqual(result.google_types[0], 'restaurant');
      assert.ok(Array.isArray(result.google_photos), 'google_photos should be array');
      assert.strictEqual(result.google_photos.length, 2);
      assert.ok(Array.isArray(result.google_reviews), 'google_reviews should be array');
      assert.strictEqual(result.google_reviews.length, 2);
      assert.ok(Array.isArray(result.google_address_components), 'google_address_components should be array');

      // Nested objects preserved with structure intact
      assert.strictEqual(typeof result.google_display_name, 'object');
      assert.strictEqual(result.google_display_name.text, 'Thai Kitchen Restaurant');
      assert.strictEqual(result.google_display_name.languageCode, 'en');

      assert.strictEqual(typeof result.google_opening_hours, 'object');
      assert.strictEqual(result.google_opening_hours.openNow, true);
      assert.ok(Array.isArray(result.google_opening_hours.weekdayDescriptions));

      assert.strictEqual(typeof result.google_service_options, 'object');
      assert.strictEqual(result.google_service_options.dineIn, true);
      assert.strictEqual(result.google_service_options.delivery, false, 'Boolean false should be preserved');

      assert.strictEqual(typeof result.google_amenities, 'object');
      assert.strictEqual(result.google_amenities.restroom, true);
      assert.strictEqual(result.google_amenities.paymentOptions.acceptsCreditCards, true, 'Deeply nested values should be preserved');

      assert.strictEqual(typeof result.osm_tags, 'object');
      assert.strictEqual(result.osm_tags.brand, 'Thai Kitchen');

      // Nested objects inside arrays preserved
      assert.strictEqual(result.google_reviews[0].authorAttribution.displayName, 'John Doe');
      assert.strictEqual(result.google_reviews[0].rating, 5);
      assert.strictEqual(result.google_reviews[0].text.text, 'Best Thai food in Bangkok!');
      assert.strictEqual(result.google_photos[0].name, 'places/ChIJ456/photos/abc');

      // Enrichment metadata added
      assert.ok(result._enrichment, 'Should have _enrichment');
      assert.strictEqual(result._enrichment.status, 'complete');
    });
  });

  describe('addFavoriteStatus', () => {
    it('should return POIs unchanged when no userId', async () => {
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.addFavoriteStatus(samplePOIs, null);

      assert.deepStrictEqual(result, samplePOIs);
    });

    it('should return POIs unchanged when empty array', async () => {
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.addFavoriteStatus([], 'user123');

      assert.deepStrictEqual(result, []);
    });

    it('should add favorite status to POIs', async () => {
      mockPool.setResponse('user_favorites', dbResult([
        { poi_osm_id: 12345, created_at: new Date(), notes: 'Great hotel!' }
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.addFavoriteStatus(samplePOIs, 'user123');

      assert.strictEqual(result[0].is_favorite, true);
      assert.strictEqual(result[0].favorite_notes, 'Great hotel!');
      assert.strictEqual(result[1].is_favorite, false);
    });
  });

  describe('getCityByName', () => {
    it('should return city when found', async () => {
      mockPool.setResponse('geonames_cities', dbResult([{
        geoname_id: 1609350,
        name: 'Bangkok',
        latitude: 13.75,
        longitude: 100.5,
      }]));

      db = new TravelDatabase({ pool: mockPool });
      const city = await db.getCityByName('Bangkok', 'TH');

      assert.ok(city);
      assert.strictEqual(city.name, 'Bangkok');
    });

    it('should return null when city not found', async () => {
      mockPool.setResponse('geonames_cities', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const city = await db.getCityByName('Nonexistent', 'XX');

      assert.strictEqual(city, null);
    });
  });

  describe('getRandomPOI', () => {
    const samplePOIDetail = {
      osm_id: 12345,
      poi_type: 'hotel',
      osm_name: 'Random Hotel',
      osm_latitude: 13.75,
      osm_longitude: 100.5,
      city: 'Bangkok',
      country_code: 'TH',
      google_place_id: 'ChIJ123',
      mapping_status: 'active',
    };

    it('should return random POI with Google enrichment', async () => {
      // Mock finding an enriched POI (now queries osm_google_mappings directly)
      mockPool.setResponse('osm_google_mappings', dbResult([{ osm_id: 12345 }]));
      // Mock getPOIDetails call
      mockPool.setResponse('WHERE osm_id', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.ok(result);
      assert.strictEqual(result.osm_id, 12345);
    });

    it('should fallback to non-enriched POI if no enriched ones exist', async () => {
      // First query returns empty (no enriched POIs via osm_google_mappings)
      mockPool.setResponse('mapping_status', emptyResult());
      // Fallback query finds a non-enriched POI
      mockPool.setResponse('osm_pois', dbResult([{ osm_id: 99999 }]));
      // getPOIDetails for that POI
      const noEnrichmentPOI = { ...samplePOIDetail, osm_id: 99999, google_place_id: null };
      mockPool.setResponse('WHERE osm_id', dbResult([noEnrichmentPOI]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.ok(result);
      assert.strictEqual(result.osm_id, 99999);
    });

    it('should return null when no POIs exist', async () => {
      mockPool.setResponse('osm_google_mappings', emptyResult());
      mockPool.setResponse('osm_pois', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.strictEqual(result, null);
    });
  });
});
