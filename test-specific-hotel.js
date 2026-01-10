#!/usr/bin/env node

/**
 * Test specific hotel enrichment - Paradox Resort Phuket
 */

import { TravelDatabase } from './src/database-postgres.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Testing Paradox Resort Phuket Enrichment ===\n');

  const db = new TravelDatabase();

  try {
    const osmId = 11773165804; // Paradox Resort Phuket

    console.log(`1. Enriching OSM ID ${osmId}...`);
    await db.enrichPOIWithGooglePlaces(osmId);

    console.log('2. Waiting 8 seconds for enrichment...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log('');
    console.log('3. Checking result...\n');

    const result = await db.pool.query(`
      SELECT
        osm_id,
        name,
        latitude,
        longitude,
        google_enrichment_status,
        google_place_id,
        google_rating,
        google_user_ratings_total,
        google_formatted_address,
        google_phone,
        google_website,
        google_price_level,
        google_types
      FROM pois
      WHERE osm_id = $1
    `, [osmId]);

    const poi = result.rows[0];
    console.log(`📍 ${poi.name}`);
    console.log(`   Location: ${poi.latitude}, ${poi.longitude}`);
    console.log(`   Status: ${poi.google_enrichment_status || 'not enriched'}`);
    console.log('');

    if (poi.google_enrichment_status === 'enriched' && poi.google_rating) {
      console.log('✅ SUCCESS! Google Places enrichment:');
      console.log('');
      console.log(`   ⭐ Rating: ${poi.google_rating}/5.0 (${poi.google_user_ratings_total} reviews)`);
      console.log(`   📍 Place ID: ${poi.google_place_id}`);
      console.log(`   📫 Address: ${poi.google_formatted_address || 'N/A'}`);
      console.log(`   📞 Phone: ${poi.google_phone || 'N/A'}`);
      console.log(`   🌐 Website: ${poi.google_website || 'N/A'}`);
      console.log(`   💰 Price Level: ${poi.google_price_level || 'N/A'}`);
      console.log(`   🏷️  Types: ${poi.google_types ? poi.google_types.join(', ') : 'N/A'}`);
    } else if (poi.google_enrichment_status === 'not_found') {
      console.log('ℹ️  Google Places could not find this hotel');
    } else {
      console.log('⏳ Enrichment not completed yet or failed');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

test();
