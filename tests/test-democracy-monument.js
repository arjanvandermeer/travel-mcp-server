#!/usr/bin/env node

/**
 * Test democracy monument search
 */

import { TravelDatabase } from './src/database.js';

async function testDemocracy() {
  const db = new TravelDatabase();

  try {
    // Test 1: Just "democracy"
    console.log('Test 1: Search for "democracy"\n');
    const r1 = await db.searchPOIs({ name: 'democracy', limit: 10 });
    console.log(`Found ${r1.length} results:`);
    r1.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    // Test 2: "monument"
    console.log('Test 2: Search for "monument"\n');
    const r2 = await db.searchPOIs({ name: 'monument', limit: 10 });
    console.log(`Found ${r2.length} results:`);
    r2.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    // Test 3: "democracy monument"
    console.log('Test 3: Search for "democracy monument"\n');
    const r3 = await db.searchPOIs({ name: 'democracy monument', limit: 10 });
    console.log(`Found ${r3.length} results:`);
    r3.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    // Test 4: monuments in Bangkok
    console.log('Test 4: Monuments in Bangkok\n');
    const r4 = await db.searchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'monument',
      limit: 10
    });
    console.log(`Found ${r4.length} results:`);
    r4.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testDemocracy();
