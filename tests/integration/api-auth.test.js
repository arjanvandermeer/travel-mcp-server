/**
 * Integration tests for auth endpoints (src/api/auth.js)
 * Tests /auth/login, /auth/callback, /auth/logout, /auth/me
 */

import { describe, it, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert';
import { ApiRouter } from '../../src/api-router.js';
import { registerAuthRoutes } from '../../src/api/auth.js';
import { fakeReq, fakeRes } from '../mocks/http-helpers.js';
import { Sentry } from '../../src/telemetry.js';

// Clean up Sentry handles so the test process can exit
after(async () => {
  await Sentry.close(1000);
});

function createAuthMockDb(overrides = {}) {
  return {
    getConfigCached: async (key) => {
      const configs = {
        oauth_issuer: 'https://oauth.example.com',
        web_oauth_client_id: 'test-client-id',
        ...overrides.configs,
      };
      return configs[key] || null;
    },
    getServerBaseUrl: async () => overrides.serverBaseUrl || 'http://localhost:3000',
    setConfig: async () => {},
    ...overrides,
  };
}

describe('GET /auth/me', () => {
  it('should return authenticated user info', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);

    const req = fakeReq('GET', '/auth/me');
    const res = fakeRes();
    await router.handle(req, res, {
      user: { email: 'alice@example.com', name: 'Alice', picture_url: 'https://example.com/pic.jpg' },
    });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.authenticated, true);
    assert.strictEqual(data.email, 'alice@example.com');
    assert.strictEqual(data.name, 'Alice');
    assert.strictEqual(data.picture_url, 'https://example.com/pic.jpg');
  });

  it('should return unauthenticated when no user', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);

    const req = fakeReq('GET', '/auth/me');
    const res = fakeRes();
    await router.handle(req, res, { user: null });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.authenticated, false);
    assert.ok(!data.email, 'Should not include email');
  });
});

describe('GET /auth/logout', () => {
  it('should redirect to / and clear session cookie', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);

    const req = fakeReq('GET', '/auth/logout');
    const res = fakeRes();
    await router.handle(req, res, {});

    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.Location, '/');
    assert.ok(res.headers['Set-Cookie'].includes('session=;'), 'Should clear session cookie');
    assert.ok(res.headers['Set-Cookie'].includes('Max-Age=0'), 'Should expire cookie');
    assert.ok(res.headers['Set-Cookie'].includes('HttpOnly'), 'Should be HttpOnly');
  });
});

describe('GET /auth/login', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return 500 when OAuth is not configured', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb({ configs: { oauth_issuer: null } });

    // Also clear env var if set
    const origEnv = process.env.OAUTH_ISSUER;
    delete process.env.OAUTH_ISSUER;

    const req = fakeReq('GET', '/auth/login');
    const res = fakeRes();
    await router.handle(req, res, { db });

    process.env.OAUTH_ISSUER = origEnv;

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.json().error, 'OAuth not configured');
  });

  it('should redirect to OAuth authorize URL with PKCE params', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb();

    const req = fakeReq('GET', '/auth/login');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 302);

    const location = new URL(res.headers.Location);
    assert.strictEqual(location.origin, 'https://oauth.example.com');
    assert.strictEqual(location.pathname, '/authorize');
    assert.strictEqual(location.searchParams.get('client_id'), 'test-client-id');
    assert.strictEqual(location.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/callback');
    assert.strictEqual(location.searchParams.get('response_type'), 'code');
    assert.strictEqual(location.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(location.searchParams.get('code_challenge'), 'Should have code_challenge');
    assert.ok(location.searchParams.get('state'), 'Should have state');
    assert.strictEqual(location.searchParams.get('scope'), 'openid profile email');
  });

  it('should dynamically register client when client_id is not cached', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);

    let setConfigKey, setConfigValue;
    const db = createAuthMockDb({
      configs: { oauth_issuer: 'https://oauth.example.com', web_oauth_client_id: null },
      setConfig: async (key, value) => { setConfigKey = key; setConfigValue = value; },
    });

    // Mock fetch for dynamic client registration
    globalThis.fetch = mock.fn(async (url) => {
      if (url === 'https://oauth.example.com/register') {
        return {
          ok: true,
          json: async () => ({ client_id: 'new-registered-client' }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const req = fakeReq('GET', '/auth/login');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(setConfigKey, 'web_oauth_client_id');
    assert.strictEqual(setConfigValue, 'new-registered-client');

    const location = new URL(res.headers.Location);
    assert.strictEqual(location.searchParams.get('client_id'), 'new-registered-client');
  });

  it('should return 500 when client registration fails', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);

    const db = createAuthMockDb({
      configs: { oauth_issuer: 'https://oauth.example.com', web_oauth_client_id: null },
    });

    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'Registration denied',
    }));

    const req = fakeReq('GET', '/auth/login');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.json().error, 'OAuth client registration failed');
  });
});

describe('GET /auth/callback', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return 400 when code is missing', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb();

    const req = fakeReq('GET', '/auth/callback?state=abc');
    const res = fakeRes();
    await router.handle(req, res, { db, query: { state: 'abc' } });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Missing code or state');
  });

  it('should return 400 when state is missing', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb();

    const req = fakeReq('GET', '/auth/callback?code=abc');
    const res = fakeRes();
    await router.handle(req, res, { db, query: { code: 'abc' } });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Missing code or state');
  });

  it('should return 400 for invalid/expired state', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb();

    const req = fakeReq('GET', '/auth/callback?code=authcode&state=nonexistent');
    const res = fakeRes();
    await router.handle(req, res, { db, query: { code: 'authcode', state: 'nonexistent' } });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Invalid or expired state');
  });

  it('should exchange code for token and set session cookie', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb();

    // Step 1: Trigger /auth/login to create a pending state
    const loginReq = fakeReq('GET', '/auth/login');
    const loginRes = fakeRes();
    await router.handle(loginReq, loginRes, { db });

    assert.strictEqual(loginRes.statusCode, 302);
    const loginUrl = new URL(loginRes.headers.Location);
    const state = loginUrl.searchParams.get('state');
    assert.ok(state, 'Login should generate a state');

    // Step 2: Mock token exchange
    globalThis.fetch = mock.fn(async (url) => {
      if (url === 'https://oauth.example.com/token') {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock-access-token-xyz' }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    // Step 3: Call /auth/callback with the state from login
    const callbackReq = fakeReq('GET', `/auth/callback?code=authcode123&state=${state}`);
    const callbackRes = fakeRes();
    await router.handle(callbackReq, callbackRes, {
      db,
      query: { code: 'authcode123', state },
    });

    assert.strictEqual(callbackRes.statusCode, 302);
    assert.strictEqual(callbackRes.headers.Location, '/');
    assert.ok(callbackRes.headers['Set-Cookie'].includes('session=mock-access-token-xyz'), 'Should set session cookie with access token');
    assert.ok(callbackRes.headers['Set-Cookie'].includes('HttpOnly'), 'Cookie should be HttpOnly');
    assert.ok(callbackRes.headers['Set-Cookie'].includes('SameSite=Lax'), 'Cookie should be SameSite=Lax');
  });

  it('should include Secure flag when serverBaseUrl is https', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb({ serverBaseUrl: 'https://mcp.example.com' });

    // Trigger login to create state
    const loginReq = fakeReq('GET', '/auth/login');
    const loginRes = fakeRes();
    await router.handle(loginReq, loginRes, { db });
    const state = new URL(loginRes.headers.Location).searchParams.get('state');

    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'secure-token' }),
    }));

    const callbackReq = fakeReq('GET', `/auth/callback?code=code&state=${state}`);
    const callbackRes = fakeRes();
    await router.handle(callbackReq, callbackRes, { db, query: { code: 'code', state } });

    assert.strictEqual(callbackRes.statusCode, 302);
    assert.ok(callbackRes.headers['Set-Cookie'].includes('Secure'), 'Should include Secure flag for HTTPS');
  });

  it('should return 500 when token exchange fails', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb();

    // Trigger login to create state
    const loginReq = fakeReq('GET', '/auth/login');
    const loginRes = fakeRes();
    await router.handle(loginReq, loginRes, { db });
    const state = new URL(loginRes.headers.Location).searchParams.get('state');

    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    }));

    const callbackReq = fakeReq('GET', `/auth/callback?code=badcode&state=${state}`);
    const callbackRes = fakeRes();
    await router.handle(callbackReq, callbackRes, { db, query: { code: 'badcode', state } });

    assert.strictEqual(callbackRes.statusCode, 500);
    assert.strictEqual(callbackRes.json().error, 'Token exchange failed');
  });

  it('should not allow state reuse (replay protection)', async () => {
    const router = new ApiRouter();
    registerAuthRoutes(router);
    const db = createAuthMockDb();

    // Trigger login to create state
    const loginReq = fakeReq('GET', '/auth/login');
    const loginRes = fakeRes();
    await router.handle(loginReq, loginRes, { db });
    const state = new URL(loginRes.headers.Location).searchParams.get('state');

    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'token1' }),
    }));

    // First callback - should succeed
    const cb1Req = fakeReq('GET', `/auth/callback?code=code1&state=${state}`);
    const cb1Res = fakeRes();
    await router.handle(cb1Req, cb1Res, { db, query: { code: 'code1', state } });
    assert.strictEqual(cb1Res.statusCode, 302);

    // Second callback with same state - should fail
    const cb2Req = fakeReq('GET', `/auth/callback?code=code2&state=${state}`);
    const cb2Res = fakeRes();
    await router.handle(cb2Req, cb2Res, { db, query: { code: 'code2', state } });
    assert.strictEqual(cb2Res.statusCode, 400);
    assert.strictEqual(cb2Res.json().error, 'Invalid or expired state');
  });
});
