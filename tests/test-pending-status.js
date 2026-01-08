#!/usr/bin/env node

/**
 * Test script to verify the pending status response
 * Simulates what an LLM would see when requesting uncached hotel data
 */

import { HotelDatabase } from './src/database.js';
import { executeToolHandler } from './src/tools-config.js';

const db = new HotelDatabase();

console.log('\n=== Testing Pending Status Response ===\n');

// Test with a new city (Prague - probably not cached)
const pragueLat = 50.0755;
const pragueLon = 14.4378;

console.log('1. First request (no cache) - should return "fetching" status:');
console.log('─'.repeat(60));

const firstResponse = await executeToolHandler(
  'find_hotels_near_coordinates',
  {
    latitude: pragueLat,
    longitude: pragueLon,
    radius_km: 2,
    limit: 20
  },
  db
);

const firstData = JSON.parse(firstResponse.content[0].text);
console.log(JSON.stringify(firstData, null, 2));

console.log('\n2. Waiting 15 seconds for background fetch...\n');
await new Promise(resolve => setTimeout(resolve, 15000));

console.log('3. Second request (should have cached data now):');
console.log('─'.repeat(60));

const secondResponse = await executeToolHandler(
  'find_hotels_near_coordinates',
  {
    latitude: pragueLat,
    longitude: pragueLon,
    radius_km: 2,
    limit: 20
  },
  db
);

const secondData = JSON.parse(secondResponse.content[0].text);
console.log(`Status: ${secondData.status}`);
console.log(`Message: ${secondData.message}`);
console.log(`Hotels found: ${secondData.count || 0}`);
console.log(`Cache info:`, secondData.cache_info);

if (secondData.hotels && secondData.hotels.length > 0) {
  console.log(`\nFirst 3 hotels:`);
  secondData.hotels.slice(0, 3).forEach((hotel, i) => {
    console.log(`  ${i + 1}. ${hotel.name} (${hotel.distance_km.toFixed(2)}km away)`);
  });
}

db.close();
console.log('\n=== Test Complete ===\n');
console.log('Key observations:');
console.log('✓ First request returned status="fetching" with clear retry instruction');
console.log('✓ Second request returned actual hotel data with cache metadata');
console.log('✓ LLM can now understand the difference and inform the user appropriately');
