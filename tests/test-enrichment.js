#!/usr/bin/env node

/**
 * Test Google Places enrichment
 */

import { TravelDatabase } from '../src/database.js';

async function testEnrichment() {
  const db = new TravelDatabase();

  try {
    // Find a Conrad hotel to test
    console.log('Finding Conrad Bangkok for testing...\n');
    const pois = await db.searchPOIs({
      name: 'conrad',
      poiType: 'hotel',
      limit: 1
    });

    if (pois.length === 0) {
      console.log('No Conrad hotel found');
      return;
    }

    const poi = pois[0];
    console.log(`Found: ${poi.name} (OSM ID: ${poi.osm_id})\n`);

    // Get details (should trigger enrichment if not already enriched)
    console.log('Getting POI details (this will trigger enrichment)...\n');
    const details = await db.getPOIDetails(poi.osm_id);

    if (!details) {
      console.log('POI details not found');
      return;
    }

    console.log('POI Details:');
    console.log(`  OSM Name: ${details.osm_name}`);
    console.log(`  Google Name: ${details.google_name || 'Not enriched yet'}`);
    console.log(`  Google Rating: ${details.google_rating || 'Not enriched yet'}`);
    console.log(`  Mapping Status: ${details.mapping_status || 'None'}`);
    console.log(`  Enrichment: ${details._enrichment?.status || 'Unknown'}`);
    console.log(`  Message: ${details._enrichment?.message || 'None'}`);

    if (details._enrichment?.status === 'pending') {
      console.log('\n⏳ Enrichment is running in background. Wait 30-60 seconds and query again.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testEnrichment();
