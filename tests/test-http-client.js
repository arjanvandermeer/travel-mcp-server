#!/usr/bin/env node

/**
 * Simple test client for HTTP/SSE MCP server
 *
 * Usage:
 *   1. Start the HTTP server: npm run start:http
 *   2. Run this client: node tests/test-http-client.js
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';

async function testMCPClient() {
  console.log(`Connecting to MCP server at ${SERVER_URL}/sse...\n`);

  try {
    // Create SSE transport
    const transport = new SSEClientTransport(
      new URL(`${SERVER_URL}/sse`)
    );

    // Create MCP client
    const client = new Client({
      name: 'travel-test-client',
      version: '1.0.0',
    }, {
      capabilities: {}
    });

    // Connect to server
    await client.connect(transport);
    console.log('✓ Connected to MCP server\n');

    // Test 1: List available tools
    console.log('1. Listing available tools...');
    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools || [];
    console.log(`   Found ${tools.length} tools:`);
    tools.forEach(tool => {
      console.log(`   - ${tool.name}: ${tool.description.substring(0, 60)}...`);
    });
    console.log();

    // Test 2: Search for cities
    console.log('2. Searching for cities named "Bangkok"...');
    const citiesResult = await client.callTool({
      name: 'search_cities',
      arguments: {
        query: 'Bangkok',
        limit: 3
      }
    });

    const citiesContent = citiesResult.content[0];
    if (citiesContent.type === 'text') {
      const cities = JSON.parse(citiesContent.text);
      console.log(`   Found ${cities.length} cities:`);
      cities.forEach(city => {
        console.log(`   - ${city.name}, ${city.country_code} (pop: ${city.population?.toLocaleString() || 'unknown'})`);
      });
    }
    console.log();

    // Test 3: Search for hotels
    console.log('3. Searching for hotels in Bangkok...');
    const hotelsResult = await client.callTool({
      name: 'search_hotels',
      arguments: {
        city_name: 'Bangkok',
        country_code: 'TH',
        limit: 5
      }
    });

    const hotelsContent = hotelsResult.content[0];
    if (hotelsContent.type === 'text') {
      const hotels = JSON.parse(hotelsContent.text);
      console.log(`   Found ${hotels.length} hotels:`);
      hotels.forEach(hotel => {
        const rating = hotel.google_rating ? ` (${hotel.google_rating}⭐)` : '';
        console.log(`   - ${hotel.name}${rating}`);
      });
    }
    console.log();

    // Test 4: Get database stats
    console.log('4. Getting database statistics...');
    const statsResult = await client.callTool({
      name: 'get_stats',
      arguments: {}
    });

    const statsContent = statsResult.content[0];
    if (statsContent.type === 'text') {
      const stats = JSON.parse(statsContent.text);
      console.log(`   Countries: ${stats.countries}`);
      console.log(`   Cities: ${stats.cities}`);
      console.log(`   POIs: ${stats.pois}`);
      console.log(`   Hotels: ${stats.hotels}`);
      console.log(`   Google Places enriched: ${stats.google_places_enriched}`);
    }
    console.log();

    // Close connection
    await client.close();
    console.log('✓ Tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Check if server is running first
async function checkServer() {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    const health = await response.json();
    console.log(`Server status: ${health.status}`);
    console.log(`Server version: ${health.version}\n`);
    return true;
  } catch (error) {
    console.error(`❌ Cannot connect to server at ${SERVER_URL}`);
    console.error(`   Error: ${error.message}`);
    console.error(`\nPlease start the server first:`);
    console.error(`   npm run start:http`);
    process.exit(1);
  }
}

// Run tests
checkServer().then(() => testMCPClient());
