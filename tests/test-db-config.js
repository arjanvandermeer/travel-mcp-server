#!/usr/bin/env node

/**
 * Test database config system
 */

import { TravelDatabase } from './src/database.js';

async function test() {
  console.log('=== Testing Database Config System ===\n');

  const db = new TravelDatabase();

  // Wait for async initialization
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('1. Reading Google Places config from database...');
  const apiKey = await db.getConfig('google_places_api_key');
  const enabled = await db.getConfig('google_places_enabled');
  const cacheHours = await db.getConfig('google_places_cache_hours');

  console.log(`   API Key: ${apiKey ? apiKey.substring(0, 20) + '...' : 'NOT SET'}`);
  console.log(`   Enabled: ${enabled}`);
  console.log(`   Cache Hours: ${cacheHours}`);
  console.log('');

  console.log('2. Checking Google Places client...');
  console.log(`   Client initialized: ${db.googlePlaces ? 'YES' : 'NO'}`);
  console.log(`   Client enabled: ${db.googlePlaces?.isEnabled() ? 'YES' : 'NO'}`);
  console.log('');

  if (db.googlePlaces?.isEnabled()) {
    console.log('3. Testing Google Places search...');
    const results = await db.googlePlaces.searchText('Park Hyatt Bangkok');
    console.log(`   Found ${results.length} results`);
    if (results.length > 0) {
      console.log(`   First result: ${results[0].displayName?.text || results[0].displayName}`);
      console.log(`   ✅ Google Places API is working!`);
    }
  }

  await db.close();
}

test();
