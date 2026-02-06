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
    // Mock Google Places init (returns null key)
    mockPool.setResponse('google_places_api_key', emptyResult());
  });

  describe('searchPOIs', () => {
    describe('Case 1: Name search only', () => {
      it('should search POIs by name only', async () => {
        mockPool.setResponse('enriched_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand Hotel' });

        assert.ok(Array.isArray(results));
        assert.ok(mockPool.wasCalled('enriched_pois'));
        // Should have called with ILIKE pattern
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('enriched_pois') && c.params?.includes('%Grand Hotel%'));
        assert.ok(searchCall, 'Should search with ILIKE pattern');
      });

      it('should filter by country code when provided', async () => {
        mockPool.setResponse('enriched_pois', dbResult([samplePOIs[0]]));

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
        mockPool.setResponse('enriched_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand', poiType: 'hotel' });

        assert.ok(Array.isArray(results));
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('poi_type'));
        assert.ok(searchCall, 'Should filter by POI type');
      });

      it('should support multiple POI types', async () => {
        mockPool.setResponse('enriched_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand',
          poiTypes: ['hotel', 'restaurant']
        });

        assert.ok(Array.isArray(results));
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
        mockPool.setResponse('enriched_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          cityName: 'Bangkok',
          countryCode: 'TH'
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by coordinates', async () => {
        mockPool.setResponse('enriched_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          latitude: 13.75,
          longitude: 100.5
        });

        assert.ok(Array.isArray(results));
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
        mockPool.setResponse('enriched_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand Hotel',
          cityName: 'Bangkok',
          countryCode: 'TH'
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by name and coordinates', async () => {
        mockPool.setResponse('enriched_pois', dbResult([samplePOIs[0]]));

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
      mockPool.setResponse('enriched_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(13.75, 100.5, 10);

      assert.ok(Array.isArray(results));
      assert.ok(mockPool.wasCalled('ST_DWithin'));
    });

    it('should filter by type', async () => {
      mockPool.setResponse('enriched_pois', dbResult([samplePOIs[0]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['hotel'], 50
      );

      assert.ok(Array.isArray(results));
    });

    it('should respect limit parameter', async () => {
      mockPool.setResponse('enriched_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, null, 5
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('enriched_pois') &&
        c.params?.includes(5)
      );
      assert.ok(searchCall, 'Should pass limit to query');
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
      // Mock finding an enriched POI
      mockPool.setResponse('enriched_pois', dbResult([{ osm_id: 12345 }]));
      // Mock getPOIDetails call
      mockPool.setResponse('WHERE osm_id', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.ok(result);
      assert.strictEqual(result.osm_id, 12345);
    });

    it('should fallback to non-enriched POI if no enriched ones exist', async () => {
      // First query returns empty (no enriched POIs)
      mockPool.setResponse('google_place_id IS NOT NULL', emptyResult());
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
      mockPool.setResponse('enriched_pois', emptyResult());
      mockPool.setResponse('osm_pois', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.strictEqual(result, null);
    });
  });
});
