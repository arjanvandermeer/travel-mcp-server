#!/usr/bin/env node

import { HotelDatabase } from './database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Query Overpass API for hotels in a bounding box
 *
 * Overpass API query format:
 * [out:json];
 * (
 *   node["tourism"="hotel"](bbox);
 *   way["tourism"="hotel"](bbox);
 *   relation["tourism"="hotel"](bbox);
 * );
 * out body;
 * >;
 * out skel qt;
 */
async function queryOverpassAPI(south, west, north, east) {
  const query = `
    [out:json][timeout:60];
    (
      node["tourism"="hotel"](${south},${west},${north},${east});
      way["tourism"="hotel"](${south},${west},${north},${east});
      relation["tourism"="hotel"](${south},${west},${north},${east});
    );
    out body center;
  `;

  const url = 'https://overpass-api.de/api/interpreter';

  console.log(`  Querying Overpass API for bbox: [${south}, ${west}, ${north}, ${east}]`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`  Found ${data.elements?.length || 0} hotel elements`);
    return data.elements || [];
  } catch (error) {
    console.error(`  Error querying Overpass API: ${error.message}`);
    return [];
  }
}

/**
 * Extract hotel information from OSM element
 */
function parseOSMElement(element) {
  const tags = element.tags || {};

  // Get coordinates - use center for ways/relations
  let lat, lon;
  if (element.type === 'node') {
    lat = element.lat;
    lon = element.lon;
  } else if (element.center) {
    lat = element.center.lat;
    lon = element.center.lon;
  } else {
    return null; // Skip if no coordinates
  }

  // Extract basic info
  const name = tags.name || tags['name:en'] || 'Unnamed Hotel';

  // Build address
  const addressParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
  ].filter(Boolean);
  const address = addressParts.join(' ') || null;

  const city = tags['addr:city'] || null;
  const countryCode = tags['addr:country'] || null;

  // Contact info
  const phone = tags.phone || tags['contact:phone'] || null;
  const website = tags.website || tags['contact:website'] || null;
  const email = tags.email || tags['contact:email'] || null;

  // Hotel-specific info
  const stars = parseInt(tags.stars) || null;
  const rooms = parseInt(tags.rooms) || null;

  // Extract amenities
  const amenities = [];
  const amenityMapping = {
    'internet_access': 'wifi',
    'internet_access:fee': (value) => value === 'no' ? 'free_wifi' : null,
    'parking': 'parking',
    'parking:fee': (value) => value === 'no' ? 'free_parking' : null,
    'swimming_pool': 'pool',
    'air_conditioning': 'air_conditioning',
    'restaurant': 'restaurant',
    'bar': 'bar',
    'gym': 'gym',
    'spa': 'spa',
    'wheelchair': 'wheelchair_accessible',
    'breakfast': 'breakfast',
  };

  for (const [osmKey, amenityName] of Object.entries(amenityMapping)) {
    if (tags[osmKey]) {
      if (typeof amenityName === 'function') {
        const result = amenityName(tags[osmKey]);
        if (result) amenities.push(result);
      } else if (tags[osmKey] === 'yes' || tags[osmKey] === 'true') {
        amenities.push(amenityName);
      }
    }
  }

  return {
    osm_id: `${element.type}/${element.id}`,
    name,
    latitude: lat,
    longitude: lon,
    address,
    city,
    country_code: countryCode,
    phone,
    website,
    email,
    stars,
    rooms,
    amenities: amenities.length > 0 ? JSON.stringify(amenities) : null,
  };
}

/**
 * Import hotels for a specific region
 */
async function importRegion(db, regionName, south, west, north, east) {
  console.log(`\n=== Importing hotels for ${regionName} ===`);

  const elements = await queryOverpassAPI(south, west, north, east);

  if (elements.length === 0) {
    console.log('  No hotels found in this region');
    return 0;
  }

  let imported = 0;
  let skipped = 0;

  for (const element of elements) {
    const hotel = parseOSMElement(element);

    if (hotel) {
      try {
        db.insertHotel(hotel);
        imported++;
      } catch (error) {
        // Skip duplicates or errors
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  console.log(`  ✓ Imported ${imported} hotels (skipped ${skipped})`);

  // Be nice to Overpass API - rate limit
  console.log('  Waiting 2 seconds before next request...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  return imported;
}

/**
 * Main import function
 */
async function main() {
  console.log('\n=== OpenStreetMap Hotel Data Import ===\n');
  console.log('This script queries the Overpass API for hotel data.');
  console.log('Please be respectful of the free public API - importing large areas takes time.\n');

  const db = new HotelDatabase();

  // Define regions to import
  // You can customize this list or make it configurable
  const regions = [
    // Europe - Major cities
    { name: 'London, UK', south: 51.3, west: -0.5, north: 51.7, east: 0.3 },
    { name: 'Paris, France', south: 48.7, west: 2.1, north: 49.0, east: 2.6 },
    { name: 'Amsterdam, Netherlands', south: 52.2, west: 4.7, north: 52.5, east: 5.1 },
    { name: 'Berlin, Germany', south: 52.3, west: 13.1, north: 52.7, east: 13.7 },
    { name: 'Rome, Italy', south: 41.7, west: 12.3, north: 42.0, east: 12.7 },

    // North America - Major cities
    { name: 'New York, USA', south: 40.5, west: -74.3, north: 40.9, east: -73.7 },
    { name: 'Los Angeles, USA', south: 33.7, west: -118.7, north: 34.3, east: -117.9 },
    { name: 'San Francisco, USA', south: 37.6, west: -122.5, north: 37.9, east: -122.3 },
    { name: 'Toronto, Canada', south: 43.5, west: -79.6, north: 43.9, east: -79.1 },

    // Asia - Major cities
    { name: 'Tokyo, Japan', south: 35.5, west: 139.5, north: 35.9, east: 139.9 },
    { name: 'Singapore', south: 1.2, west: 103.6, north: 1.5, east: 104.0 },
    { name: 'Dubai, UAE', south: 24.9, west: 54.9, north: 25.4, east: 55.5 },
  ];

  let totalImported = 0;

  for (const region of regions) {
    const count = await importRegion(
      db,
      region.name,
      region.south,
      region.west,
      region.north,
      region.east
    );
    totalImported += count;
  }

  // Show final stats
  const stats = db.getStats();
  console.log('\n=== Import Complete ===');
  console.log(`Total hotels imported: ${totalImported}`);
  console.log(`Total hotels in database: ${stats.hotels}`);
  console.log(`Cities in database: ${stats.cities}`);
  console.log(`Countries in database: ${stats.countries}`);

  db.close();
}

main().catch(console.error);
