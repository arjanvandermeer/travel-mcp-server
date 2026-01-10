#!/usr/bin/env node

import { TravelDatabase } from './src/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Testing Park Hyatt Bangkok Enrichment ===\n');

  const db = new TravelDatabase();

  try {
    const osmId = 6688470995;

    console.log(`1. Enriching Park Hyatt Bangkok (OSM ${osmId})...`);
    await db.enrichPOIWithGooglePlaces(osmId);

    console.log('2. Waiting 8 seconds for enrichment...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log('\n3. Checking result...\n');

    const result = await db.pool.query(`
      SELECT
        osm_id, name, latitude, longitude,
        google_enrichment_status, google_place_id,
        google_rating, google_user_ratings_total,
        google_formatted_address, google_phone,
        google_website, google_price_level, google_types
      FROM pois WHERE osm_id = $1
    `, [osmId]);

    const poi = result.rows[0];
    console.log(`📍 ${poi.name}`);
    console.log(`   Location: ${poi.latitude}, ${poi.longitude}`);
    console.log(`   Status: ${poi.google_enrichment_status || 'not enriched'}\n`);

    if (poi.google_enrichment_status === 'enriched' && poi.google_rating) {
      console.log('✅ SUCCESS! Google Places enrichment:\n');
      console.log(`   ⭐ Rating: ${poi.google_rating}/5.0 (${poi.google_user_ratings_total} reviews)`);
      console.log(`   📍 Place ID: ${poi.google_place_id}`);
      console.log(`   📫 Address: ${poi.google_formatted_address || 'N/A'}`);
      console.log(`   📞 Phone: ${poi.google_phone || 'N/A'}`);
      console.log(`   🌐 Website: ${poi.google_website || 'N/A'}`);
      console.log(`   💰 Price Level: ${poi.google_price_level || 'N/A'}`);
      console.log(`   🏷️  Types: ${poi.google_types ? poi.google_types.slice(0, 5).join(', ') : 'N/A'}`);
    } else {
      console.log(`ℹ️  Status: ${poi.google_enrichment_status}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await db.close();
  }
}

test();
