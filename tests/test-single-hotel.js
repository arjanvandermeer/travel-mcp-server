#!/usr/bin/env node

/**
 * Test single hotel enrichment
 */

import { TravelDatabase } from './src/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Testing Single Hotel Enrichment ===\n');

  const db = new TravelDatabase();

  try {
    const osmId = 1178817334; // Krabi Grand Hotel

    console.log(`1. Triggering enrichment for OSM ID ${osmId}...`);
    await db.enrichPOIWithGooglePlaces(osmId);

    console.log('2. Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('');
    console.log('3. Checking result...');

    const result = await db.pool.query(`
      SELECT
        osm_id,
        name,
        google_enrichment_status,
        google_place_id,
        google_rating,
        google_user_ratings_total,
        google_formatted_address,
        google_phone,
        google_website
      FROM pois
      WHERE osm_id = $1
    `, [osmId]);

    const poi = result.rows[0];
    console.log(`   Name: ${poi.name}`);
    console.log(`   Status: ${poi.google_enrichment_status || 'not enriched'}`);

    if (poi.google_rating) {
      console.log(`   ✅ Successfully enriched!`);
      console.log(`   Rating: ${poi.google_rating}★ (${poi.google_user_ratings_total} reviews)`);
      console.log(`   Google Place ID: ${poi.google_place_id}`);
      console.log(`   Address: ${poi.google_formatted_address}`);
      console.log(`   Phone: ${poi.google_phone || 'N/A'}`);
      console.log(`   Website: ${poi.google_website || 'N/A'}`);
    } else {
      console.log(`   ℹ️  No Google Places data found`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

test();
