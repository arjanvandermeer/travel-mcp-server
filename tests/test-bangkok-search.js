#!/usr/bin/env node

/**
 * Test Bangkok hotel search with automatic enrichment
 */

import { TravelDatabase } from './src/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Testing Bangkok Hotel Search with Auto-Enrichment ===\n');

  const db = new TravelDatabase();

  try {
    console.log('1. Searching for hotels in Bangkok...');

    const result = await db.unifiedSearchPOIs({
      cityName: 'Bangkok',
      countryCode: 'TH',
      poiType: 'hotel',
      limit: 10,
    });

    console.log('   Search completed!');
    console.log('   City:', result.city?.name);
    console.log('   Hotels found:', result.count);
    console.log('');

    if (result.pois && result.pois.length > 0) {
      console.log('2. Hotels returned:');
      result.pois.forEach((hotel, i) => {
        console.log(`   ${i + 1}. ${hotel.name || 'Unnamed'} (OSM ${hotel.osm_id})`);
      });
      console.log('');

      const osmIds = result.pois.map(p => p.osm_id);

      console.log('3. Waiting 10 seconds for background enrichment...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      console.log('');
      console.log('4. Checking enrichment results...');

      const enrichmentCheck = await db.pool.query(`
        SELECT
          osm_id,
          name,
          google_enrichment_status,
          google_place_id,
          google_rating,
          google_user_ratings_total
        FROM pois
        WHERE osm_id = ANY($1)
        ORDER BY osm_id
      `, [osmIds]);

      enrichmentCheck.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.name || 'Unnamed'}:`);
        console.log(`      Status: ${row.google_enrichment_status || 'not enriched'}`);
        if (row.google_rating) {
          console.log(`      Rating: ${row.google_rating}★ (${row.google_user_ratings_total} reviews)`);
          console.log(`      Google Place ID: ${row.google_place_id}`);
        }
      });

      const totalEnriched = await db.pool.query(`
        SELECT COUNT(*) as count
        FROM pois
        WHERE google_enrichment_status = 'enriched'
      `);

      console.log('');
      console.log(`Total enriched POIs in entire database: ${totalEnriched.rows[0].count}`);

    } else {
      console.log('   ❌ No hotels found!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

test();
