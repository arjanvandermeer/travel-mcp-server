#!/usr/bin/env node

/**
 * Test search_restaurants now includes cafes (Starbucks)
 */

import { TravelDatabase } from './src/database.js';

async function testRestaurantsWithCafes() {
  const db = new TravelDatabase();

  try {
    console.log('Test 1: Search for "starbucks" (should find cafes)\n');
    const starbucks = await db.searchPOIs({
      name: 'starbucks',
      poiTypes: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'],
      limit: 5
    });
    console.log(`Found ${starbucks.length} results:`);
    starbucks.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    console.log('Test 2: Search for "starbucks" in Bangkok\n');
    const starbucksBkk = await db.searchPOIs({
      name: 'starbucks',
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiTypes: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'],
      limit: 5
    });
    console.log(`Found ${starbucksBkk.length} results:`);
    starbucksBkk.forEach(p => {
      console.log(`  - ${p.name} (${p.poi_type}) - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : ''}`);
    });

    console.log('\n---\n');

    console.log('Test 3: Search restaurants only (no cafes) in Bangkok\n');
    const restaurantsOnly = await db.searchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiTypes: ['restaurant'],
      limit: 5
    });
    console.log(`Found ${restaurantsOnly.length} restaurants:`);
    restaurantsOnly.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    console.log('Test 4: Search cafes only in Bangkok\n');
    const cafesOnly = await db.searchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiTypes: ['cafe'],
      limit: 5
    });
    console.log(`Found ${cafesOnly.length} cafes:`);
    cafesOnly.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testRestaurantsWithCafes();
