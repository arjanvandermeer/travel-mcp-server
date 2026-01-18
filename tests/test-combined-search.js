#!/usr/bin/env node

/**
 * Test combined name + location search
 */

import { TravelDatabase } from './src/database.js';

async function testCombinedSearch() {
  const db = new TravelDatabase();

  try {
    console.log('Test 1: Name only - "Marriott"\n');
    const nameOnly = await db.searchPOIs({
      name: 'Marriott',
      limit: 3
    });
    console.log(`Found ${nameOnly.length} results:`);
    nameOnly.forEach(p => console.log(`  - ${p.name} (${p.city || 'unknown city'})`));

    console.log('\n---\n');

    console.log('Test 2: Location only - "Bangkok"\n');
    const locationOnly = await db.searchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'hotel',
      limit: 3
    });
    console.log(`Found ${locationOnly.length} results:`);
    locationOnly.forEach(p => console.log(`  - ${p.name} (${p.city || 'unknown city'})`));

    console.log('\n---\n');

    console.log('Test 3: Combined - "Marriott in Bangkok"\n');
    const combined = await db.searchPOIs({
      name: 'Marriott',
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'hotel',
      limit: 10
    });
    console.log(`Found ${combined.length} results:`);
    combined.forEach(p => {
      console.log(`  - ${p.name} (${p.city || 'unknown city'}) - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : ''}`);
    });

    console.log('\n---\n');

    console.log('Test 4: Combined - "palace in Bangkok"\n');
    const combined2 = await db.searchPOIs({
      name: 'palace',
      cityName: 'Bangkok',
      countryCode: 'TH',
      limit: 5
    });
    console.log(`Found ${combined2.length} results:`);
    combined2.forEach(p => {
      console.log(`  - ${p.name} (${p.poi_type}) - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : ''}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await db.close();
  }
}

testCombinedSearch();
