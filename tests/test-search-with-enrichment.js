#!/usr/bin/env node

/**
 * Test hotel search with automatic enrichment
 * Simulates what happens when Claude Desktop calls search_hotels
 */

import { TravelDatabase } from './src/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('=== Testing Hotel Search with Auto-Enrichment ===\n');

  const db = new TravelDatabase();

  try {
    console.log('1. Google Places Status:');
    console.log('   Enabled:', db.googlePlaces.isEnabled());
    console.log('   API Key:', process.env.GOOGLE_PLACES_API_KEY ? 'Set' : 'NOT SET');
    console.log('');

    console.log('2. Searching for hotels near Khao Lak...');

    // This simulates what happens when you search for hotels via MCP
    const result = await db.unifiedSearchPOIs({
      cityName: 'Khao Lak',
      countryCode: 'TH',
      poiType: 'hotel',
      limit: 10,
    });

    console.log('   Search completed!');
    console.log('   City found:', result.city?.name);
    console.log('   Hotels found:', result.count);
    console.log('');

    if (result.pois && result.pois.length > 0) {
      console.log('3. Top hotels:');
      result.pois.slice(0, 5).forEach((hotel, i) => {
        console.log(`   ${i + 1}. ${hotel.name || 'Unnamed'} (OSM ID: ${hotel.osm_id})`);
      });
      console.log('');

      console.log('4. Background enrichment should have been triggered...');
      console.log('   Waiting 5 seconds for enrichment to complete...');

      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log('');
      console.log('5. Checking enrichment status...');

      const enrichmentCheck = await db.pool.query(`
        SELECT
          google_enrichment_status,
          COUNT(*) as count
        FROM pois
        WHERE osm_id = ANY($1)
        GROUP BY google_enrichment_status
      `, [result.pois.slice(0, 10).map(p => p.osm_id)]);

      console.log('   Enrichment status for searched hotels:');
      enrichmentCheck.rows.forEach(row => {
        console.log(`   - ${row.google_enrichment_status || 'null'}: ${row.count} hotels`);
      });
      console.log('');

      // Show detailed results for first few
      const detailedResults = await db.pool.query(`
        SELECT
          osm_id, name,
          google_enrichment_status,
          google_rating,
          google_user_ratings_total
        FROM pois
        WHERE osm_id = ANY($1)
        ORDER BY osm_id
        LIMIT 5
      `, [result.pois.slice(0, 10).map(p => p.osm_id)]);

      console.log('6. Detailed enrichment results (first 5 hotels):');
      detailedResults.rows.forEach(row => {
        console.log(`   ${row.name || 'Unnamed'}:`);
        console.log(`     Status: ${row.google_enrichment_status || 'null'}`);
        if (row.google_rating) {
          console.log(`     Rating: ${row.google_rating} (${row.google_user_ratings_total} reviews)`);
        }
      });

      const enrichedCount = await db.pool.query(`
        SELECT COUNT(*) as count
        FROM pois
        WHERE google_enrichment_status = 'enriched'
      `);

      console.log('');
      console.log(`Total enriched POIs in database: ${enrichedCount.rows[0].count}`);

    } else {
      console.log('   ❌ No hotels found!');
    }

  } catch (error) {
    console.error('❌ Error during test:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

test();
