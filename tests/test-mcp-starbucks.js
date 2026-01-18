#!/usr/bin/env node

/**
 * Test MCP search_restaurants with Starbucks
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function testMCPStarbucks() {
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

    // Test 1: Search for Starbucks (should find cafes)
    console.log('Test 1: search_restaurants with query "starbucks" (no type filter)\n');
    const result1 = await client.callTool({
      name: 'search_restaurants',
      arguments: {
        query: 'starbucks',
        limit: 5
      }
    });
    const data1 = JSON.parse(result1.content[0].text);
    console.log(`Found ${data1.length} results:`);
    data1.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    // Test 2: Search for Starbucks in Bangkok
    console.log('Test 2: search_restaurants "starbucks in Bangkok"\n');
    const result2 = await client.callTool({
      name: 'search_restaurants',
      arguments: {
        query: 'starbucks',
        city_name: 'Bangkok',
        country_code: 'TH',
        limit: 5
      }
    });
    const data2 = JSON.parse(result2.content[0].text);
    console.log(`Found ${data2.length} results:`);
    data2.forEach(p => console.log(`  - ${p.name} (${p.poi_type}) - ${p.distance_km.toFixed(2)} km`));

    console.log('\n---\n');

    // Test 3: Search for cafes only
    console.log('Test 3: search_restaurants with type="cafe"\n');
    const result3 = await client.callTool({
      name: 'search_restaurants',
      arguments: {
        city_name: 'Bangkok',
        country_code: 'TH',
        type: 'cafe',
        limit: 5
      }
    });
    const data3 = JSON.parse(result3.content[0].text);
    console.log(`Found ${data3.length} cafes:`);
    data3.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await client.close();
    process.exit(0);
  }
}

testMCPStarbucks();
