#!/usr/bin/env node

/**
 * Debug enrichment errors
 */

import { TravelDatabase } from './src/database.js';

async function test() {
  console.log('=== Debugging Enrichment Errors ===\n');

  const db = new TravelDatabase();

  // Wait for initialization
  await db.ensureGooglePlacesReady();

  try {
    // Test the Starbucks that had an error
    const osmId = 1342032643;

    console.log('1. Getting POI details...');
    const result = await db.pool.query(`
      SELECT osm_id, name, latitude, longitude, poi_type
      FROM pois
      WHERE osm_id = $1
    `, [osmId]);

    const poi = result.rows[0];
    console.log(`   Name: ${poi.name}`);
    console.log(`   Location: ${poi.latitude}, ${poi.longitude}`);
    console.log(`   Type: ${poi.poi_type}`);
    console.log('');

    console.log('2. Testing Google Places search...');
    try {
      const nearbyResults = await db.googlePlaces.searchNearby(
        poi.latitude,
        poi.longitude,
        poi.name,
        'cafe',
        100
      );
      console.log(`   Found ${nearbyResults.length} nearby results`);

      if (nearbyResults.length > 0) {
        const match = db.googlePlaces.findBestNameMatch(poi.name, nearbyResults);
        if (match) {
          console.log(`   Best match: ${match.displayName?.text || match.displayName}`);
          console.log(`   Place ID: ${match.id}`);
          console.log('');

          console.log('3. Testing Place Details...');
          const details = await db.googlePlaces.getPlaceDetails(match.id);
          if (details) {
            console.log(`   ✅ Details retrieved successfully`);
            console.log(`   Rating: ${details.rating || 'N/A'}`);
            console.log(`   Address: ${details.formattedAddress || 'N/A'}`);
          } else {
            console.log(`   ❌ Failed to get details`);
          }
        } else {
          console.log('   No good name match found');
        }
      }
    } catch (error) {
      console.error('   ❌ Error:', error.message);
      console.error('   Stack:', error.stack);
    }

    console.log('');
    console.log('4. Clearing error status and retrying enrichment...');
    await db.pool.query(`
      UPDATE pois
      SET google_enrichment_status = NULL, google_enriched_at = NULL
      WHERE osm_id = $1
    `, [osmId]);

    console.log('   Triggering enrichment...');
    await db.enrichPOIWithGooglePlaces(osmId);

    await new Promise(resolve => setTimeout(resolve, 3000));

    const checkResult = await db.pool.query(`
      SELECT google_enrichment_status, google_rating, google_place_id
      FROM pois
      WHERE osm_id = $1
    `, [osmId]);

    const status = checkResult.rows[0];
    console.log(`   Status: ${status.google_enrichment_status}`);
    if (status.google_rating) {
      console.log(`   ✅ Successfully enriched! Rating: ${status.google_rating}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

test();
