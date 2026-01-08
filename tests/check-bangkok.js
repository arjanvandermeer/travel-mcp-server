#!/usr/bin/env node

import { HotelDatabase } from './src/database.js';

const db = new HotelDatabase();

// Bangkok coordinates
const lat = 13.75398;
const lon = 100.50144;
const radius = 25; // 25km for mega city

console.log('Querying Bangkok hotels with 25km radius...');

const response = await db.getHotelsNearCoordinates(lat, lon, radius, 10000);

console.log(`Status: ${response.status}`);
console.log(`Hotels found: ${response.results.length}`);
console.log(`Cache info:`, response.cache_info);

if (response.results && response.results.length > 0) {
  console.log('\nSample hotels:');
  response.results.slice(0, 5).forEach((h, i) => {
    console.log(`  ${i+1}. ${h.name} (${h.distance_km.toFixed(2)}km)`);
  });
}

db.close();
