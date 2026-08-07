#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = Number(process.env.MCP_SMOKE_PORT || 3099);
const BASE_URL = `http://localhost:${PORT}`;
const MCP_URL = `${BASE_URL}/mcp`;
const PROTOCOL_VERSION = '2025-03-26';
const MCP_APP_HTML_MIME_TYPE = 'text/html;profile=mcp-app';

function assertInspectorScript() {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const script = pkg.scripts?.['inspect:http'] || '';

  assert.match(script, /--server-url\s+http:\/\/localhost:3000\/mcp/, 'inspect:http must preload the /mcp URL with --server-url');
  assert.doesNotMatch(script, /--url\b/, 'inspect:http must not use the ignored --url flag');
  assert.doesNotMatch(script, /localhost:3000\/sse/, 'inspect:http must not point the Inspector at /sse');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultDatabaseUrl() {
  const url = new URL('postgresql://localhost:5432/travel');
  url.username = 'traveluser';
  url.password = ['travel', 'pass'].join('');
  return url.href;
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

function parseSseJson(text) {
  const data = text
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.replace(/^data:\s?/, ''))
    .join('\n');

  assert.ok(data, `Expected an SSE data payload, got: ${text}`);
  return JSON.parse(data);
}

async function postRpc(payload, sessionId) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  assert.ok(response.ok, `RPC ${payload.method} failed with HTTP ${response.status}: ${text}`);

  return {
    sessionId: response.headers.get('mcp-session-id'),
    message: text ? parseSseJson(text) : null,
  };
}

async function assertRpcResult(method, sessionId, validate) {
  const { message } = await postRpc({ jsonrpc: '2.0', id: method, method, params: {} }, sessionId);
  assert.ifError(message.error);
  assert.ok(message.result, `${method} should return a result`);
  validate(message.result);
}

async function assertRpcResultWithParams(method, sessionId, params, validate) {
  const { message } = await postRpc({ jsonrpc: '2.0', id: method, method, params }, sessionId);
  assert.ifError(message.error);
  assert.ok(message.result, `${method} should return a result`);
  validate(message.result);
}

async function assertSseEndpointRejected() {
  const response = await fetch(`${BASE_URL}/sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  const text = await response.text();

  assert.equal(response.status, 404, 'POST /sse should not be a supported MCP endpoint');
  assert.match(text, /\/sse not found/i, 'POST /sse should explain that the path is not found');
  assert.match(text, /POST to \/mcp/i, 'POST /sse should point clients at /mcp');
}

async function main() {
  assertInspectorScript();

  const output = [];
  const child = spawn(process.execPath, ['src/index-http.js', String(PORT)], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: process.env.MCP_SMOKE_DATABASE_URL || defaultDatabaseUrl(),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  try {
    await waitForHealth(child, output);

    const initialized = await postRpc({
      jsonrpc: '2.0',
      id: 'initialize',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'mcp-inspector-smoke', version: '1.0.0' },
      },
    });
    assert.ifError(initialized.message.error);
    assert.equal(initialized.message.result.serverInfo.name, 'travel-mcp-server');

    const sessionId = initialized.sessionId;
    assert.ok(sessionId, 'initialize should return an mcp-session-id header');

    await postRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);

    await assertRpcResult('tools/list', sessionId, result => {
      assert.ok(Array.isArray(result.tools), 'tools/list should return tools');
      assert.ok(result.tools.length > 0, 'tools/list should return at least one tool');
      const appTool = result.tools.find(tool => tool.name === 'search_hotels_ui');
      assert.equal(
        appTool?._meta?.ui?.resourceUri,
        'ui://widget/search-results.html',
        'search_hotels_ui should declare an MCP Apps resource URI',
      );
      assert.ok(!result.tools.some(tool => tool.name === 'get_stats'), 'anonymous tools/list must hide admin tools');
      assert.ok(!result.tools.some(tool => tool.name === 'add_favorite'), 'anonymous tools/list must hide account tools');
    });
    await assertRpcResultWithParams('resources/read', sessionId, { uri: 'ui://widget/search-results.html' }, result => {
      assert.equal(result.contents.length, 1, 'MCP Apps resource reads should return exactly one content item');
      assert.equal(
        result.contents[0].mimeType,
        MCP_APP_HTML_MIME_TYPE,
        'MCP Apps resources should use the current text/html;profile=mcp-app MIME type',
      );
      assert.ok(result.contents[0].text.includes('<html'), 'MCP Apps resources should return HTML text');
    });
    await assertRpcResult('resources/templates/list', sessionId, result => {
      assert.ok(Array.isArray(result.resourceTemplates), 'resources/templates/list should return resourceTemplates');
      assert.ok(
        result.resourceTemplates.some(template => template.uriTemplate === 'ui://widget/poi-details.html'),
        'resources/templates/list should include the POI details widget template',
      );
    });
    await assertRpcResultWithParams('tools/call', sessionId, {
      name: 'get_stats',
      arguments: {},
    }, result => {
      assert.ok(Array.isArray(result.content), 'tools/call should return content');
      assert.equal(result.isError, true, 'anonymous get_stats calls should be rejected');
    });
    await assertRpcResultWithParams('tools/call', sessionId, {
      name: 'search_hotels_ui',
      arguments: { query: '__mcp_apps_smoke_no_match__', limit: 1 },
    }, result => {
      assert.ok(result.structuredContent, 'MCP Apps tool calls should return structuredContent');
      assert.ok(Array.isArray(result.structuredContent.results), 'MCP Apps structuredContent should include results');
      assert.notEqual(result.isError, true, 'search_hotels_ui should not return an MCP tool error');
    });
    await assertRpcResult('tasks/list', sessionId, result => {
      assert.ok(Array.isArray(result.tasks), 'tasks/list should return tasks');
    });
    await assertRpcResult('ping', sessionId, result => {
      assert.deepEqual(result, {}, 'ping should return an empty result');
    });

    await assertSseEndpointRejected();

    console.log('MCP Inspector smoke passed');
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
