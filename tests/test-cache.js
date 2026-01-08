#!/usr/bin/env node

/**
 * Test script for cache system
 * Tests lazy loading and cache refresh
 */

import { HotelDatabase } from './src/database.js';

const db = new HotelDatabase();

console.log('\n=== Testing Cache System ===\n');

// Test 1: Query a new region (should trigger fetch)
console.log('1. Querying Berlin hotels (new region, should trigger fetch)...');
const berlinHotels = await db.getHotelsNearCoordinates(52.52, 13.40, 2, 5);
console.log(`Found ${berlinHotels.length} hotels`);

// Give it a moment to start the background fetch
await new Promise(resolve => setTimeout(resolve, 1000));

// Test 2: Check metadata
console.log('\n2. Checking cache metadata...');
const regionHash = db.calculateBboxHash(
  52.52 - 2/111,
  13.40 - 2/(111 * Math.cos(52.52 * Math.PI / 180)),
  52.52 + 2/111,
  13.40 + 2/(111 * Math.cos(52.52 * Math.PI / 180))
);
const metadata = db.getCacheMetadata(regionHash, 'hotels');
if (metadata) {
  console.log('Metadata found:', {
    region_hash: metadata.region_hash,
    expected_count: metadata.expected_count,
    actual_count: metadata.actual_count,
    is_complete: metadata.is_complete,
    is_fresh: db.isCacheFresh(metadata)
  });
} else {
  console.log('No metadata yet (background fetch in progress)');
}

// Test 3: Test with known stale data
console.log('\n3. Testing stale data detection...');
// Manually insert stale metadata
const staleHash = 'test_stale_region';
const oldTimestamp = Math.floor(Date.now() / 1000) - (40 * 86400); // 40 days ago
db.upsertCacheMetadata({
  region_hash: staleHash,
  region_type: 'test',
  bbox: JSON.stringify({ south: 0, west: 0, north: 1, east: 1 }),
  data_type: 'hotels',
  expected_count: 10,
  actual_count: 10,
  is_complete: 1,
  last_fetched: oldTimestamp,
  cache_ttl_days: 30
});

const staleMetadata = db.getCacheMetadata(staleHash, 'hotels');
console.log('Stale test:', {
  age_days: Math.floor((Math.floor(Date.now() / 1000) - staleMetadata.last_fetched) / 86400),
  is_fresh: db.isCacheFresh(staleMetadata),
  should_be: 'false (older than 30 days)'
});

console.log('\n=== Test Complete ===\n');
console.log('Note: Background fetches may still be running. Check console output.');

db.close();
