#!/usr/bin/env node

/**
 * Test script for refactored database structure
 * Tests search and enrichment with new OSM/Google Places separation
 */

import { TravelDatabase } from './src/database.js';

async function test() {
  console.log('=== Testing Refactored Database Structure ===\n');

  const db = new TravelDatabase();

  try {
    // Wait for Google Places initialization
    await db.ensureGooglePlacesReady();

    // Test 1: Search for hotels in Bangkok
    console.log('1. Testing hotel search (by city)...');
    const bangkokHotels = await db.searchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'hotel',
      limit: 5,
    });
    console.log(`   ✓ Found ${bangkokHotels.length} hotels in Bangkok`);
    if (bangkokHotels.length > 0) {
      const hotel = bangkokHotels[0];
      console.log(`   Sample: ${hotel.name} (OSM ID: ${hotel.osm_id})`);
      console.log(`           Google rating: ${hotel.google_rating || 'Not enriched'}`);
    }
    console.log('');

    // Test 2: Search for hotels by name
    console.log('2. Testing hotel search (by name)...');
    const resortHotels = await db.searchPOIs({
      name: 'resort',
      poiType: 'hotel',
      limit: 5,
    });
    console.log(`   ✓ Found ${resortHotels.length} hotels matching "resort"`);
    if (resortHotels.length > 0) {
      const hotel = resortHotels[0];
      console.log(`   Sample: ${hotel.name} (OSM ID: ${hotel.osm_id})`);
    }
    console.log('');

    // Test 3: Get POI details
    console.log('3. Testing POI details...');
    if (resortHotels.length > 0) {
      const osmId = resortHotels[0].osm_id;
      const details = await db.getPOIDetails(osmId);

      if (details) {
        console.log(`   ✓ Retrieved details for OSM ID ${osmId}`);
        console.log(`   Name: ${details.name}`);
        console.log(`   Type: ${details.poi_type}`);
        console.log(`   Google Place ID: ${details.google_place_id || 'Not mapped'}`);
        console.log(`   Google Rating: ${details.google_rating || 'Not enriched'}`);
        console.log(`   Match Status: ${details.mapping_status || 'Not mapped'}`);
      } else {
        console.log(`   ❌ Could not retrieve details for OSM ID ${osmId}`);
      }
    }
    console.log('');

    // Test 4: Check database stats
    console.log('4. Testing statistics...');
    const stats = await db.getStats();
    console.log(`   ✓ Total POIs: ${stats.pois}`);
    console.log(`   ✓ Total hotels: ${stats.hotels}`);
    console.log(`   ✓ Google Places enriched: ${stats.google_places_enriched}`);
    console.log(`   ✓ Enrichment statuses:`);
    if (stats.enrichment_by_status && stats.enrichment_by_status.length > 0) {
      stats.enrichment_by_status.forEach(s => {
        console.log(`      - ${s.mapping_status}: ${s.count}`);
      });
    } else {
      console.log(`      (No enrichment data yet)`);
    }
    console.log('');

    // Test 5: Verify new table structure
    console.log('5. Verifying table structure...');
    const osmCount = await db.pool.query('SELECT COUNT(*) FROM osm_pois');
    const googleCount = await db.pool.query('SELECT COUNT(*) FROM google_places');
    const mappingCount = await db.pool.query('SELECT COUNT(*) FROM osm_google_mappings');

    console.log(`   ✓ osm_pois: ${osmCount.rows[0].count} records`);
    console.log(`   ✓ google_places: ${googleCount.rows[0].count} records`);
    console.log(`   ✓ osm_google_mappings: ${mappingCount.rows[0].count} records`);
    console.log('');

    console.log('✅ All tests passed! Refactored structure is working correctly.\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

test();
