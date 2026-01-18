#!/usr/bin/env node

/**
 * Test restaurant and POI search
 */

import { TravelDatabase } from './src/database.js';

async function testSearches() {
  const db = new TravelDatabase();

  try {
    console.log('Test 1: Search restaurants by name - "palace"\n');
    const restaurants = await db.searchPOIs({
      name: 'palace',
      poiType: 'restaurant',
      limit: 5
    });
    console.log(`Found ${restaurants.length} restaurants:`);
    restaurants.forEach(p => console.log(`  - ${p.name}`));

    console.log('\n---\n');

    console.log('Test 2: Search restaurants in Bangkok\n');
    const restaurantsBkk = await db.searchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'restaurant',
      limit: 5
    });
    console.log(`Found ${restaurantsBkk.length} restaurants:`);
    restaurantsBkk.forEach(p => console.log(`  - ${p.name}`));

    console.log('\n---\n');

    console.log('Test 3: Search POIs (attractions) by name - "palace"\n');
    const pois = await db.searchPOIs({
      name: 'palace',
      poiType: 'attraction',
      limit: 5
    });
    console.log(`Found ${pois.length} attractions:`);
    pois.forEach(p => console.log(`  - ${p.name}`));

    console.log('\n---\n');

    console.log('Test 4: Search all POIs in Bangkok - "democracy"\n');
    const poisBkk = await db.searchPOIs({
      name: 'democracy',
      cityName: 'Bangkok',
      countryCode: 'TH',
      limit: 5
    });
    console.log(`Found ${poisBkk.length} POIs:`);
    poisBkk.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testSearches();
