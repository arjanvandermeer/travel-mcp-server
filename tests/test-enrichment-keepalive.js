#!/usr/bin/env node

/**
 * Test enrichment with pool kept alive
 */

import { TravelDatabase } from '../src/database.js';

async function testEnrichment() {
  const db = new TravelDatabase();

  try {
    const osmId = 7791651369;

    // Reset mapping first
    console.log('Resetting mapping...');
    await db.pool.query(`DELETE FROM osm_google_mappings WHERE osm_id = $1`, [osmId]);
    await db.pool.query(`DELETE FROM google_places WHERE google_place_id = 'ChIJQ4RTOMmf4jARJPxpkBTSxR8'`);

    console.log('\nGetting POI details (triggers background enrichment)...');
    const details = await db.getPOIDetails(osmId);

    console.log(`Status: ${details._enrichment?.status}`);
    console.log(`Message: ${details._enrichment?.message}\n`);

    if (details._enrichment?.status === 'pending') {
      console.log('Waiting 5 seconds for background enrichment to complete...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check mapping status
      const mapping = await db.pool.query(`
        SELECT osm_id, google_place_id, mapping_status FROM osm_google_mappings WHERE osm_id = $1
      `, [osmId]);

      console.log('Mapping after wait:', mapping.rows[0]);

      // Get details again
      const details2 = await db.getPOIDetails(osmId);
      console.log(`\nFinal status: ${details2._enrichment?.status}`);
      console.log(`Google Name: ${details2.google_name}`);
      console.log(`Google Rating: ${details2.google_rating}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testEnrichment();
