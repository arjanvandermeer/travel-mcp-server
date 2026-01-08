#!/usr/bin/env node

/**
 * Test script to verify rate limiting and tile splitting
 */

import { HotelDatabase } from './src/database.js';

const db = new HotelDatabase();

console.log('\n=== Testing Rate Limiting and Tiling ===\n');

// Amsterdam coordinates
const amsterdamLat = 52.37403;
const amsterdamLon = 4.88969;

console.log('Testing 10km radius around Amsterdam (should split into tiles)...');
console.log('This will demonstrate:');
console.log('- Rate limiting between API requests (1 second minimum delay)');
console.log('- Exponential backoff on errors/timeouts');
console.log('- Splitting large regions into 4 tiles');
console.log('');

const startTime = Date.now();

try {
  const results = await db.getHotelsNearCoordinates(amsterdamLat, amsterdamLon, 10, 100);
  console.log(`\nQuery returned ${results.length} hotels from cache`);

  // Wait a bit for background fetch to complete
  console.log('\nWaiting 30 seconds for background fetch to complete...');
  await new Promise(resolve => setTimeout(resolve, 30000));

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nTotal time elapsed: ${elapsed} seconds`);

  // Check final results
  const metadata = db.getCacheMetadata(
    db.calculateBboxHash(
      amsterdamLat - 10/111,
      amsterdamLon - 10/(111 * Math.cos(amsterdamLat * Math.PI / 180)),
      amsterdamLat + 10/111,
      amsterdamLon + 10/(111 * Math.cos(amsterdamLat * Math.PI / 180))
    ),
    'hotels'
  );

  if (metadata) {
    console.log('\nCache metadata:');
    console.log(`  Expected: ${metadata.expected_count} hotels`);
    console.log(`  Actual: ${metadata.actual_count} hotels`);
    console.log(`  Complete: ${metadata.is_complete ? 'Yes' : 'No'}`);
  }
} catch (error) {
  console.error('Error during test:', error);
}

db.close();
console.log('\n=== Test Complete ===\n');
