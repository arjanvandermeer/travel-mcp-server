/**
 * Integration Tests for Nearby POIs Feature
 *
 * Tests the get_nearby_pois / get_nearby_pois_ui tool handlers,
 * fetchNearbyForPOI helper, and renderNearbyWidget.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TravelDatabase } from '../../src/database.js';
import { executeToolHandler, fetchNearbyForPOI, getNearbyTypes, accommodationTypes, foodTypes } from '../../src/tools-config.js';
import { createMockDatabase } from '../mocks/db-mock.js';
import { dbResult, emptyResult } from '../fixtures/sample-data.js';

// Sample POI data
const hotelPOI = {
  osm_id: 10001,
  poi_type: 'hotel',
  osm_name: 'Grand Hotel Bangkok',
  osm_latitude: 13.75,
  osm_longitude: 100.5,
  city: 'Bangkok',
  country_code: 'TH',
  google_place_id: 'ChIJ_hotel',
  google_rating: 4.5,
};

const restaurantPOI = {
  osm_id: 20001,
  poi_type: 'restaurant',
  osm_name: 'Thai Kitchen',
  name: 'Thai Kitchen',
  osm_latitude: 13.751,
  osm_longitude: 100.501,
  city: 'Bangkok',
  country_code: 'TH',
  google_rating: 4.2,
  osm_cuisine: 'thai',
};

const cafePOI = {
  osm_id: 20002,
  poi_type: 'cafe',
  name: 'Bean There',
  osm_latitude: 13.752,
  osm_longitude: 100.502,
  city: 'Bangkok',
  country_code: 'TH',
  google_rating: 4.0,
};

const nearbyResults = [restaurantPOI, cafePOI];

describe('Nearby POIs Feature', () => {
  let mockPool;
  let db;

  beforeEach(() => {
    mockPool = createMockDatabase({}, { throwOnUnmatched: false });
    mockPool.setResponse('server_base_url', dbResult([{ value: 'https://example.com' }]));
    mockPool.setResponse('google_places_api_key', dbResult([{ value: 'test-fake-api-key' }]));
    mockPool.setResponse('google_places_enabled', dbResult([{ value: 'true' }]));
  });

  describe('fetchNearbyForPOI', () => {
    it('should return nearby POIs for a hotel', async () => {
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      const { nearbyPois, nearbyTitle } = await fetchNearbyForPOI(hotelPOI, db);

      assert.ok(Array.isArray(nearbyPois), 'Should return array');
      assert.strictEqual(nearbyTitle, 'Nearby Restaurants & Cafes');
      // Verify the query used foodTypes for a hotel
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c => c.sql.includes('ST_DWithin'));
      assert.ok(searchCall, 'Should call searchPOIsNearCoordinates');
    });

    it('should return nearby hotels for a restaurant', async () => {
      mockPool.setResponse('ST_DWithin', dbResult([hotelPOI]));
      db = new TravelDatabase({ pool: mockPool });

      const { nearbyPois, nearbyTitle } = await fetchNearbyForPOI(restaurantPOI, db);

      assert.ok(Array.isArray(nearbyPois));
      assert.strictEqual(nearbyTitle, 'Nearby Hotels');
    });

    it('should return null when POI has no coordinates', async () => {
      db = new TravelDatabase({ pool: mockPool });
      const poiNoCoords = { ...hotelPOI, osm_latitude: null, osm_longitude: null };

      const { nearbyPois, nearbyTitle } = await fetchNearbyForPOI(poiNoCoords, db);

      assert.strictEqual(nearbyPois, null);
      assert.strictEqual(nearbyTitle, null);
    });

    it('should exclude the source POI from results', async () => {
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      await fetchNearbyForPOI(hotelPOI, db);

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('ST_DWithin') && c.sql.includes('osm_id != ALL')
      );
      assert.ok(searchCall, 'Should include exclude clause');
      assert.ok(
        searchCall.params.some(p => Array.isArray(p) && p.includes(hotelPOI.osm_id)),
        'Should exclude source POI osm_id'
      );
    });

    it('should use 1.5km radius and limit of 10', async () => {
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      await fetchNearbyForPOI(hotelPOI, db);

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c => c.sql.includes('ST_DWithin'));
      assert.ok(searchCall.params.includes(1.5), 'Should use 1.5km radius');
      assert.ok(searchCall.params.includes(10), 'Should use limit of 10');
    });

    it('should pass userId when provided', async () => {
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      mockPool.setResponse('user_favorites', emptyResult());
      db = new TravelDatabase({ pool: mockPool });

      await fetchNearbyForPOI(hotelPOI, db, 'user-123');

      // userId is passed to addFavoriteStatus internally
      const calls = mockPool.getCalls();
      const favCall = calls.find(c => c.sql.includes('user_favorites'));
      assert.ok(favCall, 'Should query favorites when userId is provided');
    });
  });

  describe('get_nearby_pois tool handler', () => {
    it('should return nearby POIs as JSON', async () => {
      // Mock getPOIDetails response (single row from enriched_pois WHERE osm_id =)
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      // Mock searchPOIsNearCoordinates response
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois', { osm_id: 10001 }, db);

      assert.ok(!result.isError, 'Should not be an error');
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.source.osm_id, 10001);
      assert.ok(Array.isArray(data.nearby));
      assert.strictEqual(data.count, 2);
    });

    it('should return error when osm_id is missing', async () => {
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois', {}, db);

      assert.strictEqual(result.isError, true);
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.error, 'osm_id is required');
    });

    it('should return error when POI not found', async () => {
      mockPool.setResponse('ST_DWithin', emptyResult());
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois', { osm_id: 99999 }, db);

      assert.strictEqual(result.isError, true);
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.error, 'POI not found');
    });

    it('should respect custom result_types', async () => {
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      mockPool.setResponse('ST_DWithin', dbResult([cafePOI]));
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois', {
        osm_id: 10001,
        result_types: ['cafe'],
      }, db);

      assert.ok(!result.isError);
      const data = JSON.parse(result.content[0].text);
      assert.deepStrictEqual(data.result_types, ['cafe']);
    });

    it('should cap radius_km at 10', async () => {
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois', {
        osm_id: 10001,
        radius_km: 50,
      }, db);

      assert.ok(!result.isError);
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.radius_km, 10);
    });

    it('should cap limit at 20', async () => {
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois', {
        osm_id: 10001,
        limit: 100,
      }, db);

      assert.ok(!result.isError);
      // Check that the limit passed to the query was capped at 20
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('ST_DWithin') && c.sql.includes('LIMIT')
      );
      assert.ok(searchCall.params.includes(20), 'Limit should be capped at 20');
    });

    it('should use default nearby types for hotel', async () => {
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois', { osm_id: 10001 }, db);

      assert.ok(!result.isError);
      const data = JSON.parse(result.content[0].text);
      assert.deepStrictEqual(data.result_types, foodTypes,
        'Should default to food types for hotel source');
    });
  });

  describe('get_nearby_pois_ui tool handler', () => {
    it('should return structuredContent with HTML', async () => {
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois_ui', { osm_id: 10001 }, db);

      assert.ok(!result.isError);
      assert.ok(result.structuredContent, 'Should have structuredContent');
      assert.ok(result.structuredContent._html, 'Should have _html');
      assert.ok(result.structuredContent._html.includes('nearby-scroll'),
        'HTML should contain nearby-scroll container');
      assert.strictEqual(result.structuredContent.count, 2);
    });

    it('should include nearby POI names in HTML', async () => {
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      mockPool.setResponse('ST_DWithin', dbResult(nearbyResults));
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois_ui', { osm_id: 10001 }, db);

      assert.ok(result.structuredContent._html.includes('Thai Kitchen'),
        'HTML should contain nearby restaurant name');
    });

    it('should render empty state when no nearby POIs found', async () => {
      mockPool.setResponse('WHERE osm_id', dbResult([hotelPOI]));
      mockPool.setResponse('ST_DWithin', emptyResult());
      db = new TravelDatabase({ pool: mockPool });

      const result = await executeToolHandler('get_nearby_pois_ui', { osm_id: 10001 }, db);

      assert.ok(!result.isError);
      assert.strictEqual(result.structuredContent.count, 0);
      assert.ok(result.structuredContent._html.includes('No nearby places found'),
        'Should show empty state in HTML');
    });
  });
});
