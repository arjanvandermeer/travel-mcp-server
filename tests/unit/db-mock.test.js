/**
 * Tests for the Mock Database Implementation
 *
 * These tests verify that our mock database works correctly,
 * so we can trust it when testing actual application code.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockDatabase, createTravelMockDatabase } from '../mocks/db-mock.js';
import { cities, dbResult, emptyResult } from '../fixtures/sample-data.js';

describe('createMockDatabase', () => {
  describe('query()', () => {
    it('should return configured response for exact match', async () => {
      const db = createMockDatabase({
        'SELECT * FROM cities': dbResult([cities.bangkok]),
      });

      const result = await db.query('SELECT * FROM cities');

      assert.strictEqual(result.rows.length, 1);
      assert.strictEqual(result.rows[0].name, 'Bangkok');
    });

    it('should return configured response for substring match', async () => {
      const db = createMockDatabase({
        'FROM cities': dbResult([cities.bangkok, cities.tokyo]),
      });

      const result = await db.query('SELECT id, name FROM cities WHERE country = $1');

      assert.strictEqual(result.rows.length, 2);
    });

    it('should return empty result for unmatched query', async () => {
      const db = createMockDatabase({});

      const result = await db.query('SELECT * FROM unknown_table');

      assert.deepStrictEqual(result, emptyResult());
    });

    it('should throw for unmatched query when throwOnUnmatched is true', async () => {
      const db = createMockDatabase({}, { throwOnUnmatched: true });

      await assert.rejects(
        () => db.query('SELECT * FROM unknown_table'),
        { message: /No mock response configured/ }
      );
    });

    it('should record query calls', async () => {
      const db = createMockDatabase({});

      await db.query('SELECT 1');
      await db.query('SELECT 2', [1, 2]);

      const calls = db.getCalls();
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].sql, 'SELECT 1');
      assert.deepStrictEqual(calls[1].params, [1, 2]);
    });

    it('should support function responses', async () => {
      const db = createMockDatabase({
        'SELECT * FROM cities WHERE id = $1': (sql, params) => {
          const id = params[0];
          if (id === 1) return dbResult([cities.bangkok]);
          if (id === 3) return dbResult([cities.tokyo]);
          return emptyResult();
        },
      });

      const result1 = await db.query('SELECT * FROM cities WHERE id = $1', [1]);
      const result2 = await db.query('SELECT * FROM cities WHERE id = $1', [3]);
      const result3 = await db.query('SELECT * FROM cities WHERE id = $1', [999]);

      assert.strictEqual(result1.rows[0].name, 'Bangkok');
      assert.strictEqual(result2.rows[0].name, 'Tokyo');
      assert.strictEqual(result3.rows.length, 0);
    });

    it('should throw when response is an Error', async () => {
      const db = createMockDatabase({
        'SELECT * FROM cities': new Error('Database connection failed'),
      });

      await assert.rejects(
        () => db.query('SELECT * FROM cities'),
        { message: 'Database connection failed' }
      );
    });
  });

  describe('connect()', () => {
    it('should return a client with query and release methods', async () => {
      const db = createMockDatabase({
        'SELECT 1': dbResult([{ one: 1 }]),
      });

      const client = await db.connect();

      assert.ok(typeof client.query === 'function');
      assert.ok(typeof client.release === 'function');

      const result = await client.query('SELECT 1');
      assert.strictEqual(result.rows[0].one, 1);

      client.release();
    });

    it('should record client queries in main call log', async () => {
      const db = createMockDatabase({});

      const client = await db.connect();
      await client.query('SELECT 1');
      await client.query('SELECT 2');
      client.release();

      const calls = db.getCalls();
      assert.strictEqual(calls.length, 2);
      assert.ok(calls[0].viaClient);
    });
  });

  describe('utility methods', () => {
    it('wasCalled() should detect if pattern was called', async () => {
      const db = createMockDatabase({});

      await db.query('SELECT * FROM cities');
      await db.query('INSERT INTO logs VALUES (1)');

      assert.ok(db.wasCalled('cities'));
      assert.ok(db.wasCalled('INSERT'));
      assert.ok(!db.wasCalled('DELETE'));
    });

    it('callCount() should count pattern occurrences', async () => {
      const db = createMockDatabase({});

      await db.query('SELECT * FROM cities');
      await db.query('SELECT * FROM cities WHERE id = 1');
      await db.query('SELECT * FROM countries');

      assert.strictEqual(db.callCount('cities'), 2);
      assert.strictEqual(db.callCount('countries'), 1);
      assert.strictEqual(db.callCount('hotels'), 0);
    });

    it('getLastCall() should return most recent call', async () => {
      const db = createMockDatabase({});

      await db.query('SELECT 1');
      await db.query('SELECT 2', ['param']);

      const lastCall = db.getLastCall();
      assert.strictEqual(lastCall.sql, 'SELECT 2');
      assert.deepStrictEqual(lastCall.params, ['param']);
    });

    it('clearCalls() should reset call history', async () => {
      const db = createMockDatabase({});

      await db.query('SELECT 1');
      await db.query('SELECT 2');
      assert.strictEqual(db.getCalls().length, 2);

      db.clearCalls();
      assert.strictEqual(db.getCalls().length, 0);
    });

    it('setResponse() should add response dynamically', async () => {
      const db = createMockDatabase({});

      // Initially no response
      let result = await db.query('SELECT * FROM new_table');
      assert.strictEqual(result.rows.length, 0);

      // Add response dynamically
      db.setResponse('new_table', dbResult([{ id: 1 }]));

      result = await db.query('SELECT * FROM new_table');
      assert.strictEqual(result.rows.length, 1);
    });
  });
});

describe('createTravelMockDatabase', () => {
  it('should return pre-configured responses for travel queries', async () => {
    const db = createTravelMockDatabase();

    const cities = await db.query('SELECT * FROM geonames_cities');
    const countries = await db.query('SELECT * FROM geonames_countries');
    const pois = await db.query('SELECT * FROM osm_pois');

    assert.ok(cities.rows.length > 0);
    assert.ok(countries.rows.length > 0);
    assert.ok(pois.rows.length > 0);
  });

  it('should handle INSERT queries', async () => {
    const db = createTravelMockDatabase();

    const result = await db.query('INSERT INTO some_table VALUES ($1)', [1]);

    assert.strictEqual(result.rowCount, 1);
    assert.ok(result.rows[0].id);
  });
});

describe('fixtures', () => {
  it('should have valid city data', () => {
    assert.ok(cities.bangkok);
    assert.strictEqual(cities.bangkok.country_code, 'TH');
    assert.ok(cities.bangkok.latitude > 0);
    assert.ok(cities.bangkok.longitude > 0);
  });

  it('dbResult() should create proper database result', () => {
    const result = dbResult([{ id: 1 }, { id: 2 }]);

    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rowCount, 2);
  });

  it('emptyResult() should create empty database result', () => {
    const result = emptyResult();

    assert.deepStrictEqual(result.rows, []);
    assert.strictEqual(result.rowCount, 0);
  });
});
