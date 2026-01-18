#!/usr/bin/env node

/**
 * Test MCP search for Conrad and Hilton in Bangkok
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function testMCPConradHilton() {
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

    // Test 1: Search for Conrad in Bangkok
    console.log('Test 1: search_hotels "conrad in Bangkok"\n');
    const result1 = await client.callTool({
      name: 'search_hotels',
      arguments: {
        query: 'conrad',
        city_name: 'Bangkok',
        country_code: 'TH',
        limit: 10
      }
    });
    const data1 = JSON.parse(result1.content[0].text);
    console.log(`Found ${data1.length} results:`);
    data1.forEach(p => console.log(`  - ${p.name} - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : ''}`));

    console.log('\n---\n');

    // Test 2: Search for Hilton in Bangkok
    console.log('Test 2: search_hotels "hilton in Bangkok"\n');
    const result2 = await client.callTool({
      name: 'search_hotels',
      arguments: {
        query: 'hilton',
        city_name: 'Bangkok',
        country_code: 'TH',
        limit: 10
      }
    });
    const data2 = JSON.parse(result2.content[0].text);
    console.log(`Found ${data2.length} results:`);
    data2.forEach(p => console.log(`  - ${p.name} - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : ''}`));

    console.log('\n---\n');

    // Test 3: Just "conrad" without location
    console.log('Test 3: search_hotels "conrad" (global)\n');
    const result3 = await client.callTool({
      name: 'search_hotels',
      arguments: {
        query: 'conrad',
        limit: 10
      }
    });
    const data3 = JSON.parse(result3.content[0].text);
    console.log(`Found ${data3.length} results:`);
    data3.forEach(p => console.log(`  - ${p.name}`));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
    process.exit(0);
  }
}

testMCPConradHilton();
