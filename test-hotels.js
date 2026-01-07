#!/usr/bin/env node

/**
 * Quick test script for hotel tools
 * Tests the new get_hotel_by_id and find_hotels_in_polygon tools
 */

import { HotelDatabase } from './src/database.js';

const db = new HotelDatabase();

console.log('\n=== Testing Hotel Tools ===\n');

// Test 1: Get some hotels to find their IDs
console.log('1. Finding hotels in London to get test IDs...');
const londonHotels = db.getHotelsNearCoordinates(51.5074, -0.1278, 5, 5);
console.log(`Found ${londonHotels.length} hotels near London center`);
if (londonHotels.length > 0) {
  console.log('First hotel:', {
    osm_id: londonHotels[0].osm_id,
    name: londonHotels[0].name,
    address: londonHotels[0].address
  });
}

// Test 2: Get hotel by ID
if (londonHotels.length > 0) {
  console.log('\n2. Testing getHotelByOsmId...');
  const testId = londonHotels[0].osm_id;
  const hotel = db.getHotelByOsmId(testId);
  if (hotel) {
    console.log('✓ Successfully retrieved hotel by ID:', hotel.name);
    console.log('  Address:', hotel.address || 'N/A');
    console.log('  Stars:', hotel.stars || 'N/A');
  } else {
    console.log('✗ Failed to retrieve hotel by ID');
  }
}

// Test 3: Find hotels in polygon (London area)
console.log('\n3. Testing getHotelsInPolygon...');
// Define a polygon around central London
const londonPolygon = [
  [51.52, -0.15],  // North-West
  [51.52, -0.10],  // North-East
  [51.50, -0.10],  // South-East
  [51.50, -0.15],  // South-West
];

const hotelsInPolygon = db.getHotelsInPolygon(londonPolygon, 20);
console.log(`Found ${hotelsInPolygon.length} hotels in London polygon`);
if (hotelsInPolygon.length > 0) {
  console.log('Sample hotels:');
  hotelsInPolygon.slice(0, 3).forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.name} (${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)})`);
  });
}

// Test 4: Test point-in-polygon logic
console.log('\n4. Testing isPointInPolygon logic...');
// Point that should be inside the polygon
const insidePoint = [51.51, -0.12];
const isInside = db.isPointInPolygon(insidePoint[0], insidePoint[1], londonPolygon);
console.log(`Point ${insidePoint} is ${isInside ? 'inside' : 'outside'} polygon: ${isInside ? '✓' : '✗'}`);

// Point that should be outside the polygon
const outsidePoint = [51.60, -0.12];
const isOutside = db.isPointInPolygon(outsidePoint[0], outsidePoint[1], londonPolygon);
console.log(`Point ${outsidePoint} is ${isOutside ? 'inside' : 'outside'} polygon: ${!isOutside ? '✓' : '✗'}`);

// Test 5: Edge case - non-existent hotel ID
console.log('\n5. Testing with non-existent hotel ID...');
const nonExistent = db.getHotelByOsmId('node/999999999999');
console.log(`Non-existent hotel returns: ${nonExistent === undefined ? 'undefined ✓' : 'something else ✗'}`);

console.log('\n=== Tests Complete ===\n');

db.close();
