#!/usr/bin/env node

/**
 * Test Bangkok search radius
 */

import { TravelDatabase } from './src/database.js';

async function testBangkokRadius() {
  const db = new TravelDatabase();

  try {
    // Get Bangkok city info
    const bangkok = await db.getCityByName('Bangkok', 'TH');
    console.log('Bangkok city info:');
    console.log(`  Name: ${bangkok.name}`);
    console.log(`  Population: ${bangkok.population}`);
    console.log(`  Coords: ${bangkok.latitude}, ${bangkok.longitude}`);

    const radius = db.getRadiusForPopulation(bangkok.population);
    console.log(`  Auto radius: ${radius} km\n`);

    console.log('---\n');

    // Test search with different radii
    for (const testRadius of [5, 10, 20, 30]) {
      const results = await db.searchPOIs({
        name: 'conrad',
        cityName: 'Bangkok',
        countryCode: 'TH',
        radius: testRadius,
        poiType: 'hotel',
        limit: 10
      });
      console.log(`Radius ${testRadius}km: ${results.length} Conrad results`);
      results.forEach(p => console.log(`  - ${p.name} - ${p.distance_km.toFixed(2)} km`));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testBangkokRadius();
