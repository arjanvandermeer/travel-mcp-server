#!/usr/bin/env node

/**
 * Test Conrad and Hilton searches in Bangkok
 */

import { TravelDatabase } from './src/database.js';

async function testConradHiltonBangkok() {
  const db = new TravelDatabase();

  try {
    console.log('Test 1: Search for "conrad" (global)\n');
    const conradGlobal = await db.searchPOIs({
      name: 'conrad',
      poiType: 'hotel',
      limit: 10
    });
    console.log(`Found ${conradGlobal.length} results:`);
    conradGlobal.forEach(p => console.log(`  - ${p.name}`));

    console.log('\n---\n');

    console.log('Test 2: Search for "conrad" in Bangkok\n');
    const conradBkk = await db.searchPOIs({
      name: 'conrad',
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'hotel',
      limit: 10
    });
    console.log(`Found ${conradBkk.length} results:`);
    conradBkk.forEach(p => console.log(`  - ${p.name} - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : ''}`));

    console.log('\n---\n');

    console.log('Test 3: Search for "hilton" in Bangkok\n');
    const hiltonBkk = await db.searchPOIs({
      name: 'hilton',
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'hotel',
      limit: 10
    });
    console.log(`Found ${hiltonBkk.length} results:`);
    hiltonBkk.forEach(p => console.log(`  - ${p.name} - ${p.distance_km ? p.distance_km.toFixed(2) + ' km' : ''}`));

    console.log('\n---\n');

    console.log('Test 4: Check where Conrad Bangkok is located\n');
    const conradLocation = await db.pool.query(`
      SELECT name, latitude, longitude,
             ST_Distance(
               location::geography,
               ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography
             ) / 1000.0 as distance_from_bangkok_center_km
      FROM pois
      WHERE name ILIKE '%conrad%'
    `);
    conradLocation.rows.forEach(p => {
      console.log(`  - ${p.name}`);
      console.log(`    Coords: ${p.latitude}, ${p.longitude}`);
      console.log(`    Distance from Bangkok center: ${p.distance_from_bangkok_center_km.toFixed(2)} km`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testConradHiltonBangkok();
