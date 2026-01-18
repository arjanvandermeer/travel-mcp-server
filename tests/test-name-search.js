#!/usr/bin/env node

/**
 * Test name search functionality
 */

import { TravelDatabase } from './src/database.js';

async function testNameSearch() {
  const db = new TravelDatabase();

  try {
    console.log('Testing name search for "Marriott"...\n');

    const results = await db.searchPOIs({
      name: 'Marriott',
      limit: 5
    });

    console.log(`Found ${results.length} results for "Marriott"\n`);

    results.forEach((poi, i) => {
      console.log(`${i + 1}. ${poi.name} (${poi.poi_type})`);
      console.log(`   Location: ${poi.latitude}, ${poi.longitude}`);
      if (poi.city) console.log(`   City: ${poi.city}, ${poi.country_code}`);
      if (poi.google_rating) console.log(`   Rating: ${poi.google_rating} (${poi.google_reviews} reviews)`);
      console.log('');
    });

    // Also test with a different search
    console.log('\nTesting name search for "restaurant"...\n');

    const results2 = await db.searchPOIs({
      name: 'restaurant',
      limit: 5
    });

    console.log(`Found ${results2.length} results for "restaurant"\n`);

    results2.forEach((poi, i) => {
      console.log(`${i + 1}. ${poi.name} (${poi.poi_type})`);
      console.log(`   Location: ${poi.latitude}, ${poi.longitude}`);
      if (poi.city) console.log(`   City: ${poi.city}, ${poi.country_code}`);
      if (poi.google_rating) console.log(`   Rating: ${poi.google_rating} (${poi.google_reviews} reviews)`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await db.close();
  }
}

testNameSearch();
