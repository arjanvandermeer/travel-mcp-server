/**
 * Unit tests for database web API methods and user management methods
 *
 * Tests listCountriesWithData, listStatesForCountry, autocompleteSearch,
 * getUserByToken, upsertGoogleUser, createUserToken, getUserConfig, setUserConfig
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMockDatabase } from '../mocks/db-mock.js';
import { dbResult, emptyResult } from '../fixtures/sample-data.js';
import TravelDatabase from '../../src/database.js';

/**
 * Create a TravelDatabase instance backed by a mock pool
 */
function createTestDb(responses = {}) {
  const pool = createMockDatabase(responses);
  const db = new TravelDatabase();
  db.pool = pool;
  return { db, pool };
}

// =============================================================================
// Web Frontend API Methods
// =============================================================================

describe('listCountriesWithData', () => {
  it('should return countries from query result', async () => {
    const { db } = createTestDb({
      'geonames_countries': dbResult([
        { code: 'TH', name: 'Thailand', continent: 'AS' },
        { code: 'JP', name: 'Japan', continent: 'AS' },
      ]),
    });

    const result = await db.listCountriesWithData();

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].code, 'TH');
    assert.strictEqual(result[1].code, 'JP');
  });

  it('should return empty array when no countries have data', async () => {
    const { db } = createTestDb({
      'geonames_countries': emptyResult(),
    });

    const result = await db.listCountriesWithData();

    assert.deepStrictEqual(result, []);
  });
});

describe('listStatesForCountry', () => {
  it('should return states for given country code', async () => {
    const { db, pool } = createTestDb({
      'geonames_admin1_codes': dbResult([
        { code: '10', name: 'Bangkok', ascii_name: 'Bangkok' },
        { code: '50', name: 'Chiang Mai', ascii_name: 'Chiang Mai' },
      ]),
    });

    const result = await db.listStatesForCountry('th');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'Bangkok');
    // Verify country code was uppercased
    const calls = pool.getCalls();
    assert.strictEqual(calls[0].params[0], 'TH');
  });

  it('should return empty array for country with no states', async () => {
    const { db } = createTestDb({
      'geonames_admin1_codes': emptyResult(),
    });

    const result = await db.listStatesForCountry('XX');

    assert.deepStrictEqual(result, []);
  });
});

describe('autocompleteSearch', () => {
  it('should build query with name filter', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([
        { osm_id: 123, name: 'Grand Palace Hotel', poi_type: 'hotel', google_rating: 4.5, city: 'Bangkok', country_code: 'TH' },
      ]),
    });

    const result = await db.autocompleteSearch('grand');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'Grand Palace Hotel');
    // Verify ILIKE pattern was passed
    const calls = pool.getCalls();
    assert.strictEqual(calls[0].params[0], '%grand%');
  });

  it('should include country filter when countryCode provided', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([]),
    });

    await db.autocompleteSearch('test', { countryCode: 'th' });

    const calls = pool.getCalls();
    assert.ok(calls[0].params.includes('TH'), 'Should uppercase country code');
    assert.ok(calls[0].sql.includes('c.country_code'), 'Should include country condition');
  });

  it('should include city filter when cityGeonameId provided', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([]),
    });

    await db.autocompleteSearch('test', { cityGeonameId: 456 });

    const calls = pool.getCalls();
    assert.ok(calls[0].params.includes(456), 'Should include city geoname_id');
    assert.ok(calls[0].sql.includes('nearest_city_id'), 'Should include city condition');
  });

  it('should include poi type filter when poiType provided', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([]),
    });

    await db.autocompleteSearch('test', { poiType: 'restaurant' });

    const calls = pool.getCalls();
    assert.ok(calls[0].params.includes('restaurant'), 'Should include poi type');
    assert.ok(calls[0].sql.includes('poi_type'), 'Should include type condition');
  });

  it('should apply all filters together', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([]),
    });

    await db.autocompleteSearch('test', {
      countryCode: 'JP',
      cityGeonameId: 789,
      poiType: 'hotel',
      limit: 5,
    });

    const calls = pool.getCalls();
    const params = calls[0].params;
    assert.strictEqual(params[0], '%test%');
    assert.strictEqual(params[1], 'JP');
    assert.strictEqual(params[2], 789);
    assert.strictEqual(params[3], 'hotel');
    assert.strictEqual(params[4], 5);
  });

  it('should cap limit at 50', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([]),
    });

    await db.autocompleteSearch('test', { limit: 100 });

    const calls = pool.getCalls();
    const limitParam = calls[0].params[calls[0].params.length - 1];
    assert.strictEqual(limitParam, 50);
  });

  it('should default limit to 10', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([]),
    });

    await db.autocompleteSearch('test');

    const calls = pool.getCalls();
    const limitParam = calls[0].params[calls[0].params.length - 1];
    assert.strictEqual(limitParam, 10);
  });

  it('should escape ILIKE wildcard characters in query', async () => {
    const { db, pool } = createTestDb({
      'osm_pois': dbResult([]),
    });

    await db.autocompleteSearch('100%_match\\test');

    const calls = pool.getCalls();
    assert.strictEqual(calls[0].params[0], '%100\\%\\_match\\\\test%',
      'Should escape %, _, and \\ in user query');
  });
});

// =============================================================================
// User Management Methods
// =============================================================================

describe('getUserByToken', () => {
  it('should return null for empty token', async () => {
    const { db } = createTestDb();

    assert.strictEqual(await db.getUserByToken(null), null);
    assert.strictEqual(await db.getUserByToken(''), null);
    assert.strictEqual(await db.getUserByToken(undefined), null);
  });

  it('should return null for invalid token', async () => {
    const { db } = createTestDb({
      'user_tokens': emptyResult(),
    });

    const result = await db.getUserByToken('invalid-token');

    assert.strictEqual(result, null);
  });

  it('should return user with config for valid token', async () => {
    const { db } = createTestDb({
      'user_tokens': dbResult([{
        id: 1,
        google_id: 'g123',
        email: 'test@test.com',
        name: 'Test User',
        picture_url: 'https://example.com/pic.jpg',
        created_at: new Date('2025-01-01'),
        last_login_at: new Date('2025-06-01'),
        token_id: 42,
      }]),
      'UPDATE user_tokens': dbResult([]),
      'user_config': dbResult([
        { key: 'theme', value: 'dark' },
        { key: 'language', value: 'en' },
      ]),
    });

    const user = await db.getUserByToken('valid-token');

    assert.strictEqual(user.email, 'test@test.com');
    assert.strictEqual(user.name, 'Test User');
    assert.strictEqual(user.config.theme, 'dark');
    assert.strictEqual(user.config.language, 'en');
    assert.strictEqual(user.token_id, undefined, 'Should not expose token_id');
  });

  it('should update last_used_at for the token', async () => {
    const { db, pool } = createTestDb({
      'user_tokens': dbResult([{
        id: 1, google_id: 'g1', email: 'a@b.com', name: 'A',
        picture_url: null, created_at: new Date(), last_login_at: new Date(),
        token_id: 10,
      }]),
      'UPDATE user_tokens': dbResult([]),
      'user_config': emptyResult(),
    });

    await db.getUserByToken('tok');

    assert.ok(pool.wasCalled('UPDATE user_tokens'), 'Should update last_used_at');
  });
});

describe('upsertGoogleUser', () => {
  it('should insert new user and return with config', async () => {
    const { db } = createTestDb({
      'INSERT INTO users': dbResult([{
        id: 1, google_id: 'g123', email: 'new@test.com',
        name: 'New User', picture_url: null,
        created_at: new Date(), last_login_at: new Date(),
      }]),
      'user_config': emptyResult(),
    });

    const user = await db.upsertGoogleUser('g123', 'new@test.com', 'New User', null);

    assert.strictEqual(user.email, 'new@test.com');
    assert.deepStrictEqual(user.config, {});
  });

  it('should handle email conflict by updating existing user', async () => {
    const emailConflictError = new Error('duplicate key');
    emailConflictError.code = '23505';
    emailConflictError.constraint = 'users_email_key';

    const { db } = createTestDb({
      'INSERT INTO users': emailConflictError,
      'UPDATE users': dbResult([{
        id: 5, google_id: 'g456', email: 'existing@test.com',
        name: 'Updated User', picture_url: 'https://pic.url',
        created_at: new Date(), last_login_at: new Date(),
      }]),
      'user_config': dbResult([
        { key: 'lang', value: 'ja' },
      ]),
    });

    const user = await db.upsertGoogleUser('g456', 'existing@test.com', 'Updated User', 'https://pic.url');

    assert.strictEqual(user.id, 5);
    assert.strictEqual(user.config.lang, 'ja');
  });

  it('should re-throw non-email-conflict errors', async () => {
    const otherError = new Error('connection failed');
    otherError.code = '08001';

    const { db } = createTestDb({
      'INSERT INTO users': otherError,
    });

    await assert.rejects(
      () => db.upsertGoogleUser('g789', 'e@t.com', 'X', null),
      { message: 'connection failed' }
    );
  });
});

describe('createUserToken', () => {
  it('should create token and return result', async () => {
    const { db } = createTestDb({
      'INSERT INTO user_tokens': dbResult([{
        id: 1, token: 'generated-token', name: 'My Token',
        created_at: new Date(),
      }]),
    });

    const result = await db.createUserToken(1, 'My Token');

    assert.strictEqual(result.name, 'My Token');
    assert.ok(result.token, 'Should have a token value');
  });

  it('should work without token name', async () => {
    const { db, pool } = createTestDb({
      'INSERT INTO user_tokens': dbResult([{
        id: 2, token: 'tok', name: null, created_at: new Date(),
      }]),
    });

    const result = await db.createUserToken(1);

    assert.strictEqual(result.name, null);
    const calls = pool.getCalls();
    assert.strictEqual(calls[0].params[2], null, 'Token name should default to null');
  });
});

describe('getUserConfig', () => {
  it('should return config value when found', async () => {
    const { db } = createTestDb({
      'user_config': dbResult([{ value: 'dark' }]),
    });

    const result = await db.getUserConfig(1, 'theme');

    assert.strictEqual(result, 'dark');
  });

  it('should return null when config key not found', async () => {
    const { db } = createTestDb({
      'user_config': emptyResult(),
    });

    const result = await db.getUserConfig(1, 'nonexistent');

    assert.strictEqual(result, null);
  });
});

describe('setUserConfig', () => {
  it('should upsert config value', async () => {
    const { db, pool } = createTestDb({
      'INSERT INTO user_config': dbResult([]),
    });

    await db.setUserConfig(1, 'theme', 'dark');

    const calls = pool.getCalls();
    assert.ok(calls[0].sql.includes('ON CONFLICT'), 'Should use upsert');
    assert.deepStrictEqual(calls[0].params, [1, 'theme', 'dark']);
  });
});
