#!/usr/bin/env node

/**
 * Import POIs (restaurants, attractions, monuments, etc.) from OSM PBF files
 *
 * Usage:
 *   node src/import-pois-pbf.js <pbf-file> [poi-types]
 *
 * Examples:
 *   node src/import-pois-pbf.js thailand-latest.osm.pbf all
 *   node src/import-pois-pbf.js thailand-latest.osm.pbf restaurant,attraction
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import parseOSM from 'osm-pbf-parser';
import through2 from 'through2';

const PG_CONNECTION = process.env.DATABASE_URL ||
  'postgresql://traveluser:travelpass@localhost:5432/travel';

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

async function importPOIs(pbfPath, poiTypesFilter = 'all') {
  if (!fs.existsSync(pbfPath)) {
    console.error('❌ PBF file not found:', pbfPath);
    process.exit(1);
  }

  const regionName = path.basename(pbfPath, '.osm.pbf');
  const sourceFile = path.basename(pbfPath);
  console.log(`Starting POI import from: ${pbfPath}`);
  console.log(`Region: ${regionName}`);
  console.log(`Filter: ${poiTypesFilter}`);
  console.log('');

  const pool = new pg.Pool({ connectionString: PG_CONNECTION });
  let importId = null;

  try {
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL');
    client.release();

    // Start import tracking
    const importResult = await pool.query(`
      INSERT INTO imports (
        import_type, source_file, region_name, metadata, status
      ) VALUES ($1, $2, $3, $4, 'running')
      RETURNING id
    `, ['pois', sourceFile, regionName, JSON.stringify({ poi_types_filter: poiTypesFilter })]);

    importId = importResult.rows[0].id;
    console.log(`✓ Import tracking started (ID: ${importId})\n`);

    await parsePBFFile(pbfPath, pool, poiTypesFilter, regionName);

    console.log('\n✅ Import complete!');

    // Show statistics
    const stats = await pool.query(`
      SELECT poi_type, COUNT(*) as count
      FROM pois
      WHERE source_region = $1
      GROUP BY poi_type
      ORDER BY count DESC
    `, [regionName]);

    console.log('\nPOIs by type:');
    let total = 0;
    stats.rows.forEach(row => {
      console.log(`  ${row.poi_type}: ${row.count}`);
      total += parseInt(row.count);
    });
    console.log(`  TOTAL: ${total}`);

    // Mark import as completed
    await pool.query(`
      UPDATE imports
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          records_imported = $2
      WHERE id = $1
    `, [importId, total]);

    console.log(`\n✓ Import tracking updated`);

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error(error);

    // Mark import as failed
    if (importId) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = $2
        WHERE id = $1
      `, [importId, error.message]).catch(e => console.error('Failed to update import status:', e.message));
    }

    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function parsePBFFile(pbfPath, pool, poiTypesFilter, regionName) {
  return new Promise((resolve, reject) => {
    const osm = parseOSM();
    let processed = 0;
    let pois = [];
    const batchSize = 1000;

    // Parse filter
    const enabledTypes = poiTypesFilter === 'all'
      ? Object.values(POI_MAPPINGS)
      : poiTypesFilter.split(',').map(t => t.trim());

    console.log('Parsing PBF file (this may take several minutes)...\n');

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj(async (items, enc, next) => {
        try {
          for (const item of items) {
            if (item.type === 'node' && item.lat && item.lon && item.tags) {
              const poi = extractPOIData(item, regionName);

              if (poi && (poiTypesFilter === 'all' || enabledTypes.includes(poi.poi_type))) {
                pois.push(poi);

                if (pois.length >= batchSize) {
                  await insertBatch(pool, pois);
                  processed += pois.length;
                  console.log(`  Processed: ${processed} POIs`);
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
          if (pois.length > 0) {
            await insertBatch(pool, pois);
            processed += pois.length;
            console.log(`  Processed: ${processed} POIs`);
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

function extractPOIData(node, regionName) {
  const tags = node.tags || {};

  // Determine POI type
  let poiType = null;
  for (const [osmTag, mappedType] of Object.entries(POI_MAPPINGS)) {
    const [key, value] = osmTag.split('=');
    if (tags[key] === value) {
      poiType = mappedType;
      break;
    }
  }

  if (!poiType) return null;

  // Build address
  const addressParts = [];
  if (tags['addr:street']) addressParts.push(tags['addr:street']);
  if (tags['addr:housenumber']) addressParts.push(tags['addr:housenumber']);
  if (tags['addr:city']) addressParts.push(tags['addr:city']);
  if (tags['addr:postcode']) addressParts.push(tags['addr:postcode']);
  const address = addressParts.length > 0 ? addressParts.join(', ') : null;

  // Helper to truncate long strings
  const truncate = (str, maxLen) => str && str.length > maxLen ? str.substring(0, maxLen) : str;

  // Extract hotel-specific fields (stars, rooms, beds) if this is accommodation
  let stars = null;
  let rooms = null;
  let beds = null;

  if (['hotel', 'hostel', 'guest_house', 'motel'].includes(poiType)) {
    // Extract star rating (various formats in OSM)
    let starsRaw = tags.stars || tags['stars:DEHOGA'] || null;
    if (starsRaw) {
      starsRaw = starsRaw.replace(/[^0-9]/g, '');
      if (starsRaw && parseInt(starsRaw) > 0 && parseInt(starsRaw) <= 5) {
        stars = truncate(starsRaw, 10);
      }
    }

    // Extract room/bed counts
    rooms = tags.rooms ? parseInt(tags.rooms) : null;
    if (rooms !== null && (isNaN(rooms) || rooms < 0)) rooms = null;

    beds = tags.beds ? parseInt(tags.beds) : null;
    if (beds !== null && (isNaN(beds) || beds < 0)) beds = null;
  }

  return {
    osm_id: node.id,
    osm_type: 'node',
    poi_type: poiType,
    name: truncate(tags.name || tags['name:en'], 500),
    latitude: node.lat,
    longitude: node.lon,
    address: truncate(address, 500),
    phone: truncate(tags.phone || tags['contact:phone'], 100),
    email: truncate(tags.email || tags['contact:email'], 200),
    website: truncate(tags.website || tags['contact:website'] || tags.url, 500),
    opening_hours: truncate(tags.opening_hours, 500),
    cuisine: truncate(tags.cuisine, 200),
    rating: truncate(tags.rating, 10),
    wheelchair: truncate(tags.wheelchair, 20),
    stars,
    rooms,
    beds,
    tags: tags,
    source_region: regionName,
  };
}

async function insertBatch(pool, pois) {
  if (pois.length === 0) return;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO pois (
        osm_id, osm_type, poi_type, name,
        location, latitude, longitude,
        address, phone, email, website, opening_hours,
        cuisine, rating, wheelchair,
        stars, rooms, beds,
        tags, source_region, imported_at
      ) VALUES ($1, $2, $3, $4,
                ST_SetSRID(ST_MakePoint($6, $5), 4326), $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14,
                $15, $16, $17,
                $18, $19, CURRENT_TIMESTAMP)
      ON CONFLICT (osm_id) DO UPDATE SET
        poi_type = EXCLUDED.poi_type,
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        website = EXCLUDED.website,
        opening_hours = EXCLUDED.opening_hours,
        cuisine = EXCLUDED.cuisine,
        rating = EXCLUDED.rating,
        wheelchair = EXCLUDED.wheelchair,
        stars = EXCLUDED.stars,
        rooms = EXCLUDED.rooms,
        beds = EXCLUDED.beds,
        tags = EXCLUDED.tags,
        imported_at = CURRENT_TIMESTAMP
    `;

    for (const poi of pois) {
      await client.query(insertQuery, [
        poi.osm_id,
        poi.osm_type,
        poi.poi_type,
        poi.name,
        poi.latitude,
        poi.longitude,
        poi.address,
        poi.phone,
        poi.email,
        poi.website,
        poi.opening_hours,
        poi.cuisine,
        poi.rating,
        poi.wheelchair,
        poi.stars,
        poi.rooms,
        poi.beds,
        JSON.stringify(poi.tags),
        poi.source_region,
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
  const poiTypes = process.argv[3] || 'all';

  if (!pbfPath) {
    console.error('Usage: node src/import-pois-pbf.js <pbf-file> [poi-types]');
    console.error('');
    console.error('Examples:');
    console.error('  node src/import-pois-pbf.js thailand-latest.osm.pbf all');
    console.error('  node src/import-pois-pbf.js thailand-latest.osm.pbf restaurant,attraction,monument');
    process.exit(1);
  }

  importPOIs(pbfPath, poiTypes);
}

export { importPOIs };
