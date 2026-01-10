#!/usr/bin/env node

import { GooglePlacesClient } from './src/google-places.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Debugging Google Places API ===\n');

  const client = new GooglePlacesClient();

  // Park Hyatt Bangkok coordinates
  const latitude = 13.743899;
  const longitude = 100.547138;
  const name = "Park Hyatt Bangkok";

  console.log(`1. Searching nearby for: ${name}`);
  console.log(`   Location: ${latitude}, ${longitude}\n`);

  try {
    const nearbyResults = await client.searchNearby(latitude, longitude, name, 'lodging', 100);

    console.log(`   Found ${nearbyResults.length} results\n`);

    if (nearbyResults.length > 0) {
      console.log('2. First 3 results:');
      nearbyResults.slice(0, 3).forEach((place, i) => {
        console.log(`\n   ${i + 1}. ${place.displayName?.text || place.displayName}`);
        console.log(`      ID: ${place.id}`);
        console.log(`      Rating: ${place.rating || 'N/A'}`);
        console.log(`      Types: ${place.types ? place.types.slice(0, 3).join(', ') : 'N/A'}`);
      });

      console.log('\n3. Attempting to get details for first result...');
      const firstPlace = nearbyResults[0];
      console.log(`   Place ID: ${firstPlace.id}\n`);

      const details = await client.getPlaceDetails(firstPlace.id);

      if (details) {
        console.log('   ✅ SUCCESS! Details retrieved:');
        console.log(`      Name: ${details.displayName?.text || details.displayName}`);
        console.log(`      Rating: ${details.rating || 'N/A'}`);
        console.log(`      Address: ${details.formattedAddress || 'N/A'}`);
      } else {
        console.log('   ❌ Failed to get details');
      }
    } else {
      console.log('   No results found from nearby search');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
