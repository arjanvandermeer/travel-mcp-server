#!/usr/bin/env node

/**
 * Debug the full enrichment flow for Paradox Resort Phuket
 */

import { GooglePlacesClient } from './src/google-places.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Debugging Full Enrichment Flow ===\n');

  const client = new GooglePlacesClient();

  // Simulate POI data as it comes from database
  const poi = {
    osm_id: 11773165804,
    name: "Paradox Resort Phuket",
    latitude: 7.845832700000001,
    longitude: 98.29689820000002,
    poi_type: "hotel",
    google_place_id: null, // Not yet enriched
  };

  console.log('POI from database:');
  console.log(JSON.stringify(poi, null, 2));
  console.log('');

  console.log('Step 1: findMatchingPlace()...');
  const match = await client.findMatchingPlace(poi);
  console.log('Match result:');
  console.log(JSON.stringify(match, null, 2));
  console.log('');

  if (match) {
    console.log('Step 2: getPlaceDetails()...');
    const details = await client.getPlaceDetails(match.place_id);
    console.log('Details result:');
    console.log(JSON.stringify(details, null, 2));
    console.log('');

    console.log('Step 3: enrichPOI() - full flow...');
    const enrichment = await client.enrichPOI(poi);
    console.log('Enrichment result:');
    console.log(JSON.stringify(enrichment, null, 2));
  } else {
    console.log('❌ findMatchingPlace() returned null!');
  }
}

test();
