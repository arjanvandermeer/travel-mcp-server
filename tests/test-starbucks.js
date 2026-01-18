#!/usr/bin/env node

/**
 * Test Starbucks search in Bangkok
 */

import { TravelDatabase } from './src/database.js';

async function testStarbucks() {
  const db = new TravelDatabase();

  try {
    console.log('Test 1: Search for "starbucks" globally\n');
    const global = await db.searchPOIs({ name: 'starbucks', limit: 10 });
    console.log(`Found ${global.length} results:`);
    global.forEach(p => console.log(`  - ${p.name} (${p.poi_type}) - ${p.city || 'unknown'}`));

    console.log('\n---\n');

    console.log('Test 2: Search for "starbucks" in Bangkok\n');
    const bangkok = await db.searchPOIs({
      name: 'starbucks',
      cityName: 'Bangkok',
      countryCode: 'TH',
      limit: 10
    });
    console.log(`Found ${bangkok.length} results:`);
    bangkok.forEach(p => {
      console.log(`  - ${p.name} (${p.poi_type}) - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : 'unknown distance'}`);
    });

    console.log('\n---\n');

    console.log('Test 3: Search for cafes in Bangkok (no name filter)\n');
    const cafes = await db.searchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'cafe',
      limit: 10
    });
    console.log(`Found ${cafes.length} cafes:`);
    cafes.forEach(p => console.log(`  - ${p.name}`));

    console.log('\n---\n');

    console.log('Test 4: Check what "starbucks" entries exist in database\n');
    const check = await db.pool.query(`
      SELECT name, poi_type, city, country_code
      FROM enriched_pois
      WHERE best_name ILIKE '%starbucks%'
      LIMIT 20
    `);
    console.log(`Found ${check.rows.length} entries with "starbucks" in name:`);
    check.rows.forEach(r => console.log(`  - ${r.name} (${r.poi_type}) - ${r.city || 'unknown'}, ${r.country_code || 'unknown'}`));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testStarbucks();
