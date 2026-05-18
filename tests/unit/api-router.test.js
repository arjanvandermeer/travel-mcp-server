/**
 * Tests for the API router (src/api-router.js)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { ApiRouter, sendJson, parseBody, parseCookies } from '../../src/api-router.js';
import { fakeReq, fakeRes } from '../mocks/http-helpers.js';

// Variant of fakeReq that supports a raw string body (for parseBody tests)
function fakeReqWithBody(method, url, { headers = {}, body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (body) {
    process.nextTick(() => {
      req.emit('data', body);
      req.emit('end');
    });
  } else {
    process.nextTick(() => req.emit('end'));
  }
  return req;
}

describe('ApiRouter', () => {
  let router;

  beforeEach(() => {
    router = new ApiRouter();
  });

  it('should match GET routes', async () => {
    let called = false;
    router.get('/api/v1/test', async (req, res) => {
      called = true;
      sendJson(res, 200, { ok: true });
    });

    const req = fakeReq('GET', '/api/v1/test');
    const res = fakeRes();
    const handled = await router.handle(req, res, {});

    assert.strictEqual(handled, true);
    assert.strictEqual(called, true);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true });
  });

  it('should extract path params', async () => {
    let capturedParams = null;
    router.get('/api/v1/poi/:osm_id', async (req, res, ctx) => {
      capturedParams = ctx.params;
      sendJson(res, 200, {});
    });

    const req = fakeReq('GET', '/api/v1/poi/12345');
    const res = fakeRes();
    await router.handle(req, res, {});

    assert.deepStrictEqual(capturedParams, { osm_id: '12345' });
  });

  it('should return 400 for malformed percent-encoding in path params', async () => {
    router.get('/api/v1/poi/:osm_id', async (req, res) => {
      sendJson(res, 200, {});
    });

    const req = fakeReq('GET', '/api/v1/poi/%E0%A4%A');
    const res = fakeRes();
    const handled = await router.handle(req, res, {});

    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().code, 'invalid_path_param');
  });

  it('should parse query string', async () => {
    let capturedQuery = null;
    router.get('/api/v1/search', async (req, res, ctx) => {
      capturedQuery = ctx.query;
      sendJson(res, 200, {});
    });

    const req = fakeReq('GET', '/api/v1/search?q=hello&limit=10');
    const res = fakeRes();
    await router.handle(req, res, {});

    assert.strictEqual(capturedQuery.q, 'hello');
    assert.strictEqual(capturedQuery.limit, '10');
  });

  it('should return false for unmatched routes', async () => {
    router.get('/api/v1/test', async () => {});

    const req = fakeReq('GET', '/api/v1/other');
    const res = fakeRes();
    const handled = await router.handle(req, res, {});

    assert.strictEqual(handled, false);
  });

  it('should not match wrong HTTP method', async () => {
    router.post('/api/v1/test', async () => {});

    const req = fakeReq('GET', '/api/v1/test');
    const res = fakeRes();
    const handled = await router.handle(req, res, {});

    assert.strictEqual(handled, false);
  });

  it('should handle errors in route handlers', async () => {
    router.get('/api/v1/fail', async () => {
      throw new Error('test error');
    });

    const req = fakeReq('GET', '/api/v1/fail');
    const res = fakeRes();
    const handled = await router.handle(req, res, {});

    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 500);
  });

  it('should pass context to handler', async () => {
    let capturedUser = null;
    router.get('/api/v1/me', async (req, res, ctx) => {
      capturedUser = ctx.user;
      sendJson(res, 200, {});
    });

    const req = fakeReq('GET', '/api/v1/me');
    const res = fakeRes();
    await router.handle(req, res, { user: { id: 1, email: 'test@test.com' } });

    assert.deepStrictEqual(capturedUser, { id: 1, email: 'test@test.com' });
  });
});

describe('parseCookies', () => {
  it('should parse cookie header', () => {
    const req = { headers: { cookie: 'session=abc123; theme=dark' } };
    const cookies = parseCookies(req);
    assert.strictEqual(cookies.session, 'abc123');
    assert.strictEqual(cookies.theme, 'dark');
  });

  it('should return empty object when no cookies', () => {
    const req = { headers: {} };
    const cookies = parseCookies(req);
    assert.deepStrictEqual(cookies, {});
  });

  it('should handle encoded cookie values', () => {
    const req = { headers: { cookie: 'name=hello%20world' } };
    const cookies = parseCookies(req);
    assert.strictEqual(cookies.name, 'hello world');
  });

  it('should skip malformed cookie values', () => {
    const req = { headers: { cookie: 'session=%E0%A4%A; theme=dark' } };
    const cookies = parseCookies(req);
    assert.strictEqual(cookies.session, undefined);
    assert.strictEqual(cookies.theme, 'dark');
  });
});

describe('parseBody', () => {
  it('should parse JSON body', async () => {
    const req = fakeReqWithBody('POST', '/test', { body: '{"osm_id": 123}' });
    const body = await parseBody(req);
    assert.deepStrictEqual(body, { osm_id: 123 });
  });

  it('should return empty object for empty body', async () => {
    const req = fakeReqWithBody('POST', '/test');
    const body = await parseBody(req);
    assert.deepStrictEqual(body, {});
  });

  it('should reject invalid JSON', async () => {
    const req = fakeReqWithBody('POST', '/test', { body: 'not json' });
    await assert.rejects(() => parseBody(req), { message: 'Invalid JSON body' });
  });

  it('should return 400 from routes when JSON body is invalid', async () => {
    const router = new ApiRouter();
    router.post('/api/v1/body', async (req, res) => {
      await parseBody(req);
      sendJson(res, 200, {});
    });

    const req = fakeReqWithBody('POST', '/api/v1/body', { body: 'not json' });
    const res = fakeRes();
    const handled = await router.handle(req, res, {});

    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().code, 'invalid_json');
  });

  it('should reject body exceeding 1MB', async () => {
    // Create a request that emits a body larger than 1MB in chunks
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = '/test';
    req.headers = {};
    req.destroy = () => {};

    const chunk = 'x'.repeat(256 * 1024); // 256KB per chunk
    process.nextTick(() => {
      req.emit('data', chunk); // 256KB
      req.emit('data', chunk); // 512KB
      req.emit('data', chunk); // 768KB
      req.emit('data', chunk); // 1024KB
      req.emit('data', chunk); // 1280KB — over the limit
      req.emit('end');
    });

    await assert.rejects(() => parseBody(req), { message: 'Request body too large' });
  });
});
