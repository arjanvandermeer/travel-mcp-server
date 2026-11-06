#!/usr/bin/env node

import assert from 'node:assert/strict';

const baseUrl = (process.env.RELEASE_SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const poiId = process.env.RELEASE_SMOKE_POI_ID || '1700165213';

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  const body = await response.text();
  assert.equal(response.status, 200, `GET ${path} returned ${response.status}`);
  return { response, body };
}

async function main() {
  const home = await request('/');
  assert.match(home.response.headers.get('content-type') || '', /text\/html/);
  assert.match(home.body, /src="\/home\.js\?v=/);
  assert.doesNotMatch(home.body, /\/js\/app\.js/);

  const poi = await request(`/poi/${encodeURIComponent(poiId)}`);
  assert.match(poi.response.headers.get('content-type') || '', /text\/html/);
  assert.match(poi.body, /id="poi-content"/);
  assert.match(poi.body, /src="\/js\/poi-app\.js\?v=/);

  await request('/home.js');
  await request('/js/poi-app.js');
  await request('/js/format-store.js');

  const auth = await fetch(`${baseUrl}/api/v1/auth/config`);
  assert.ok([200, 503].includes(auth.status), `OAuth configuration returned ${auth.status}`);

  const detail = await request(`/api/v1/poi/${encodeURIComponent(poiId)}`);
  assert.match(detail.response.headers.get('content-type') || '', /application\/json/);
  const data = JSON.parse(detail.body);
  assert.ok(data.osm_id || data.name || data.osm_name, 'POI detail response is missing place data');

  console.log(`Release smoke passed for ${baseUrl}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
