#!/usr/bin/env node

/**
 * Test Google Places API integration
 */

import { TravelDatabase } from './src/database-postgres.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Testing Google Places Integration ===\n');

  // Check environment variables
  console.log('1. Environment Variables:');
  console.log('   GOOGLE_PLACES_API_KEY:', process.env.GOOGLE_PLACES_API_KEY ? `Set (${process.env.GOOGLE_PLACES_API_KEY.substring(0, 10)}...)` : 'NOT SET');
  console.log('   GOOGLE_PLACES_ENABLED:', process.env.GOOGLE_PLACES_ENABLED);
  console.log('   GOOGLE_PLACES_CACHE_HOURS:', process.env.GOOGLE_PLACES_CACHE_HOURS);
  console.log('');

  const db = new TravelDatabase();

  try {
    // Check if Google Places client is enabled
    console.log('2. Google Places Client Status:');
    console.log('   Enabled:', db.googlePlaces.isEnabled());
    console.log('');

    // Get a sample hotel to test with
    console.log('3. Finding a sample hotel to test...');
    const result = await db.pool.query(`
      SELECT osm_id, name, poi_type, latitude, longitude, google_enrichment_status
      FROM pois
      WHERE poi_type = 'hotel'
        AND name IS NOT NULL
        AND name != ''
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('   ❌ No hotels found in database');
      await db.close();
      return;
    }

    const hotel = result.rows[0];
    console.log('   Found hotel:', hotel.name);
    console.log('   OSM ID:', hotel.osm_id);
    console.log('   Location:', hotel.latitude, hotel.longitude);
    console.log('   Current enrichment status:', hotel.google_enrichment_status || 'null');
    console.log('');

    // Test enrichment
    console.log('4. Testing enrichment...');
    console.log('   Calling enrichPOIWithGooglePlaces()...');

    await db.enrichPOIWithGooglePlaces(hotel.osm_id);

    // Wait a bit for the enrichment to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check the result
    console.log('');
    console.log('5. Checking enrichment result...');
    const enrichedResult = await db.pool.query(`
      SELECT
        osm_id, name,
        google_place_id, google_rating, google_user_ratings_total,
        google_enrichment_status, google_enriched_at
      FROM pois
      WHERE osm_id = $1
    `, [hotel.osm_id]);

    const enriched = enrichedResult.rows[0];
    console.log('   Enrichment status:', enriched.google_enrichment_status);
    console.log('   Google Place ID:', enriched.google_place_id || 'null');
    console.log('   Rating:', enriched.google_rating || 'null');
    console.log('   Reviews:', enriched.google_user_ratings_total || 'null');
    console.log('   Enriched at:', enriched.google_enriched_at || 'null');
    console.log('');

    if (enriched.google_enrichment_status === 'enriched') {
      console.log('✅ SUCCESS: Hotel was enriched with Google Places data!');
    } else if (enriched.google_enrichment_status === 'not_found') {
      console.log('⚠️  Google Places could not find a match for this hotel');
      console.log('   This is normal - not all OSM places exist in Google Places');
    } else if (enriched.google_enrichment_status === 'error') {
      console.log('❌ ERROR: Enrichment failed');
    } else {
      console.log('⏳ Enrichment status is still:', enriched.google_enrichment_status);
    }

  } catch (error) {
    console.error('❌ Error during test:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

test();
