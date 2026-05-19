#!/usr/bin/env node

import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListTasksResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTravelMCPServer } from '../src/mcp-server-factory.js';
import { MCP_APP_HTML_MIME_TYPE } from '../src/resources-config.js';
import { createMockTravelDb } from './mock-travel-db.js';

async function main() {
  const db = createMockTravelDb();
  const server = createTravelMCPServer({ db });
  const client = new Client(
    { name: 'mcp-contract-smoke', version: '1.0.0' },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    assert.equal(client.getServerVersion()?.name, 'travel-mcp-server');

    const tools = await client.listTools();
    assert.ok(tools.tools.length > 0, 'tools/list should return tools');
    const appTool = tools.tools.find(tool => tool.name === 'search_hotels_ui');
    assert.equal(appTool?._meta?.ui?.resourceUri, 'ui://widget/search-results.html');

    const resources = await client.listResources();
    assert.ok(resources.resources.some(resource => resource.uri === 'info://version'));

    const templates = await client.listResourceTemplates();
    assert.ok(templates.resourceTemplates.some(template => template.uriTemplate === 'ui://widget/search-results.html'));
    assert.ok(templates.resourceTemplates.every(template => template.mimeType === MCP_APP_HTML_MIME_TYPE));

    const versionResource = await client.readResource({ uri: 'info://version' });
    assert.ok(versionResource.contents.some(content => content.uri === 'info://version'));

    const appResource = await client.readResource({ uri: 'ui://widget/search-results.html' });
    assert.equal(appResource.contents.length, 1);
    assert.equal(appResource.contents[0].mimeType, MCP_APP_HTML_MIME_TYPE);
    assert.ok(appResource.contents[0].text.includes('<html'));

    const prompts = await client.listPrompts();
    assert.ok(prompts.prompts.length > 0, 'prompts/list should return prompts');

    const prompt = await client.getPrompt({
      name: 'find_hotels_in_city',
      arguments: { city: 'London', country_code: 'GB' },
    });
    assert.ok(prompt.messages.length > 0, 'prompts/get should return messages');

    const stats = await client.callTool({ name: 'get_stats', arguments: {} });
    assert.notEqual(stats.isError, true, 'get_stats should not return a tool error');
    assert.ok(Array.isArray(stats.content), 'tools/call should return content');

    const appResult = await client.callTool({
      name: 'search_hotels_ui',
      arguments: { query: '__mcp_contract_smoke_no_match__', limit: 1 },
    });
    assert.notEqual(appResult.isError, true, 'search_hotels_ui should not return a tool error');
    assert.ok(appResult.structuredContent, 'MCP Apps tools should return structuredContent');
    assert.ok(Array.isArray(appResult.structuredContent.results));

    const tasks = await client.request({ method: 'tasks/list', params: {} }, ListTasksResultSchema);
    assert.deepEqual(tasks.tasks, []);

    const ping = await client.ping();
    assert.deepEqual(ping, {});

    console.log('MCP contract smoke passed');
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
