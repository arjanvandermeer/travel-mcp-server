#!/usr/bin/env node

/**
 * Test script for Bangkok hotel search with PostgreSQL
 */

import { TravelDatabase } from '../src/database-postgres.js';

async function testBangkok() {
  const db = new TravelDatabase();

  try {
    console.log('=== Testing Bangkok Hotel Search ===\n');

    // Test 1: Search for Bangkok city
    console.log('1. Searching for Bangkok city...');
    const cities = await db.searchCities('Bangkok', null, 5);
    console.log(`Found ${cities.length} cities matching "Bangkok"`);
    const bangkok = cities.find(c => c.country_code === 'TH');
    if (bangkok) {
      console.log(`✓ Bangkok, Thailand found:`);
      console.log(`  - Population: ${bangkok.population?.toLocaleString()}`);
      console.log(`  - Coordinates: ${bangkok.latitude}, ${bangkok.longitude}`);
      console.log('');
    }

    // Test 2: Find hotels in Bangkok
    console.log('2. Finding hotels in Bangkok...');
    const result = await db.findHotelsInCity('Bangkok', 'TH', 100);
    console.log(`✓ Search completed:`);
    console.log(`  - City: ${result.city.name}, ${result.city.country_code}`);
    console.log(`  - Population: ${result.city.population?.toLocaleString()}`);
    console.log(`  - Search radius: ${result.radius_km}km`);
    console.log(`  - Hotels found: ${result.count}`);
    console.log('');

    // Test 3: Show sample hotels
    console.log('3. Sample hotels (first 10):');
    result.hotels.slice(0, 10).forEach((hotel, i) => {
      const stars = hotel.stars ? `(${hotel.stars}⭐)` : '';
      const distance = (hotel.distance_meters / 1000).toFixed(2);
      console.log(`  ${i + 1}. ${hotel.name || 'Unnamed'} ${stars} - ${distance}km from center`);
    });
    console.log('');

    // Test 4: Hotels within specific radius
    console.log('4. Hotels within 5km of Bangkok center:');
    const nearbyHotels = await db.getHotelsNearCoordinates(13.7563, 100.5018, 5, 10);
    console.log(`✓ Found ${nearbyHotels.length} hotels within 5km`);
    nearbyHotels.forEach((hotel, i) => {
      const distance = (hotel.distance_meters / 1000).toFixed(2);
      console.log(`  ${i + 1}. ${hotel.name || 'Unnamed'} - ${distance}km`);
    });
    console.log('');

    // Test 5: Database stats
    console.log('5. Database statistics:');
    const stats = await db.getStats();
    console.log(`  - Total countries: ${stats.countries}`);
    console.log(`  - Total cities: ${stats.cities}`);
    console.log(`  - Total POIs: ${stats.pois}`);
    console.log(`  - Total hotels: ${stats.hotels}`);
    console.log(`  - Regions with data: ${stats.pois_by_region.length}`);
    stats.pois_by_region.forEach(region => {
      console.log(`    - ${region.source_region}: ${region.count} POIs`);
    });
    console.log(`  - POI types:`);
    stats.pois_by_type.slice(0, 5).forEach(type => {
      console.log(`    - ${type.poi_type}: ${type.count}`);
    });
    console.log(`  - Recent imports: ${stats.recent_imports.length}`);

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

testBangkok();
