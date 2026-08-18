import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ApiRouter } from '../../src/api-router.js';
import { registerAuthRoutes } from '../../src/api/auth.js';
import { fakeReq, fakeRes } from '../mocks/http-helpers.js';

function createRouter() {
  const router = new ApiRouter();
  registerAuthRoutes(router);
  return router;
}

describe('browser auth API', () => {
  it('returns the configured HTTPS OAuth issuer', async () => {
    const router = createRouter();
    const req = fakeReq('GET', '/api/v1/auth/config');
    const res = fakeRes();
    await router.handle(req, res, {
      db: { getConfigCached: async key => key === 'oauth_issuer' ? 'https://login.example.com/path' : null },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), { oauth_issuer: 'https://login.example.com' });
  });

  it('does not expose a missing or unsafe OAuth issuer', async () => {
    const router = createRouter();
    const req = fakeReq('GET', '/api/v1/auth/config');
    const res = fakeRes();
    await router.handle(req, res, {
      db: { getConfigCached: async () => 'http://untrusted.example.com' },
    });

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.json().code, 'oauth_unavailable');
  });

  it('permits a localhost issuer for the documented development flow', async () => {
    const router = createRouter();
    const req = fakeReq('GET', '/api/v1/auth/config');
    const res = fakeRes();
    await router.handle(req, res, {
      db: { getConfigCached: async () => 'http://localhost:8787' },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), { oauth_issuer: 'http://localhost:8787' });
  });

  it('returns an anonymous profile without credentials', async () => {
    const router = createRouter();
    const req = fakeReq('GET', '/api/v1/auth/me');
    const res = fakeRes();
    await router.handle(req, res, {});

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), { authenticated: false });
  });

  it('returns only browser-safe authenticated profile fields', async () => {
    const router = createRouter();
    const req = fakeReq('GET', '/api/v1/auth/me');
    const res = fakeRes();
    await router.handle(req, res, {
      user: {
        id: 7,
        email: 'person@example.com',
        name: 'Person',
        picture_url: 'https://images.example.com/person.jpg',
        config: { admin: true },
        token: 'must-not-be-exposed',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), {
      authenticated: true,
      user: {
        id: 7,
        email: 'person@example.com',
        name: 'Person',
        picture_url: 'https://images.example.com/person.jpg',
      },
    });
  });
});
