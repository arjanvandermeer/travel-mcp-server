#!/usr/bin/env node

/**
 * Test script to verify race condition protection
 * Simulates multiple simultaneous requests for the same uncached region
 */

import { HotelDatabase } from './src/database.js';

const db = new HotelDatabase();

console.log('\n=== Testing Race Condition Protection ===\n');
console.log('Sending 3 simultaneous requests for the same region...');
console.log('Expected: Only ONE background fetch should be triggered\n');

// Rotterdam coordinates (new city, not yet cached)
const rotterdamLat = 51.9225;
const rotterdamLon = 4.47917;

// Fire off 3 requests simultaneously
const startTime = Date.now();

Promise.all([
  db.getHotelsNearCoordinates(rotterdamLat, rotterdamLon, 2, 50),
  db.getHotelsNearCoordinates(rotterdamLat, rotterdamLon, 2, 50),
  db.getHotelsNearCoordinates(rotterdamLat, rotterdamLon, 2, 50),
]).then(([results1, results2, results3]) => {
  const elapsed = Date.now() - startTime;

  console.log(`\nAll 3 requests completed in ${elapsed}ms`);
  console.log(`Request 1: ${results1.length} hotels`);
  console.log(`Request 2: ${results2.length} hotels`);
  console.log(`Request 3: ${results3.length} hotels`);

  console.log('\nLook at the logs above:');
  console.log('- You should see "Started background fetch" ONCE');
  console.log('- You should see "Fetch already in progress, skipping duplicate" TWICE');

  // Wait for background fetch to complete
  console.log('\nWaiting 15 seconds for background fetch to complete...');
  return new Promise(resolve => setTimeout(resolve, 15000));
}).then(() => {
  // Query again to see cached results
  return db.getHotelsNearCoordinates(rotterdamLat, rotterdamLon, 2, 50);
}).then(finalResults => {
  console.log(`\nFinal query returned ${finalResults.length} hotels from cache`);

  // Check metadata
  const regionHash = db.calculateBboxHash(
    rotterdamLat - 2/111,
    rotterdamLon - 2/(111 * Math.cos(rotterdamLat * Math.PI / 180)),
    rotterdamLat + 2/111,
    rotterdamLon + 2/(111 * Math.cos(rotterdamLat * Math.PI / 180))
  );
  const metadata = db.getCacheMetadata(regionHash, 'hotels');

  if (metadata) {
    console.log('\nCache metadata:');
    console.log(`  Expected: ${metadata.expected_count} hotels`);
    console.log(`  Actual: ${metadata.actual_count} hotels`);
    console.log(`  Complete: ${metadata.is_complete ? 'Yes' : 'No'}`);
  }

  db.close();
  console.log('\n=== Test Complete ===\n');
}).catch(error => {
  console.error('Error during test:', error);
  db.close();
});
