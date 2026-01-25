#!/usr/bin/env node

/**
 * Debug Google Places enrichment - calls enrichOSMPOI directly
 */

import { TravelDatabase } from '../src/database.js';

async function testEnrichment() {
  const db = new TravelDatabase();

  try {
    const osmId = 7791651369; // Conrad Bangkok Residences

    console.log(`Testing direct enrichment for OSM ID: ${osmId}\n`);

    // First reset the mapping to allow re-enrichment
    console.log('Resetting mapping status...');
    await db.pool.query(`DELETE FROM osm_google_mappings WHERE osm_id = $1`, [osmId]);

    // Initialize Google Places
    await db.ensureGooglePlacesReady();

    if (!db.googlePlaces || !db.googlePlaces.isEnabled()) {
      console.log('Google Places is not enabled!');
      return;
    }

    console.log('Google Places is enabled');

    // Get OSM POI data
    console.log('\nFetching OSM POI data...');
    const osmResult = await db.pool.query(`
      SELECT osm_id, poi_type, name, latitude, longitude
      FROM osm_pois
      WHERE osm_id = $1
    `, [osmId]);

    if (osmResult.rows.length === 0) {
      console.log('OSM POI not found');
      return;
    }

    const osmPOI = osmResult.rows[0];
    console.log('OSM POI:', osmPOI);

    // Try to find matching Google Place
    console.log('\nSearching for matching Google Place...');
    const matchResult = await db.googlePlaces.findMatchingPlace(osmPOI);

    if (!matchResult) {
      console.log('No matching Google Place found');
      return;
    }

    console.log('Match found:', matchResult);

    // Get full place details
    console.log('\nGetting full place details...');
    const placeDetails = await db.googlePlaces.getPlaceDetails(matchResult.place_id);

    if (!placeDetails) {
      console.log('Failed to get place details');
      return;
    }

    console.log('Place details retrieved:');
    console.log('  ID:', placeDetails.id);
    console.log('  Name:', placeDetails.displayName);
    console.log('  Rating:', placeDetails.rating);
    console.log('  Reviews:', placeDetails.userRatingCount);

    // Now call the actual enrichment function
    console.log('\nCalling enrichOSMPOI...');
    await db.enrichOSMPOI(osmId);

    // Check the result
    console.log('\nChecking mapping after enrichment...');
    const mapping = await db.pool.query(`
      SELECT osm_id, google_place_id, mapping_status, mapping_notes, mapped_at
      FROM osm_google_mappings
      WHERE osm_id = $1
    `, [osmId]);

    if (mapping.rows.length > 0) {
      console.log('Mapping result:', mapping.rows[0]);
    } else {
      console.log('No mapping created!');
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

testEnrichment();
