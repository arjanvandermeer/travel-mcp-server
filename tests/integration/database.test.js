/**
 * Integration Tests for TravelDatabase
 *
 * Tests database functions using mock database injection.
 * This validates the DI pattern works correctly.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TravelDatabase } from '../../src/database.js';
import { createMockDatabase } from '../mocks/db-mock.js';
import { dbResult, emptyResult, insertResult } from '../fixtures/sample-data.js';

describe('TravelDatabase with Mock Pool', () => {
  let db;
  let mockPool;

  beforeEach(() => {
    // Create fresh mock for each test
    mockPool = createMockDatabase({}, { throwOnUnmatched: false });
    // Mock Google Places config with fake key to suppress warnings
    mockPool.setResponse('google_places_api_key', dbResult([{ value: 'test-fake-api-key' }]));
    mockPool.setResponse('google_places_enabled', dbResult([{ value: 'true' }]));
  });

  describe('constructor', () => {
    it('should accept injected pool', () => {
      db = new TravelDatabase({ pool: mockPool });
      assert.ok(db.pool === mockPool);
    });

    it('should create default pool if none provided', () => {
      // This will try to create a real pool, which is fine for this test
      db = new TravelDatabase();
      assert.ok(db.pool !== undefined);
      // Clean up
      db.close().catch(() => {});
    });
  });

  describe('getConfig', () => {
    it('should return config value from database', async () => {
      mockPool.setResponse('SELECT value FROM app_config', dbResult([
        { value: 'https://example.com' }
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const value = await db.getConfig('server_base_url');

      assert.strictEqual(value, 'https://example.com');
      assert.ok(mockPool.wasCalled('SELECT value FROM app_config'));
    });

    it('should return default value when not found', async () => {
      mockPool.setResponse('SELECT value FROM app_config', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const value = await db.getConfig('missing_key', 'default_value');

      assert.strictEqual(value, 'default_value');
    });

    it('should return default when table does not exist', async () => {
      mockPool.setResponse('SELECT value FROM app_config',
        new Error('relation "app_config" does not exist'));

      db = new TravelDatabase({ pool: mockPool });
      const value = await db.getConfig('any_key', 'fallback');

      assert.strictEqual(value, 'fallback');
    });
  });

  describe('setConfig', () => {
    it('should upsert config value', async () => {
      mockPool.setResponse('INSERT INTO app_config', insertResult(1));

      db = new TravelDatabase({ pool: mockPool });
      await db.setConfig('test_key', 'test_value', 'Test description');

      assert.ok(mockPool.wasCalled('INSERT INTO app_config'));
      // Find the call that inserted the config
      const calls = mockPool.getCalls();
      const configCall = calls.find(c =>
        c.sql.includes('INSERT INTO app_config') &&
        c.params?.includes('test_key')
      );
      assert.ok(configCall, 'Should have called INSERT INTO app_config with test_key');
      assert.ok(configCall.params.includes('test_value'));
    });
  });

  describe('searchCities', () => {
    it('should search cities by query and country code', async () => {
      const mockCities = [
        {
          geoname_id: 1609350,
          name: 'Bangkok',
          country_code: 'TH',
          country_name: 'Thailand',
          population: 8305218,
          latitude: 13.75,
          longitude: 100.5,
        },
      ];

      mockPool.setResponse('SELECT', dbResult(mockCities));

      db = new TravelDatabase({ pool: mockPool });
      const cities = await db.searchCities({
        query: 'Bangkok',
        countryCode: 'TH',
        limit: 10,
      });

      assert.ok(Array.isArray(cities));
      assert.strictEqual(cities.length, 1);
      assert.strictEqual(cities[0].name, 'Bangkok');
      assert.ok(mockPool.wasCalled('geonames_cities'));
    });

    it('should search cities by coordinates', async () => {
      const mockCities = [
        {
          geoname_id: 1609350,
          name: 'Bangkok',
          country_code: 'TH',
          latitude: 13.75,
          longitude: 100.5,
          distance_km: 5.2,
        },
      ];

      mockPool.setResponse('SELECT', dbResult(mockCities));

      db = new TravelDatabase({ pool: mockPool });
      const cities = await db.searchCities({
        latitude: 13.75,
        longitude: 100.5,
        radiusKm: 50,
        limit: 10,
      });

      assert.ok(Array.isArray(cities));
      assert.strictEqual(cities[0].name, 'Bangkok');
    });

    it('should return empty array when no cities found', async () => {
      mockPool.setResponse('SELECT', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const cities = await db.searchCities({
        query: 'NonexistentCity',
        countryCode: 'XX',
      });

      assert.ok(Array.isArray(cities));
      assert.strictEqual(cities.length, 0);
    });
  });

  describe('getCityByGeonameId', () => {
    it('should return city by geoname ID', async () => {
      const mockCity = {
        geoname_id: 1609350,
        name: 'Bangkok',
        country_code: 'TH',
        population: 8305218,
      };

      mockPool.setResponse('geoname_id = $1', dbResult([mockCity]));

      db = new TravelDatabase({ pool: mockPool });
      const city = await db.getCityByGeonameId(1609350);

      assert.ok(city);
      assert.strictEqual(city.name, 'Bangkok');
    });

    it('should return null for unknown ID', async () => {
      mockPool.setResponse('geoname_id = $1', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const city = await db.getCityByGeonameId(999999);

      assert.strictEqual(city, null);
    });
  });

  describe('getStats', () => {
    it('should return database statistics', async () => {
      // Set up responses for all stat queries
      mockPool.setResponse('SELECT COUNT(*) FROM geonames_countries', dbResult([{ count: '195' }]));
      mockPool.setResponse('SELECT COUNT(*) FROM geonames_cities', dbResult([{ count: '140000' }]));
      mockPool.setResponse('SELECT COUNT(*) FROM osm_pois', dbResult([{ count: '50000' }]));
      mockPool.setResponse("poi_type = 'hotel'", dbResult([{ count: '5000' }]));
      mockPool.setResponse('SELECT COUNT(*) FROM regions', dbResult([{ count: '50' }]));
      mockPool.setResponse('GROUP BY poi_type', dbResult([
        { poi_type: 'hotel', count: '5000' },
        { poi_type: 'restaurant', count: '10000' },
      ]));
      mockPool.setResponse('GROUP BY country_code', dbResult([
        { country_code: 'TH', count: '8000' },
        { country_code: 'FR', count: '6000' },
      ]));
      mockPool.setResponse('FROM import_log', emptyResult());
      mockPool.setResponse('FROM osm_google_mappings', dbResult([{ total_enriched: '1000' }]));
      mockPool.setResponse('GROUP BY mapping_status', dbResult([
        { mapping_status: 'active', count: '1000' },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const stats = await db.getStats();

      assert.strictEqual(stats.countries, 195);
      assert.strictEqual(stats.cities, 140000);
      assert.strictEqual(stats.pois, 50000);
      assert.ok(Array.isArray(stats.pois_by_type));
    });
  });

  describe('startImport / completeImport / failImport', () => {
    it('should create and complete an import record', async () => {
      mockPool.setResponse('INSERT INTO import_log', dbResult([{ id: 123 }]));
      mockPool.setResponse('UPDATE import_log', insertResult(1));

      db = new TravelDatabase({ pool: mockPool });

      const importId = await db.startImport('osm_all', {
        sourceFile: 'thailand.osm.pbf',
        regionName: 'thailand',
      });
      assert.strictEqual(importId, 123);

      await db.completeImport(importId, 5000);
      assert.ok(mockPool.wasCalled('UPDATE import_log'));
    });

    it('should record failed import', async () => {
      mockPool.setResponse('INSERT INTO import_log', dbResult([{ id: 456 }]));
      mockPool.setResponse('UPDATE import_log', insertResult(1));

      db = new TravelDatabase({ pool: mockPool });

      const importId = await db.startImport('osm_all', {});
      await db.failImport(importId, 'Network error');

      const lastCall = mockPool.getLastCall();
      assert.ok(lastCall.sql.includes('UPDATE import_log'));
    });
  });

  describe('getImportHistory', () => {
    it('should return recent imports', async () => {
      const mockImports = [
        {
          id: 1,
          import_type: 'osm_all',
          region_name: 'thailand',
          status: 'completed',
          records_imported: 5000,
        },
        {
          id: 2,
          import_type: 'osm_hotel',
          region_name: 'france',
          status: 'completed',
          records_imported: 3000,
        },
      ];

      mockPool.setResponse('FROM import_log', dbResult(mockImports));

      db = new TravelDatabase({ pool: mockPool });
      const history = await db.getImportHistory(20);

      assert.strictEqual(history.length, 2);
      assert.strictEqual(history[0].region_name, 'thailand');
    });
  });

  describe('testConnection', () => {
    it('should test database connection', async () => {
      // Mock connect to return a client-like object
      const mockClient = {
        query: async () => ({ rows: [{ '?column?': 1 }] }),
        release: () => {},
      };
      mockPool.connect = async () => mockClient;

      db = new TravelDatabase({ pool: mockPool });
      await db.testConnection();

      // If we get here without error, connection test passed
      assert.ok(true);
    });
  });
});

describe('TravelDatabase helper functions', () => {
  describe('getRadiusForPopulation', () => {
    let db;

    beforeEach(() => {
      const mockPool = createMockDatabase({}, { throwOnUnmatched: false });
      db = new TravelDatabase({ pool: mockPool });
    });

    it('should return 30km for mega cities (>5M)', () => {
      assert.strictEqual(db.getRadiusForPopulation(10000000), 30);
      assert.strictEqual(db.getRadiusForPopulation(5000001), 30);
    });

    it('should return 20km for large cities (1-5M)', () => {
      assert.strictEqual(db.getRadiusForPopulation(3000000), 20);
      assert.strictEqual(db.getRadiusForPopulation(1000001), 20);
    });

    it('should return 15km for medium cities (500K-1M)', () => {
      assert.strictEqual(db.getRadiusForPopulation(750000), 15);
      assert.strictEqual(db.getRadiusForPopulation(500001), 15);
    });

    it('should return 10km for small cities (100K-500K)', () => {
      assert.strictEqual(db.getRadiusForPopulation(250000), 10);
      assert.strictEqual(db.getRadiusForPopulation(100001), 10);
    });

    it('should return 5km for towns (<100K)', () => {
      assert.strictEqual(db.getRadiusForPopulation(50000), 5);
      assert.strictEqual(db.getRadiusForPopulation(1000), 5);
    });
  });

  describe('calculateDistance', () => {
    let db;

    beforeEach(() => {
      const mockPool = createMockDatabase({}, { throwOnUnmatched: false });
      db = new TravelDatabase({ pool: mockPool });
    });

    it('should calculate distance between two points', () => {
      // Bangkok to Pattaya (~100km)
      const distance = db.calculateDistance(13.7563, 100.5018, 12.9236, 100.8825);
      // Should be approximately 100km (100,000 meters) with some tolerance
      assert.ok(distance > 90000 && distance < 110000,
        `Expected distance ~100km, got ${Math.round(distance / 1000)}km`);
    });

    it('should return 0 for same point', () => {
      const distance = db.calculateDistance(13.75, 100.50, 13.75, 100.50);
      assert.strictEqual(distance, 0);
    });
  });
});
