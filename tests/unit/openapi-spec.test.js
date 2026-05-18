import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');
const apiDir = path.join(repoRoot, 'src/api');
const openapi = fs.readFileSync(path.join(repoRoot, 'doc/openapi.yaml'), 'utf8');

function openApiPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function registeredRoutes() {
  const routes = [];
  for (const filename of fs.readdirSync(apiDir).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(apiDir, filename), 'utf8');
    const matches = source.matchAll(/router\.(get|post|patch|delete)\('([^']+)'/g);
    for (const match of matches) {
      routes.push({
        method: match[1],
        path: openApiPath(match[2]),
        file: filename,
      });
    }
  }
  return routes;
}

function documentedApiRoutes() {
  const routes = [];
  const pathBlocks = openapi.matchAll(/^  (\/(?:api\/v1|auth)\/[^:\n]*):\n([\s\S]*?)(?=^  \/|^components:)/gm);
  for (const block of pathBlocks) {
    const routePath = block[1];
    const methods = block[2].matchAll(/^\s{4}(get|post|patch|delete):/gm);
    for (const method of methods) {
      routes.push({ method: method[1], path: routePath });
    }
  }
  return routes;
}

function operationBlock(spec, routePath, method) {
  const pathIndex = spec.indexOf(`  ${routePath}:`);
  assert.notStrictEqual(pathIndex, -1, `${routePath} should be documented`);
  const nextPathIndex = spec.indexOf('\n  /', pathIndex + 1);
  const pathBlock = spec.slice(pathIndex, nextPathIndex === -1 ? spec.length : nextPathIndex);
  const methodIndex = pathBlock.indexOf(`\n    ${method}:`);
  assert.notStrictEqual(methodIndex, -1, `${method.toUpperCase()} ${routePath} should be documented`);
  const nextMethodMatch = pathBlock.slice(methodIndex + 1).match(/\n    (get|post|patch|delete):/);
  return pathBlock.slice(methodIndex, nextMethodMatch ? methodIndex + 1 + nextMethodMatch.index : pathBlock.length);
}

describe('OpenAPI spec', () => {
  it('documents every route registered under src/api', () => {
    for (const route of registeredRoutes()) {
      operationBlock(openapi, route.path, route.method);
    }
  });

  it('does not advertise unimplemented API or auth routes', () => {
    const implemented = new Set(registeredRoutes().map(route => `${route.method} ${route.path}`));
    const advertisedButMissing = documentedApiRoutes()
      .map(route => `${route.method} ${route.path}`)
      .filter(route => !implemented.has(route));

    assert.deepStrictEqual(advertisedButMissing, []);
  });

  it('documents auth schemes and protected favorites operations', () => {
    assert.match(openapi, /bearerAuth:/);
    assert.match(openapi, /sessionCookie:/);

    for (const method of ['get', 'post']) {
      const block = operationBlock(openapi, '/api/v1/favorites', method);
      assert.match(block, /security:/, `${method.toUpperCase()} favorites should require auth`);
      assert.doesNotMatch(block, /\n        - \{\}/, `${method.toUpperCase()} favorites should not allow anonymous access`);
    }

    for (const method of ['patch', 'delete']) {
      const block = operationBlock(openapi, '/api/v1/favorites/{osm_id}', method);
      assert.match(block, /security:/, `${method.toUpperCase()} favorite should require auth`);
      assert.doesNotMatch(block, /\n        - \{\}/, `${method.toUpperCase()} favorite should not allow anonymous access`);
    }
  });

  it('publishes the spec through the HTTP server static route', () => {
    assert.match(openapi, /\/openapi\.yaml:/);
    const indexHttp = fs.readFileSync(path.join(repoRoot, 'src/index-http.js'), 'utf8');
    assert.match(indexHttp, /pathname === '\/openapi\.yaml'/);
    assert.match(indexHttp, /application\/yaml/);
  });
});
