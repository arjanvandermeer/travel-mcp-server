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

// POI type mappings: OSM tag -> our poi_type
const POI_MAPPINGS = {
  // Accommodation
  'tourism=hotel': 'hotel',
  'tourism=hostel': 'hostel',
  'tourism=guest_house': 'guest_house',
  'tourism=motel': 'motel',

  // Tourism
  'tourism=attraction': 'attraction',
  'tourism=museum': 'museum',
  'tourism=viewpoint': 'viewpoint',
  'tourism=artwork': 'artwork',
  'tourism=gallery': 'gallery',
  'tourism=theme_park': 'theme_park',
  'tourism=zoo': 'zoo',

  // Food & Drink
  'amenity=restaurant': 'restaurant',
  'amenity=cafe': 'cafe',
  'amenity=bar': 'bar',
  'amenity=pub': 'pub',
  'amenity=fast_food': 'fast_food',
  'amenity=food_court': 'food_court',

  // Historic
  'historic=monument': 'monument',
  'historic=memorial': 'memorial',
  'historic=castle': 'castle',
  'historic=ruins': 'ruins',
  'historic=archaeological_site': 'archaeological_site',

  // Places of worship
  'amenity=place_of_worship': 'place_of_worship',

  // Entertainment
  'amenity=cinema': 'cinema',
  'amenity=theatre': 'theatre',
  'amenity=nightclub': 'nightclub',

  // Shopping
  'shop=mall': 'shopping_mall',
  'shop=department_store': 'department_store',
  'shop=supermarket': 'supermarket',
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
    if (poiType === 'all') {
      const stats = await pool.query(`
        SELECT poi_type, COUNT(*) as count
        FROM osm_pois
        GROUP BY poi_type
        ORDER BY count DESC
      `);

      console.log('\nPOIs by type:');
      let total = 0;
      stats.rows.forEach(row => {
        console.log(`  ${row.poi_type}: ${row.count}`);
        total += parseInt(row.count);
      });
      console.log(`  TOTAL: ${total}`);

      // Show sample POIs
      console.log(`\nSample POIs from this import:`);
      const samples = await pool.query(`
        SELECT poi_type, name, city
        FROM osm_pois
        WHERE name IS NOT NULL
        ORDER BY imported_at DESC
        LIMIT 10
      `);

      samples.rows.forEach(poi => {
        const city = poi.city ? `, ${poi.city}` : '';
        console.log(`  [${poi.poi_type}] ${poi.name}${city}`);
      });
    } else {
      const stats = await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(DISTINCT country_code) as countries,
               COUNT(*) FILTER (WHERE stars IS NOT NULL) as with_stars
        FROM osm_pois
        WHERE poi_type = $1
      `, [poiType]);

      console.log('\nDatabase statistics:');
      console.log(`  Total ${poiType}s: ${stats.rows[0].total}`);
      console.log(`  Countries: ${stats.rows[0].countries}`);
      console.log(`  With star ratings: ${stats.rows[0].with_stars}`);

      // Show sample POIs
      console.log(`\nSample ${poiType}s from this import:`);
      const samples = await pool.query(`
        SELECT name, stars, city, latitude, longitude
        FROM osm_pois
        WHERE poi_type = $1 AND name IS NOT NULL
        ORDER BY imported_at DESC
        LIMIT 5
      `, [poiType]);

      samples.rows.forEach(poi => {
        const stars = poi.stars ? ` (${poi.stars}⭐)` : '';
        const city = poi.city ? `, ${poi.city}` : '';
        console.log(`  - ${poi.name}${stars}${city}`);
      });
    }


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
    let pois = [];
    const batchSize = 1000;

    console.log('Parsing PBF file (this may take a few minutes)...\n');

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj(async (items, enc, next) => {
        try {
          for (const item of items) {
            // Only process nodes with coordinates
            if (item.type === 'node' && item.lat && item.lon && item.tags) {
              // Check if this matches our POI type
              const matchedType = matchPOIType(item.tags, poiType);
              if (matchedType) {
                const poi = extractPOIData(item, matchedType, regionName);
                pois.push(poi);

                // Batch insert
                if (pois.length >= batchSize) {
                  await insertBatch(pool, pois);
                  processed += pois.length;
                  console.log(`  Processed: ${processed} ${poiType}s`);
                  pois = [];
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
          // Insert remaining POIs
          if (pois.length > 0) {
            await insertBatch(pool, pois);
            processed += pois.length;
            console.log(`  Processed: ${processed} ${poiType}s`);
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

function matchPOIType(tags, requestedType) {
  // Match against all POI types if 'all' is requested
  if (requestedType === 'all') {
    for (const [osmTag, poiType] of Object.entries(POI_MAPPINGS)) {
      if (evaluatePOICondition(tags, osmTag)) {
        return poiType;
      }
    }
    return null;
  }

  // Match specific type - find the mapping for this POI type
  for (const [osmTag, poiType] of Object.entries(POI_MAPPINGS)) {
    if (poiType === requestedType && evaluatePOICondition(tags, osmTag)) {
      return poiType;
    }
  }

  return null;
}

function evaluatePOICondition(tags, osmTag) {
  // Parse osmTag like "tourism=hotel" or "amenity=cafe"
  const [key, value] = osmTag.split('=');
  return tags[key] === value;
}

function extractPOIData(node, poiType, regionName) {
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

  return {
    osm_id: node.id,
    osm_type: 'node',
    poi_type: poiType,
    name: truncate(tags.name, 500),
    name_en: truncate(tags['name:en'], 500),
    latitude: node.lat,
    longitude: node.lon,
    street: truncate(tags['addr:street'], 200),
    housenumber: truncate(tags['addr:housenumber'], 20),
    postcode: truncate(tags['addr:postcode'], 20),
    city: truncate(tags['addr:city'], 200),
    country: truncate(tags['addr:country'], 100),
    country_code: tags['addr:country']?.substring(0, 2)?.toUpperCase() || null,
    phone: truncate(tags.phone || tags['contact:phone'], 100),
    email: truncate(tags.email || tags['contact:email'], 200),
    website: truncate(tags.website || tags['contact:website'] || tags.url, 500),
    description: truncate(tags.description, 1000),
    wikipedia: truncate(tags.wikipedia, 200),
    wikidata: truncate(tags.wikidata, 50),
    brand: truncate(tags.brand, 200),
    operator: truncate(tags.operator, 200),
    stars: stars ? parseInt(stars) : null,
    rooms,
    beds,
    osm_tags: tags, // Store all tags as JSONB
  };
}

async function insertBatch(pool, pois) {
  if (pois.length === 0) return;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO osm_pois (
        osm_id, osm_type, poi_type, name, name_en,
        location, latitude, longitude,
        street, housenumber, postcode, city, country, country_code,
        phone, email, website,
        description, wikipedia, wikidata, brand, operator,
        stars, rooms, beds,
        osm_tags, imported_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($7, $6), 4326), $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16,
        $17, $18, $19, $20, $21,
        $22, $23, $24,
        $25, CURRENT_TIMESTAMP
      )
      ON CONFLICT (osm_id) DO UPDATE SET
        poi_type = EXCLUDED.poi_type,
        name = EXCLUDED.name,
        name_en = EXCLUDED.name_en,
        location = EXCLUDED.location,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        street = EXCLUDED.street,
        housenumber = EXCLUDED.housenumber,
        postcode = EXCLUDED.postcode,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        country_code = EXCLUDED.country_code,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        website = EXCLUDED.website,
        description = EXCLUDED.description,
        wikipedia = EXCLUDED.wikipedia,
        wikidata = EXCLUDED.wikidata,
        brand = EXCLUDED.brand,
        operator = EXCLUDED.operator,
        stars = EXCLUDED.stars,
        rooms = EXCLUDED.rooms,
        beds = EXCLUDED.beds,
        osm_tags = EXCLUDED.osm_tags,
        updated_at = CURRENT_TIMESTAMP
    `;

    for (const poi of pois) {
      await client.query(insertQuery, [
        poi.osm_id,
        poi.osm_type,
        poi.poi_type,
        poi.name,
        poi.name_en,
        poi.latitude,
        poi.longitude,
        poi.street,
        poi.housenumber,
        poi.postcode,
        poi.city,
        poi.country,
        poi.country_code,
        poi.phone,
        poi.email,
        poi.website,
        poi.description,
        poi.wikipedia,
        poi.wikidata,
        poi.brand,
        poi.operator,
        poi.stars,
        poi.rooms,
        poi.beds,
        JSON.stringify(poi.osm_tags),
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
