#!/usr/bin/env node

/**
 * Test script to query Amsterdam hotels using proper city boundary
 * This demonstrates the difference between a small radius vs actual city coverage
 */

import { HotelDatabase } from './src/database.js';

const db = new HotelDatabase();

console.log('\n=== Testing Amsterdam Hotel Coverage ===\n');

// Amsterdam coordinates from GeoNames
const amsterdamLat = 52.37403;
const amsterdamLon = 4.88969;

// Test 1: Small radius (0.5km) - what we tested before
console.log('1. Testing 0.5km radius (very small area)...');
const smallRadius = await db.getHotelsNearCoordinates(amsterdamLat, amsterdamLon, 0.5, 100);
console.log(`Found ${smallRadius.length} hotels in 0.5km radius`);

// Wait for background fetch
await new Promise(resolve => setTimeout(resolve, 2000));

// Test 2: Medium radius (5km) - covers more of central Amsterdam
console.log('\n2. Testing 5km radius (central Amsterdam)...');
const mediumRadius = await db.getHotelsNearCoordinates(amsterdamLat, amsterdamLon, 5, 100);
console.log(`Found ${mediumRadius.length} hotels in 5km radius`);

// Wait for background fetch
await new Promise(resolve => setTimeout(resolve, 2000));

// Test 3: Larger radius (10km) - covers most of Amsterdam
console.log('\n3. Testing 10km radius (greater Amsterdam area)...');
const largeRadius = await db.getHotelsNearCoordinates(amsterdamLat, amsterdamLon, 10, 200);
console.log(`Found ${largeRadius.length} hotels in 10km radius`);

// Check cache metadata
console.log('\n=== Cache Metadata ===');
const metadataQuery = db.db.prepare(`
  SELECT
    region_hash,
    expected_count,
    actual_count,
    is_complete,
    datetime(last_fetched, 'unixepoch') as last_fetched
  FROM osm_cache_metadata
  WHERE data_type = 'hotels'
  ORDER BY last_fetched DESC
`);
const metadata = metadataQuery.all();
console.log(`\nTotal cached regions: ${metadata.length}`);
metadata.forEach(m => {
  console.log(`  Region ${m.region_hash.substring(0, 8)}: ${m.actual_count}/${m.expected_count} hotels (complete: ${m.is_complete ? 'yes' : 'no'})`);
});

console.log('\n=== Test Complete ===\n');
db.close();
