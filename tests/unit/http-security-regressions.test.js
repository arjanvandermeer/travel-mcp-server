import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const indexHttp = fs.readFileSync(new URL('../../src/index-http.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8');

describe('HTTP security regressions', () => {
  it('does not keep authenticated MCP sessions alive after auth is removed', () => {
    assert.match(indexHttp, /currentUser\s*&&\s*!newUser/);
    assert.match(indexHttp, /Authentication required for this MCP session/);
    assert.match(indexHttp, /res\.writeHead\(401/);
  });

  it('prevents cross-user reuse of an existing MCP session id', () => {
    assert.match(indexHttp, /currentUser\.id !== newUser\.id/);
    assert.match(indexHttp, /bound to a different authenticated user/);
    assert.match(indexHttp, /res\.writeHead\(403/);
  });

  it('caps active MCP sessions and throttles new session creation', () => {
    assert.match(config, /SESSION_MAX_ACTIVE/);
    assert.match(config, /SESSION_CREATE_MAX_PER_WINDOW/);
    assert.match(indexHttp, /ensureSessionCapacity/);
    assert.match(indexHttp, /canCreateSession/);
    assert.match(indexHttp, /res\.writeHead\(429/);
    assert.match(indexHttp, /res\.writeHead\(503/);
  });

  it('does not include bearer token prefixes in auth logs or telemetry', () => {
    assert.doesNotMatch(indexHttp, /tokenPrefix/);
    assert.doesNotMatch(indexHttp, /token prefix/i);
  });
});
