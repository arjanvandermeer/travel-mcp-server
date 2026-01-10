#!/usr/bin/env node

/**
 * Debug why Paradox Resort Phuket enrichment fails
 */

import { GooglePlacesClient } from './src/google-places.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Debugging Paradox Resort Phuket ===\n');

  const client = new GooglePlacesClient();

  // Paradox Resort Phuket coordinates from OSM
  const latitude = 7.845832700000001;
  const longitude = 98.29689820000002;
  const name = "Paradox Resort Phuket";

  console.log(`Target: ${name}`);
  console.log(`Location: ${latitude}, ${longitude}\n`);

  // Test 1: Nearby search with 100m radius (current default)
  console.log('1. Testing nearby search with 100m radius...');
  try {
    const results100 = await client.searchNearby(latitude, longitude, name, 'lodging', 100);
    console.log(`   Found ${results100.length} results`);
    if (results100.length > 0) {
      results100.forEach((place, i) => {
        console.log(`   ${i + 1}. ${place.displayName?.text || place.displayName}`);
        console.log(`      ID: ${place.id}`);
        console.log(`      Rating: ${place.rating || 'N/A'}`);
      });
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  console.log('');

  // Test 2: Nearby search with 500m radius
  console.log('2. Testing nearby search with 500m radius...');
  try {
    const results500 = await client.searchNearby(latitude, longitude, name, 'lodging', 500);
    console.log(`   Found ${results500.length} results`);
    if (results500.length > 0) {
      results500.slice(0, 5).forEach((place, i) => {
        console.log(`   ${i + 1}. ${place.displayName?.text || place.displayName}`);
        console.log(`      ID: ${place.id}`);
        console.log(`      Rating: ${place.rating || 'N/A'}`);
      });
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  console.log('');

  // Test 3: Text search with exact name
  console.log('3. Testing text search with exact name...');
  try {
    const textResults1 = await client.searchText(name, latitude, longitude);
    console.log(`   Found ${textResults1.length} results`);
    if (textResults1.length > 0) {
      textResults1.slice(0, 3).forEach((place, i) => {
        console.log(`   ${i + 1}. ${place.displayName?.text || place.displayName}`);
        console.log(`      ID: ${place.id}`);
        console.log(`      Rating: ${place.rating || 'N/A'}`);
      });
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  console.log('');

  // Test 4: Text search with name + location (current fallback format)
  console.log('4. Testing text search with name + coordinates (current fallback)...');
  const textQuery = `${name}, ${latitude}, ${longitude}`;
  console.log(`   Query: "${textQuery}"`);
  try {
    const textResults2 = await client.searchText(textQuery, latitude, longitude);
    console.log(`   Found ${textResults2.length} results`);
    if (textResults2.length > 0) {
      textResults2.slice(0, 3).forEach((place, i) => {
        console.log(`   ${i + 1}. ${place.displayName?.text || place.displayName}`);
        console.log(`      ID: ${place.id}`);
        console.log(`      Rating: ${place.rating || 'N/A'}`);
      });
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  console.log('');

  // Test 5: Text search with name + "Phuket"
  console.log('5. Testing text search with name + "Phuket"...');
  const textQuery2 = `${name} Phuket`;
  console.log(`   Query: "${textQuery2}"`);
  try {
    const textResults3 = await client.searchText(textQuery2, latitude, longitude);
    console.log(`   Found ${textResults3.length} results`);
    if (textResults3.length > 0) {
      textResults3.slice(0, 3).forEach((place, i) => {
        console.log(`   ${i + 1}. ${place.displayName?.text || place.displayName}`);
        console.log(`      ID: ${place.id}`);
        console.log(`      Rating: ${place.rating || 'N/A'}`);
      });
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }

  console.log('');

  // Test 6: Name matching algorithm
  console.log('6. Testing name matching algorithm...');
  try {
    const testResults = await client.searchNearby(latitude, longitude, name, 'lodging', 1000);
    console.log(`   Found ${testResults.length} results within 1000m`);

    if (testResults.length > 0) {
      const normalized = (str) => str.toLowerCase().trim().replace(/[^\w\s]/g, '');
      const target = normalized(name);
      console.log(`   Target normalized: "${target}"`);
      console.log('');
      console.log('   Similarity scores:');

      testResults.slice(0, 10).forEach((result, i) => {
        const resultName = result.displayName?.text || result.displayName || '';
        const candidate = normalized(resultName);

        let score = 0;
        if (candidate === target) {
          score = 1.0;
        } else if (candidate.includes(target) || target.includes(candidate)) {
          score = Math.min(target.length, candidate.length) / Math.max(target.length, candidate.length);
        }

        console.log(`   ${i + 1}. ${resultName}`);
        console.log(`      Normalized: "${candidate}"`);
        console.log(`      Score: ${score.toFixed(2)} ${score > 0.6 ? '✅' : '❌'}`);
      });
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`);
  }
}

test();
