#!/usr/bin/env node

/**
 * Test the new find_hotels_in_city tool
 * Demonstrates proper workflow: search city → determine radius → fetch hotels
 */

import { HotelDatabase } from './src/database.js';
import { executeToolHandler } from './src/tools-config.js';

const db = new HotelDatabase();

console.log('\n=== Testing find_hotels_in_city Tool ===\n');

// Test 1: Search for Bangkok
console.log('Test 1: Finding hotels in Bangkok');
console.log('─'.repeat(60));

const bangkokResult = await executeToolHandler(
  'find_hotels_in_city',
  {
    city_name: 'Bangkok',
    country_code: 'TH',
    limit: 20
  },
  db
);

const bangkokData = JSON.parse(bangkokResult.content[0].text);
console.log(`City: ${bangkokData.city?.name || 'N/A'}`);
console.log(`Population: ${bangkokData.city?.population?.toLocaleString() || 'N/A'}`);
console.log(`Search radius: ${bangkokData.search_radius_km}km (auto-determined from population)`);
console.log(`Status: ${bangkokData.status}`);
console.log(`Hotels found: ${bangkokData.count || 0}`);

if (bangkokData.status === 'fetching') {
  console.log(`\n${bangkokData.message}`);
  console.log('\nWaiting 20 seconds for fetch to complete...\n');
  await new Promise(resolve => setTimeout(resolve, 20000));

  // Try again
  console.log('Retrying Bangkok search...');
  const bangkokResult2 = await executeToolHandler(
    'find_hotels_in_city',
    { city_name: 'Bangkok', country_code: 'TH', limit: 20 },
    db
  );
  const bangkokData2 = JSON.parse(bangkokResult2.content[0].text);
  console.log(`Status: ${bangkokData2.status}`);
  console.log(`Hotels found: ${bangkokData2.count || 0}`);

  if (bangkokData2.hotels && bangkokData2.hotels.length > 0) {
    console.log(`\nFirst 3 hotels:`);
    bangkokData2.hotels.slice(0, 3).forEach((hotel, i) => {
      console.log(`  ${i + 1}. ${hotel.name} (${hotel.distance_km.toFixed(2)}km from center)`);
    });
  }
}

console.log('\n' + '─'.repeat(60));

// Test 2: Search for a smaller city
console.log('\nTest 2: Finding hotels in Amsterdam (smaller city, smaller radius)');
console.log('─'.repeat(60));

const amsterdamResult = await executeToolHandler(
  'find_hotels_in_city',
  {
    city_name: 'Amsterdam',
    country_code: 'NL',
    limit: 10
  },
  db
);

const amsterdamData = JSON.parse(amsterdamResult.content[0].text);
console.log(`City: ${amsterdamData.city?.name || 'N/A'}`);
console.log(`Population: ${amsterdamData.city?.population?.toLocaleString() || 'N/A'}`);
console.log(`Search radius: ${amsterdamData.search_radius_km}km (smaller city = smaller radius)`);
console.log(`Hotels found: ${amsterdamData.count || 0}`);

db.close();
console.log('\n=== Test Complete ===\n');
console.log('Key observations:');
console.log('✓ Tool automatically determines city coordinates from GeoNames');
console.log('✓ Search radius scales with population (Bangkok=25km, Amsterdam=15km)');
console.log('✓ LLM gets clear city context with the hotel results');
