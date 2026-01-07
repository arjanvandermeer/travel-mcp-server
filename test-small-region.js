#!/usr/bin/env node

/**
 * Test with a smaller region that should succeed
 */

import { HotelDatabase } from './src/database.js';

const db = new HotelDatabase();

console.log('\n=== Testing Small Region (2km radius) ===\n');

// Amsterdam Dam Square
const damLat = 52.3730796;
const damLon = 4.8924534;

console.log('Querying 2km radius around Dam Square, Amsterdam...');
console.log('This should NOT split into tiles (small enough)');
console.log('');

try {
  const results = await db.getHotelsNearCoordinates(damLat, damLon, 2, 100);
  console.log(`Query returned ${results.length} hotels from cache`);

  // Wait for background fetch
  console.log('\nWaiting 15 seconds for background fetch...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  // Query again to see cached results
  const results2 = await db.getHotelsNearCoordinates(damLat, damLon, 2, 100);
  console.log(`\nSecond query returned ${results2.length} hotels from cache`);

  // Check metadata
  const regionHash = db.calculateBboxHash(
    damLat - 2/111,
    damLon - 2/(111 * Math.cos(damLat * Math.PI / 180)),
    damLat + 2/111,
    damLon + 2/(111 * Math.cos(damLat * Math.PI / 180))
  );
  const metadata = db.getCacheMetadata(regionHash, 'hotels');

  if (metadata) {
    console.log('\nCache metadata:');
    console.log(`  Expected: ${metadata.expected_count} hotels`);
    console.log(`  Actual: ${metadata.actual_count} hotels`);
    console.log(`  Complete: ${metadata.is_complete ? 'Yes' : 'No'}`);
    console.log(`  Fresh: ${db.isCacheFresh(metadata) ? 'Yes' : 'No'}`);
  }
} catch (error) {
  console.error('Error during test:', error);
}

db.close();
console.log('\n=== Test Complete ===\n');
