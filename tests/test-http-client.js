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
        const lat = city.latitude?.toFixed(4);
        const lon = city.longitude?.toFixed(4);
        const pop = city.population?.toLocaleString() || 'unknown';
        console.log(`   - ${city.name}, ${city.country_code}`);
        console.log(`     Population: ${pop}`);
        console.log(`     Coordinates: ${lat}, ${lon}`);
        if (city.timezone) console.log(`     Timezone: ${city.timezone}`);
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
      hotels.forEach((hotel, idx) => {
        const rating = hotel.google_rating ? ` ${hotel.google_rating}⭐` : '';
        const reviews = hotel.google_user_ratings_total ? ` (${hotel.google_user_ratings_total} reviews)` : '';
        const stars = hotel.stars ? ` [${hotel.stars}-star]` : '';
        const distance = hotel.distance_km ? ` - ${hotel.distance_km.toFixed(1)}km away` : '';

        console.log(`   ${idx + 1}. ${hotel.name}${stars}`);
        if (rating) console.log(`      Rating:${rating}${reviews}`);
        if (hotel.address) console.log(`      Address: ${hotel.address.substring(0, 60)}${hotel.address.length > 60 ? '...' : ''}`);
        if (hotel.phone) console.log(`      Phone: ${hotel.phone}`);
        if (hotel.website) console.log(`      Website: ${hotel.website.substring(0, 50)}...`);
        if (distance) console.log(`      Distance:${distance}`);
        console.log();
      });
    }

    // Test 4: Search POIs near coordinates (Grand Palace, Bangkok)
    console.log('4. Searching for POIs near Grand Palace (13.7500, 100.4917)...');
    const nearbyResult = await client.callTool({
      name: 'search_pois',
      arguments: {
        latitude: 13.7500,
        longitude: 100.4917,
        radius_km: 2,
        limit: 5
      }
    });

    const nearbyContent = nearbyResult.content[0];
    if (nearbyContent.type === 'text') {
      const pois = JSON.parse(nearbyContent.text);
      console.log(`   Found ${pois.length} POIs within 2km:`);
      pois.forEach((poi, idx) => {
        const type = poi.poi_type ? `[${poi.poi_type}]` : '';
        const distance = poi.distance_km ? ` (${poi.distance_km.toFixed(2)}km)` : '';
        console.log(`   ${idx + 1}. ${poi.name} ${type}${distance}`);
      });
    }
    console.log();

    // Test 5: Search for restaurants
    console.log('5. Searching for restaurants in Bangkok...');
    const restaurantsResult = await client.callTool({
      name: 'search_restaurants',
      arguments: {
        city_name: 'Bangkok',
        country_code: 'TH',
        limit: 3
      }
    });

    const restaurantsContent = restaurantsResult.content[0];
    if (restaurantsContent.type === 'text') {
      const restaurants = JSON.parse(restaurantsContent.text);
      console.log(`   Found ${restaurants.length} restaurants:`);
      restaurants.forEach((restaurant, idx) => {
        const rating = restaurant.google_rating ? ` ${restaurant.google_rating}⭐` : '';
        const cuisine = restaurant.cuisine ? ` (${restaurant.cuisine})` : '';
        console.log(`   ${idx + 1}. ${restaurant.name}${cuisine}`);
        if (rating) console.log(`      Rating:${rating}`);
        if (restaurant.address) console.log(`      Address: ${restaurant.address.substring(0, 60)}...`);
      });
    }
    console.log();

    // Test 6: Get database stats
    console.log('6. Getting database statistics...');
    const statsResult = await client.callTool({
      name: 'get_stats',
      arguments: {}
    });

    const statsContent = statsResult.content[0];
    if (statsContent.type === 'text') {
      const stats = JSON.parse(statsContent.text);
      console.log(`   ╔════════════════════════════════════╗`);
      console.log(`   ║      Database Statistics          ║`);
      console.log(`   ╠════════════════════════════════════╣`);
      console.log(`   ║ Countries: ${String(stats.countries).padEnd(23)}║`);
      console.log(`   ║ Cities: ${String(stats.cities).padEnd(26)}║`);
      console.log(`   ║ Total POIs: ${String(stats.pois).padEnd(22)}║`);
      console.log(`   ╠════════════════════════════════════╣`);
      console.log(`   ║ Hotels: ${String(stats.hotels || 0).padEnd(26)}║`);
      console.log(`   ║ Restaurants: ${String(stats.restaurants || 0).padEnd(21)}║`);
      console.log(`   ║ Attractions: ${String(stats.attractions || 0).padEnd(21)}║`);
      console.log(`   ╠════════════════════════════════════╣`);
      console.log(`   ║ Google enriched: ${String(stats.google_places_enriched || 0).padEnd(17)}║`);
      console.log(`   ╚════════════════════════════════════╝`);
    }
    console.log();

    // Close connection
    await client.close();
    console.log('✅ All tests completed successfully!');

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
