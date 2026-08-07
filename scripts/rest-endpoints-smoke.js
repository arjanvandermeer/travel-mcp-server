#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = Number(process.env.REST_SMOKE_PORT || 3100);
const BASE_URL = `http://localhost:${PORT}`;

function defaultDatabaseUrl() {
  const url = new URL('postgresql://localhost:5432/travel');
  url.username = 'traveluser';
  url.password = ['travel', 'pass'].join('');
  return url.href;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`HTTP server exited early with code ${child.exitCode}\n${output.join('')}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${BASE_URL}/health\n${output.join('')}`);
}

async function request({ method = 'GET', path, body, expectedStatuses, headers = {}, redirect = 'manual' }) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect,
      signal: controller.signal,
    });

    assert.ok(
      expectedStatuses.includes(response.status),
      `${method} ${path} returned ${response.status}; expected ${expectedStatuses.join(', ')}`,
    );

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let json = null;
    if (contentType.includes('application/json') && text) {
      json = JSON.parse(text);
    }

    return { response, text, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function assertJsonRoute(spec, validate = () => {}) {
  const result = await request(spec);
  if (result.response.status >= 200 && result.response.status < 300) {
    assert.ok(result.json !== null, `${spec.method || 'GET'} ${spec.path} should return JSON`);
    validate(result.json);
  }
  return result;
}

async function smokeRestEndpoints() {
  await assertJsonRoute({ path: '/health', expectedStatuses: [200] }, json => {
    assert.equal(json.server, 'travel-mcp-server');
    assert.equal(json.endpoints.mcp, '/mcp');
  });
  await request({ method: 'HEAD', path: '/openapi.yaml', expectedStatuses: [200] });
  await request({ path: '/openapi.yaml', expectedStatuses: [200] });
  await assertJsonRoute({ path: '/.well-known/oauth-protected-resource', expectedStatuses: [200] }, json => {
    assert.ok(Array.isArray(json.authorization_servers), 'protected resource metadata should include authorization_servers');
  });

  await assertJsonRoute({ path: '/api/v1/search/cities?country_code=GB&q=London&limit=1', expectedStatuses: [200] }, json => {
    assert.ok(Array.isArray(json.results), 'city search should return results');
  });
  await assertJsonRoute({ path: '/api/v1/search/pois?q=__mcp_rest_smoke_no_match__&limit=1', expectedStatuses: [200] }, json => {
    assert.ok(Array.isArray(json.results), 'POI search should return results');
  });
  await assertJsonRoute({ path: '/api/v1/poi/0', expectedStatuses: [404] });
  await assertJsonRoute({ path: '/api/v1/poi/0/nearby', expectedStatuses: [404] });

  await assertJsonRoute({ path: '/api/v1/favorites', expectedStatuses: [401] });
  await assertJsonRoute({ method: 'POST', path: '/api/v1/favorites', body: { osm_id: 0 }, expectedStatuses: [401] });
  await assertJsonRoute({ method: 'PATCH', path: '/api/v1/favorites/0', body: { notes: 'smoke' }, expectedStatuses: [401] });
  await assertJsonRoute({ method: 'DELETE', path: '/api/v1/favorites/0', expectedStatuses: [401] });

  await request({ method: 'OPTIONS', path: '/api/v1/search/pois', expectedStatuses: [200] });
  await assertJsonRoute({ method: 'POST', path: '/api/v1/unknown-rest-smoke', expectedStatuses: [404] });
}

async function main() {
  assert.ok(fs.existsSync(new URL('../src/index-http.js', import.meta.url)), 'src/index-http.js should exist');

  const output = [];
  const child = spawn(process.execPath, ['src/index-http.js', String(PORT)], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: process.env.REST_SMOKE_DATABASE_URL || defaultDatabaseUrl(),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  try {
    await waitForHealth(child, output);
    await smokeRestEndpoints();
    console.log('REST endpoints smoke passed');
  } finally {
    child.kill('SIGTERM');
    await delay(250);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
