#!/usr/bin/env node

/**
 * Test MCP search tools via HTTP client
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function testMCPSearch() {
  const transport = new SSEClientTransport(new URL('http://localhost:3000/sse'));
  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  try {
    await client.connect(transport);
    console.log('✓ Connected to MCP server\n');

    // Test 1: Search hotels by name
    console.log('Test 1: search_hotels with query "Marriott"\n');
    const result1 = await client.callTool({
      name: 'search_hotels',
      arguments: {
        query: 'Marriott',
        limit: 3
      }
    });
    console.log('Result:', result1.content[0].text);
    console.log('\n---\n');

    // Test 2: Search restaurants in Bangkok
    console.log('Test 2: search_restaurants in Bangkok\n');
    const result2 = await client.callTool({
      name: 'search_restaurants',
      arguments: {
        city_name: 'Bangkok',
        country_code: 'TH',
        limit: 3
      }
    });
    console.log('Result:', result2.content[0].text);
    console.log('\n---\n');

    // Test 3: Search POIs - combined name + location
    console.log('Test 3: search_pois - "palace" in Bangkok\n');
    const result3 = await client.callTool({
      name: 'search_pois',
      arguments: {
        query: 'palace',
        city_name: 'Bangkok',
        country_code: 'TH',
        limit: 3
      }
    });
    console.log('Result:', result3.content[0].text);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await client.close();
    process.exit(0);
  }
}

testMCPSearch();
