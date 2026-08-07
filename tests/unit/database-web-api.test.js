/**
 * Unit tests for database user-management methods and Google quota handling.
 *
 * Tests getUserByToken, upsertGoogleUser, createUserToken, getUserConfig, and setUserConfig.
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
    const { db, pool } = createTestDb({
      'user_tokens': dbResult([
        {
          id: 1,
          google_id: 'g123',
          email: 'test@test.com',
          name: 'Test User',
          picture_url: 'https://example.com/pic.jpg',
          created_at: new Date('2025-01-01'),
          last_login_at: new Date('2025-06-01'),
          token_id: 42,
          config_key: 'theme',
          config_value: 'dark',
        },
        {
          id: 1,
          google_id: 'g123',
          email: 'test@test.com',
          name: 'Test User',
          picture_url: 'https://example.com/pic.jpg',
          created_at: new Date('2025-01-01'),
          last_login_at: new Date('2025-06-01'),
          token_id: 42,
          config_key: 'language',
          config_value: 'en',
        },
      ]),
      'UPDATE user_tokens': dbResult([]),
    });

    const user = await db.getUserByToken('valid-token');

    assert.strictEqual(user.email, 'test@test.com');
    assert.strictEqual(user.name, 'Test User');
    assert.strictEqual(user.config.theme, 'dark');
    assert.strictEqual(user.config.language, 'en');
    assert.strictEqual(user.token_id, undefined, 'Should not expose token_id');

    const calls = pool.getCalls();
    assert.ok(calls[0].sql.includes('t.token_hash = $1'), 'Should look up the token by hash first');
    assert.notStrictEqual(calls[0].params[0], 'valid-token', 'Hash lookup must not use the plaintext token as the primary key');
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
    const { db, pool } = createTestDb({
      'INSERT INTO user_tokens': dbResult([{
        id: 1, token: 'generated-token', name: 'My Token',
        created_at: new Date(),
      }]),
    });

    const result = await db.createUserToken(1, 'My Token');

    assert.strictEqual(result.name, 'My Token');
    assert.ok(result.token, 'Should have a token value');

    const calls = pool.getCalls();
    assert.ok(calls[0].sql.includes('token_hash'), 'New tokens should be stored by hash');
    assert.strictEqual(calls[0].params.length, 4);
    assert.notStrictEqual(calls[0].params[1], result.token, 'Plaintext token should not be inserted');
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
    assert.match(calls[0].params[2], /^[a-f0-9]{8}$/, 'Token prefix should be stored with hashed tokens');
    assert.strictEqual(calls[0].params[3], null, 'Token name should default to null');
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

// =============================================================================
// Google API Quota (atomic)
// =============================================================================

describe('consumeGoogleApiQuota', () => {
  it('should return allowed=true when under limit', async () => {
    const { db } = createTestDb({
      // getConfigCached will query config table — return default
      'FROM config': emptyResult(),
      // The atomic INSERT...ON CONFLICT RETURNING succeeds
      'INSERT INTO google_api_usage': dbResult([{ call_count: 5 }]),
    });

    const result = await db.consumeGoogleApiQuota();

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.current, 5);
    assert.strictEqual(result.limit, 100); // DEFAULT_GOOGLE_API_DAILY_LIMIT
    assert.strictEqual(result.remaining, 95);
  });

  it('should return allowed=false when at limit', async () => {
    const { db } = createTestDb({
      'FROM config': emptyResult(),
      // INSERT...ON CONFLICT returns no rows (WHERE clause blocked it)
      'INSERT INTO google_api_usage': emptyResult(),
      // Fallback SELECT to get current count
      'SELECT call_count FROM google_api_usage': dbResult([{ call_count: 100 }]),
    });

    const result = await db.consumeGoogleApiQuota();

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.current, 100);
    assert.strictEqual(result.limit, 100);
    assert.strictEqual(result.remaining, 0);
  });
});
