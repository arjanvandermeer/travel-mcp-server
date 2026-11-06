import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(root, relativePath));

describe('public web contract', () => {
  it('serves the direct POI document and only its required assets', () => {
    const source = read('src/index-http.js');
    const poiDocument = read('web/poi.html');

    assert.match(source, /\^\\\/poi\\\/\\d\+\$/);
    assert.match(source, /'\/js\/poi-app\.js'/);
    assert.match(source, /'\/js\/format-store\.js'/);
    assert.match(source, /getBrowserOAuthIssuer/);
    assert.match(poiDocument, /src="\/js\/poi-app\.js"/);
  });

  it('does not retain routes or source files for the retired SPA', () => {
    const source = read('src/index-http.js');
    for (const retiredAsset of ['/js/app.js', '/js/constants.js', '/js/map-utils.js', '/js/proximity.js']) {
      assert.doesNotMatch(source, new RegExp(retiredAsset.replaceAll('/', '\\/').replaceAll('.', '\\.')));
    }

    for (const retiredFile of ['web/index.html', 'web/js/app.js', 'web/js/constants.js', 'web/js/map-utils.js', 'web/js/proximity.js']) {
      assert.equal(exists(retiredFile), false, `${retiredFile} must stay deleted`);
    }
  });

  it('keeps the public documents self-contained and free of third-party scripts', () => {
    const home = read('public/index.html');
    const poi = read('web/poi.html');

    assert.match(home, /src="\/home\.js"/);
    assert.match(poi, /src="\/js\/poi-app\.js"/);
    assert.doesNotMatch(home, /<script[^>]+https?:/i);
    assert.doesNotMatch(poi, /<script[^>]+https?:/i);
  });

  it('keeps browser bearer sessions short-lived', () => {
    const poiClient = read('web/js/poi-app.js');

    assert.match(poiClient, /sessionStorage/);
    assert.doesNotMatch(poiClient, /refresh_token/);
    assert.doesNotMatch(poiClient, /refreshToken/);
  });

  it('allows the validated OAuth issuer in the PDP connection policy only', () => {
    const source = read('src/index-http.js');

    assert.match(source, /connect-src 'self'\$\{oauthIssuer/);
    assert.match(source, /normalizeOAuthIssuer/);
  });

  it('falls back to a random major UK city when browser geolocation is unavailable', () => {
    const homeClient = read('public/home.js');

    assert.match(homeClient, /const UK_MAJOR_CITIES/);
    assert.match(homeClient, /\{ name: 'London'/);
    assert.match(homeClient, /\{ name: 'Manchester'/);
    assert.match(homeClient, /startFallbackCitySearch/);
    assert.match(homeClient, /Showing restaurants in \$\{city\.name\}/);
  });
});
