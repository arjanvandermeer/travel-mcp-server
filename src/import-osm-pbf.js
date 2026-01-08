#!/usr/bin/env node

/**
 * Import OSM POI data from PBF files into PostgreSQL
 *
 * This script:
 * 1. Parses OSM PBF files (binary format)
 * 2. Filters for POIs: tourism=hotel, tourism=restaurant, etc.
 * 3. Extracts metadata (name, address, stars, phone, website)
 * 4. Inserts into PostgreSQL with PostGIS geometries
 *
 * Usage:
 *   node src/import-osm-pbf.js <pbf-file> [poi-type]
 *
 * Examples:
 *   node src/import-osm-pbf.js thailand-latest.osm.pbf hotel
 *   node src/import-osm-pbf.js thailand-latest.osm.pbf  (imports all hotels)
 *
 * Download PBF files from:
 *   https://download.geofabrik.de/
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import parseOSM from 'osm-pbf-parser';
import through2 from 'through2';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

// POI types we support
const POI_TYPES = {
  hotel: 'tourism=hotel',
  restaurant: 'amenity=restaurant',
  attraction: 'tourism=attraction',
  museum: 'tourism=museum',
  viewpoint: 'tourism=viewpoint',
  cafe: 'amenity=cafe',
  bar: 'amenity=bar',
};

async function importPBF(pbfPath, poiType = 'hotel') {
  if (!fs.existsSync(pbfPath)) {
    console.error('❌ PBF file not found:', pbfPath);
    console.log('\nDownload PBF files from: https://download.geofabrik.de/');
    console.log('Example for Thailand: https://download.geofabrik.de/asia/thailand-latest.osm.pbf');
    process.exit(1);
  }

  const regionName = path.basename(pbfPath, '.osm.pbf');
  console.log(`Starting import from: ${pbfPath}`);
  console.log(`Region: ${regionName}`);
  console.log(`POI Type: ${poiType}`);
  console.log('');

  // Connect to PostgreSQL
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    // Test connection
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL');
    client.release();

    // Parse PBF and import
    await parsePBFFile(pbfPath, pool, poiType, regionName);

    console.log('\n✅ Import complete!');

    // Show statistics
    const stats = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT source_region) as regions,
             COUNT(*) FILTER (WHERE stars IS NOT NULL) as with_stars
      FROM pois
      WHERE poi_type = 'hotel'
    `);

    console.log('\nDatabase statistics:');
    console.log(`  Total hotels: ${stats.rows[0].total}`);
    console.log(`  Regions: ${stats.rows[0].regions}`);
    console.log(`  Hotels with star ratings: ${stats.rows[0].with_stars}`);

    // Show sample hotels
    console.log('\nSample hotels from this import:');
    const samples = await pool.query(`
      SELECT name, stars,
             ST_X(location) as lon, ST_Y(location) as lat
      FROM pois
      WHERE poi_type = 'hotel' AND source_region = $1 AND name IS NOT NULL
      LIMIT 5
    `, [regionName]);

    samples.rows.forEach(hotel => {
      const stars = hotel.stars ? ` (${hotel.stars}⭐)` : '';
      console.log(`  - ${hotel.name}${stars}`);
    });

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function parsePBFFile(pbfPath, pool, poiType, regionName) {
  return new Promise((resolve, reject) => {
    const osm = parseOSM();
    let processed = 0;
    let hotels = [];
    const batchSize = 1000;

    console.log('Parsing PBF file (this may take a few minutes)...\n');

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj(async (items, enc, next) => {
        try {
          for (const item of items) {
            // Only process nodes with coordinates
            if (item.type === 'node' && item.lat && item.lon && item.tags) {
              // Check if this is a hotel
              if (item.tags.tourism === 'hotel') {
                const hotel = extractHotelData(item, regionName);
                hotels.push(hotel);

                // Batch insert
                if (hotels.length >= batchSize) {
                  await insertBatch(pool, hotels);
                  processed += hotels.length;
                  console.log(`  Processed: ${processed} hotels`);
                  hotels = [];
                }
              }
            }
          }
          next();
        } catch (error) {
          next(error);
        }
      }))
      .on('finish', async () => {
        try {
          // Insert remaining hotels
          if (hotels.length > 0) {
            await insertBatch(pool, hotels);
            processed += hotels.length;
            console.log(`  Processed: ${processed} hotels`);
          }
          console.log('\n✓ PBF parsing complete');
          resolve();
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

function extractHotelData(node, regionName) {
  const tags = node.tags || {};

  // Helper to truncate long strings
  const truncate = (str, maxLen) => str && str.length > maxLen ? str.substring(0, maxLen) : str;

  // Extract star rating (various formats in OSM)
  let stars = tags.stars || tags['stars:DEHOGA'] || null;
  if (stars) {
    // Normalize to just the number
    stars = stars.replace(/[^0-9]/g, '');
    if (stars && parseInt(stars) > 0 && parseInt(stars) <= 5) {
      stars = stars;
    } else {
      stars = null;
    }
  }

  // Extract room/bed counts (validate they're actual numbers)
  let rooms = tags.rooms ? parseInt(tags.rooms) : null;
  if (rooms !== null && (isNaN(rooms) || rooms < 0)) rooms = null;

  let beds = tags.beds ? parseInt(tags.beds) : null;
  if (beds !== null && (isNaN(beds) || beds < 0)) beds = null;

  // Build address from components
  const addressParts = [];
  if (tags['addr:street']) addressParts.push(tags['addr:street']);
  if (tags['addr:housenumber']) addressParts.push(tags['addr:housenumber']);
  if (tags['addr:city']) addressParts.push(tags['addr:city']);
  if (tags['addr:postcode']) addressParts.push(tags['addr:postcode']);
  const address = addressParts.length > 0 ? addressParts.join(', ') : null;

  return {
    osm_id: node.id,
    osm_type: 'node',
    poi_type: 'hotel',
    name: truncate(tags.name || tags['name:en'], 500),
    latitude: node.lat,
    longitude: node.lon,
    stars: truncate(stars, 10),
    rooms,
    beds,
    address: truncate(address, 500),
    phone: truncate(tags.phone || tags['contact:phone'], 100),
    email: truncate(tags.email || tags['contact:email'], 200),
    website: truncate(tags.website || tags['contact:website'] || tags.url, 500),
    tags: tags, // Store all tags as JSONB
    source_region: regionName,
  };
}

async function insertBatch(pool, hotels) {
  if (hotels.length === 0) return;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO pois (
        osm_id, osm_type, poi_type, name,
        location, latitude, longitude,
        stars, rooms, beds,
        address, phone, email, website,
        tags, source_region, imported_at
      ) VALUES ($1, $2, $3, $4,
                ST_SetSRID(ST_MakePoint($6, $5), 4326), $5, $6,
                $7, $8, $9,
                $10, $11, $12, $13,
                $14, $15, CURRENT_TIMESTAMP)
      ON CONFLICT (osm_id) DO UPDATE SET
        poi_type = EXCLUDED.poi_type,
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        stars = EXCLUDED.stars,
        rooms = EXCLUDED.rooms,
        beds = EXCLUDED.beds,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        website = EXCLUDED.website,
        tags = EXCLUDED.tags,
        source_region = EXCLUDED.source_region,
        imported_at = CURRENT_TIMESTAMP
    `;

    for (const hotel of hotels) {
      await client.query(insertQuery, [
        hotel.osm_id,
        hotel.osm_type,
        hotel.poi_type,
        hotel.name,
        hotel.latitude,
        hotel.longitude,
        hotel.stars,
        hotel.rooms,
        hotel.beds,
        hotel.address,
        hotel.phone,
        hotel.email,
        hotel.website,
        JSON.stringify(hotel.tags),
        hotel.source_region,
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const pbfPath = process.argv[2];
  const poiType = process.argv[3] || 'hotel';

  if (!pbfPath) {
    console.error('Usage: node src/import-osm-pbf.js <pbf-file> [poi-type]');
    console.error('');
    console.error('Examples:');
    console.error('  node src/import-osm-pbf.js thailand-latest.osm.pbf');
    console.error('  node src/import-osm-pbf.js europe-latest.osm.pbf hotel');
    console.error('');
    console.error('Download PBF files from: https://download.geofabrik.de/');
    process.exit(1);
  }

  importPBF(pbfPath, poiType);
}

export { importPBF };
