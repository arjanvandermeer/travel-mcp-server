#!/usr/bin/env node

/**
 * Test that null fields are properly removed from API responses
 */

import TravelDatabase from '../src/database.js';

async function testNullFieldRemoval() {
  const db = new TravelDatabase();

  try {
    console.log('Testing null field removal in API responses...\n');

    // Test 1: Search POIs (should have no null fields)
    console.log('1. Testing searchPOIs()...');
    const searchResults = await db.searchPOIs({
      name: 'hotel',
      limit: 3
    });

    if (searchResults.length > 0) {
      const firstResult = searchResults[0];
      const hasNullFields = Object.values(firstResult).some(v => v === null);

      console.log(`   Found ${searchResults.length} results`);
      console.log(`   First result has null fields: ${hasNullFields ? '❌ YES' : '✅ NO'}`);
      console.log(`   Fields in first result: ${Object.keys(firstResult).join(', ')}`);
    } else {
      console.log('   No results found');
    }

    // Test 2: Get POI details (should have no null fields except in _enrichment message)
    console.log('\n2. Testing getPOIDetails()...');
    if (searchResults.length > 0) {
      const osmId = searchResults[0].osm_id;
      const details = await db.getPOIDetails(osmId);

      if (details) {
        // Check for null fields excluding _enrichment.message which can be null
        const fieldsWithNull = Object.entries(details)
          .filter(([key, value]) => value === null && key !== '_enrichment')
          .map(([key]) => key);

        console.log(`   Retrieved details for OSM ID: ${osmId}`);
        console.log(`   Has null fields: ${fieldsWithNull.length > 0 ? '❌ YES' : '✅ NO'}`);

        if (fieldsWithNull.length > 0) {
          console.log(`   Null fields found: ${fieldsWithNull.join(', ')}`);
        }

        console.log(`   Total fields: ${Object.keys(details).length}`);
        console.log(`   Enrichment status: ${details._enrichment?.status || 'none'}`);
      }
    }

    // Test 3: Search cities (should have no null fields)
    console.log('\n3. Testing searchCities()...');
    const cities = await db.searchCities('Bangkok', null, 1);

    if (cities.length > 0) {
      const city = cities[0];
      const hasNullFields = Object.values(city).some(v => v === null);

      console.log(`   Found city: ${city.name}`);
      console.log(`   Has null fields: ${hasNullFields ? '❌ YES' : '✅ NO'}`);
      console.log(`   Fields: ${Object.keys(city).join(', ')}`);
    }

    // Test 4: Get stats (should have no null fields)
    console.log('\n4. Testing getStats()...');
    const stats = await db.getStats();

    const checkObjectForNull = (obj, path = '') => {
      let nullFields = [];
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key;
        if (value === null) {
          nullFields.push(fullPath);
        } else if (typeof value === 'object' && value !== null) {
          if (Array.isArray(value)) {
            value.forEach((item, idx) => {
              if (typeof item === 'object' && item !== null) {
                nullFields.push(...checkObjectForNull(item, `${fullPath}[${idx}]`));
              } else if (item === null) {
                nullFields.push(`${fullPath}[${idx}]`);
              }
            });
          } else {
            nullFields.push(...checkObjectForNull(value, fullPath));
          }
        }
      }
      return nullFields;
    };

    const nullFields = checkObjectForNull(stats);
    console.log(`   Has null fields: ${nullFields.length > 0 ? '❌ YES' : '✅ NO'}`);

    if (nullFields.length > 0) {
      console.log(`   Null fields found: ${nullFields.join(', ')}`);
    }

    console.log(`   Stats keys: ${Object.keys(stats).join(', ')}`);

    console.log('\n✅ Null field removal test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  } finally {
    await db.close();
  }
}

testNullFieldRemoval();
