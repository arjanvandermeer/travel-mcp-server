/**
 * Tests for the API router (src/api-router.js)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { ApiRouter, sendJson, parseBody, parseCookies } from '../../src/api-router.js';

// Helper: create a fake request object
function fakeReq(method, url, { headers = {}, body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  // Simulate body streaming
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

// Helper: create a fake response object
function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      this.headersSent = true;
    },
    end(data) {
      this.body = data || '';
    },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
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
});

describe('parseBody', () => {
  it('should parse JSON body', async () => {
    const req = fakeReq('POST', '/test', { body: '{"osm_id": 123}' });
    const body = await parseBody(req);
    assert.deepStrictEqual(body, { osm_id: 123 });
  });

  it('should return empty object for empty body', async () => {
    const req = fakeReq('POST', '/test');
    const body = await parseBody(req);
    assert.deepStrictEqual(body, {});
  });

  it('should reject invalid JSON', async () => {
    const req = fakeReq('POST', '/test', { body: 'not json' });
    await assert.rejects(() => parseBody(req), { message: 'Invalid JSON body' });
  });
});
