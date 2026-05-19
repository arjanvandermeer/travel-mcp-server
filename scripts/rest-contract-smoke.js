#!/usr/bin/env node

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { ApiRouter } from '../src/api-router.js';
import { registerAuthRoutes } from '../src/api/auth.js';
import { registerAutocompleteRoutes } from '../src/api/autocomplete.js';
import { registerCityOverviewRoutes } from '../src/api/city-overview.js';
import { registerCountryRoutes } from '../src/api/countries.js';
import { registerFavoritesRoutes } from '../src/api/favorites.js';
import { registerHomepageRoutes } from '../src/api/homepage.js';
import { registerMapRoutes } from '../src/api/map.js';
import { registerPOIRoutes } from '../src/api/poi.js';
import { registerSearchRoutes } from '../src/api/search.js';
import { createMockTravelDb } from './mock-travel-db.js';

function createRouter() {
  const router = new ApiRouter();
  registerCountryRoutes(router);
  registerSearchRoutes(router);
  registerAutocompleteRoutes(router);
  registerPOIRoutes(router);
  registerFavoritesRoutes(router);
  registerAuthRoutes(router);
  registerHomepageRoutes(router);
  registerMapRoutes(router);
  registerCityOverviewRoutes(router);
  return router;
}

function fakeReq(method, url, body) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.url = url;
  stream.headers = body === undefined ? {} : { 'content-type': 'application/json' };
  return stream;
}

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name.toLowerCase()] = value;
      }
    },
    end(chunk = '') {
      this.body += chunk;
    },
  };
  return res;
}

async function call(router, db, { method = 'GET', path, body, user = null }) {
  const req = fakeReq(method, path, body);
  const res = fakeRes();
  const handled = await router.handle(req, res, { db, user });
  return {
    handled,
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
    json: res.headers['content-type']?.includes('application/json') && res.body ? JSON.parse(res.body) : null,
  };
}

async function expectRoute(router, db, spec, validate = () => {}) {
  const result = await call(router, db, spec);
  assert.equal(result.handled, true, `${spec.method || 'GET'} ${spec.path} should match a registered route`);
  assert.ok(
    spec.expectedStatuses.includes(result.status),
    `${spec.method || 'GET'} ${spec.path} returned ${result.status}; expected ${spec.expectedStatuses.join(', ')}`,
  );
  validate(result);
}

async function main() {
  const router = createRouter();
  const db = createMockTravelDb();

  await expectRoute(router, db, { path: '/api/v1/countries', expectedStatuses: [200] }, result => {
    assert.ok(Array.isArray(result.json));
  });
  await expectRoute(router, db, { path: '/api/v1/states?country_code=GB', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/search/cities/random?min_pois=1', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/search/cities?country_code=GB&q=London', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/search/pois?q=hotel&limit=1', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/autocomplete?q=ho', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/homepage', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/map/pois?sw_lat=0&sw_lng=0&ne_lat=1&ne_lng=1', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/cities/GB/London/overview', expectedStatuses: [200] });
  await expectRoute(router, db, { path: '/api/v1/poi/0', expectedStatuses: [404] });
  await expectRoute(router, db, { path: '/api/v1/poi/0/nearby', expectedStatuses: [404] });

  await expectRoute(router, db, { path: '/api/v1/favorites', expectedStatuses: [401] });
  await expectRoute(router, db, { method: 'POST', path: '/api/v1/favorites', body: { osm_id: 0 }, expectedStatuses: [401] });
  await expectRoute(router, db, { method: 'PATCH', path: '/api/v1/favorites/0', body: { notes: 'smoke' }, expectedStatuses: [401] });
  await expectRoute(router, db, { method: 'DELETE', path: '/api/v1/favorites/0', expectedStatuses: [401] });

  await expectRoute(router, db, { path: '/auth/me', expectedStatuses: [200] }, result => {
    assert.equal(result.json.authenticated, false);
  });
  await expectRoute(router, db, { path: '/auth/logout', expectedStatuses: [302] });
  await expectRoute(router, db, { path: '/auth/callback', expectedStatuses: [400] });
  await expectRoute(router, db, { path: '/auth/login', expectedStatuses: [500] });

  const unknown = await call(router, db, { method: 'POST', path: '/api/v1/unknown-rest-smoke' });
  assert.equal(unknown.handled, false, 'unknown REST route should not match the API router');

  console.log('REST contract smoke passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
