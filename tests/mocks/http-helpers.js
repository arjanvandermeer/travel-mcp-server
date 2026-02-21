/**
 * Shared HTTP test helpers for faking requests and responses.
 * Used by api-router unit tests and api-endpoints integration tests.
 */

import { EventEmitter } from 'node:events';

/**
 * Create a fake HTTP request (GET/DELETE — no body)
 */
export function fakeReq(method, url, { headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  process.nextTick(() => req.emit('end'));
  return req;
}

/**
 * Create a fake HTTP request with a JSON body (POST/PUT/PATCH)
 */
export function fakePostReq(method, url, body, { headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json', ...headers };
  process.nextTick(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

/**
 * Create a fake HTTP response that captures status, headers, and body
 */
export function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      this.headersSent = true;
    },
    end(data) { this.body = data || ''; },
    setHeader(k, v) { this.headers[k] = v; },
    json() { return JSON.parse(this.body); },
  };
}
