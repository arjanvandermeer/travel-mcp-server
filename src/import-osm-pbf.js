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

const PG_CONNECTION = process.env.DATABASE_URL || 'postgresql://traveluser:travelpass@localhost:5432/travel';

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
  const sourceFile = path.basename(pbfPath);
  console.log(`Starting import from: ${pbfPath}`);
  console.log(`Region: ${regionName}`);
  console.log(`POI Type: ${poiType}`);
  console.log('');

  // Connect to PostgreSQL
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });
  let importId = null;

  try {
    // Test connection
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL');
    client.release();

    // Record import start
    const importResult = await pool.query(`
      INSERT INTO imports (import_type, source_file, region_name, status, started_at)
      VALUES ($1, $2, $3, 'running', CURRENT_TIMESTAMP)
      RETURNING id
    `, [`osm_${poiType}`, sourceFile, regionName]);
    importId = importResult.rows[0].id;

    // Parse PBF and import
    const recordsImported = await parsePBFFile(pbfPath, pool, poiType, regionName);

    // Record import completion
    await pool.query(`
      UPDATE imports
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          records_imported = $1
      WHERE id = $2
    `, [recordsImported, importId]);

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
        SELECT poi_type, name, address
        FROM osm_pois
        WHERE name IS NOT NULL
        ORDER BY imported_at DESC
        LIMIT 10
      `);

      samples.rows.forEach(poi => {
        const address = poi.address ? `, ${poi.address}` : '';
        console.log(`  [${poi.poi_type}] ${poi.name}${address}`);
      });
    } else {
      const stats = await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE stars IS NOT NULL) as with_stars
        FROM osm_pois
        WHERE poi_type = $1
      `, [poiType]);

      console.log('\nDatabase statistics:');
      console.log(`  Total ${poiType}s: ${stats.rows[0].total}`);
      console.log(`  With star ratings: ${stats.rows[0].with_stars}`);

      // Show sample POIs
      console.log(`\nSample ${poiType}s from this import:`);
      const samples = await pool.query(`
        SELECT name, stars, address, latitude, longitude
        FROM osm_pois
        WHERE poi_type = $1 AND name IS NOT NULL
        ORDER BY imported_at DESC
        LIMIT 5
      `, [poiType]);

      samples.rows.forEach(poi => {
        const stars = poi.stars ? ` (${poi.stars}⭐)` : '';
        const address = poi.address ? `, ${poi.address}` : '';
        console.log(`  - ${poi.name}${stars}${address}`);
      });
    }


  } catch (error) {
    // Record import failure
    if (importId) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = $1
        WHERE id = $2
      `, [error.message, importId]).catch(() => {}); // Ignore errors in error handler
    }

    console.error('❌ Import failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function parsePBFFile(pbfPath, pool, poiType, regionName) {
  // Three-pass approach (memory efficient):
  // Pass 1: Find ways with POI tags and collect their node IDs
  // Pass 2: Collect coordinates only for needed nodes
  // Pass 3: Process nodes AND ways with POI tags

  console.log('Parsing PBF file (three-pass for nodes + ways)...\n');

  // Pass 1: Find POI ways and collect their node refs
  console.log('Pass 1: Finding POI ways and collecting required node IDs...');
  const neededNodeIds = new Set();
  const poiWays = []; // Store way data for pass 3

  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    let waysFound = 0;

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj((items, enc, next) => {
        for (const item of items) {
          if (item.type === 'way' && item.tags && item.refs && item.refs.length > 0) {
            const matchedType = matchPOIType(item.tags, poiType);
            if (matchedType) {
              // Store this way for later processing
              poiWays.push({
                id: item.id,
                tags: item.tags,
                refs: item.refs,
                matchedType,
              });
              // Mark its nodes as needed
              for (const ref of item.refs) {
                neededNodeIds.add(ref);
              }
              waysFound++;
              if (waysFound % 1000 === 0) {
                console.log(`  Found ${waysFound} POI ways, need ${neededNodeIds.size.toLocaleString()} nodes...`);
              }
            }
          }
        }
        next();
      }))
      .on('finish', () => {
        console.log(`  ✓ Found ${poiWays.length} POI ways, need ${neededNodeIds.size.toLocaleString()} node coordinates\n`);
        resolve();
      })
      .on('error', reject);
  });

  // Pass 2: Collect coordinates only for needed nodes
  console.log('Pass 2: Collecting coordinates for needed nodes...');
  const nodeCoords = new Map();

  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    let collected = 0;

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj((items, enc, next) => {
        for (const item of items) {
          if (item.type === 'node' && item.lat && item.lon && neededNodeIds.has(item.id)) {
            nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
            collected++;
            if (collected % 10000 === 0) {
              console.log(`  Collected ${collected.toLocaleString()} / ${neededNodeIds.size.toLocaleString()} node coordinates...`);
            }
          }
        }
        next();
      }))
      .on('finish', () => {
        console.log(`  ✓ Collected ${nodeCoords.size.toLocaleString()} node coordinates\n`);
        resolve();
      })
      .on('error', reject);
  });

  // Clear the set to free memory
  neededNodeIds.clear();

  // Pass 3: Process POI nodes and use collected way data
  console.log('Pass 3: Processing POIs (nodes + ways)...');

  let processed = 0;
  let nodesPOIs = 0;
  let waysPOIs = 0;
  let pois = [];
  const batchSize = 1000;

  // First, process all the ways we collected
  for (const way of poiWays) {
    const coords = way.refs
      .map(ref => nodeCoords.get(ref))
      .filter(c => c !== undefined);

    if (coords.length > 0) {
      const centroid = {
        lat: coords.reduce((sum, c) => sum + c.lat, 0) / coords.length,
        lon: coords.reduce((sum, c) => sum + c.lon, 0) / coords.length,
      };

      const wayItem = {
        id: way.id,
        type: 'way',
        lat: centroid.lat,
        lon: centroid.lon,
        tags: way.tags,
      };

      const poi = extractPOIData(wayItem, way.matchedType, regionName);
      // Skip POIs without a valid name
      if (!poi.name || poi.name.trim() === '' || poi.name.toLowerCase() === 'unknown') {
        continue;
      }
      pois.push(poi);
      waysPOIs++;

      if (pois.length >= batchSize) {
        await insertBatch(pool, pois);
        processed += pois.length;
        console.log(`  Processed: ${processed} POIs (${nodesPOIs} nodes, ${waysPOIs} ways)`);
        pois = [];
      }
    }
  }

  // Clear way data and node coords to free memory
  poiWays.length = 0;
  nodeCoords.clear();

  // Now process POI nodes (single pass through file)
  await new Promise((resolve, reject) => {
    const osm = parseOSM();

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj(async (items, enc, next) => {
        try {
          for (const item of items) {
            if (item.type === 'node' && item.lat && item.lon && item.tags) {
              const matchedType = matchPOIType(item.tags, poiType);
              if (matchedType) {
                const poi = extractPOIData(item, matchedType, regionName);
                // Skip POIs without a valid name
                if (!poi.name || poi.name.trim() === '' || poi.name.toLowerCase() === 'unknown') {
                  continue;
                }
                pois.push(poi);
                nodesPOIs++;

                if (pois.length >= batchSize) {
                  await insertBatch(pool, pois);
                  processed += pois.length;
                  console.log(`  Processed: ${processed} POIs (${nodesPOIs} nodes, ${waysPOIs} ways)`);
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
          }
          console.log(`\n✓ PBF parsing complete`);
          console.log(`  Total: ${processed} POIs (${nodesPOIs} nodes, ${waysPOIs} ways)`);
          resolve(processed);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });

  return processed;
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

function extractPOIData(item, poiType, regionName) {
  const tags = item.tags || {};

  // Helper to truncate long strings
  const truncate = (str, maxLen) => str && str.length > maxLen ? str.substring(0, maxLen) : str;

  // Build address from components
  const addressParts = [];
  if (tags['addr:housenumber']) addressParts.push(tags['addr:housenumber']);
  if (tags['addr:street']) addressParts.push(tags['addr:street']);
  if (tags['addr:city']) addressParts.push(tags['addr:city']);
  if (tags['addr:postcode']) addressParts.push(tags['addr:postcode']);
  if (tags['addr:country']) addressParts.push(tags['addr:country']);
  const address = addressParts.length > 0 ? truncate(addressParts.join(', '), 500) : null;

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
    osm_id: item.id,
    osm_type: item.type || 'node',
    poi_type: poiType,
    name: truncate(tags.name, 500),
    latitude: item.lat,
    longitude: item.lon,
    address,
    phone: truncate(tags.phone || tags['contact:phone'], 100),
    email: truncate(tags.email || tags['contact:email'], 200),
    website: truncate(tags.website || tags['contact:website'] || tags.url, 500),
    opening_hours: truncate(tags.opening_hours, 500),
    cuisine: truncate(tags.cuisine, 200),
    wheelchair: truncate(tags.wheelchair, 20),
    stars: stars ? parseInt(stars) : null,
    rooms,
    beds,
    source_region: regionName,
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
        osm_id, osm_type, poi_type, name,
        location, latitude, longitude,
        address, phone, email, website, opening_hours,
        cuisine, wheelchair,
        stars, rooms, beds,
        source_region, tags, imported_at
      ) VALUES (
        $1, $2, $3, $4,
        ST_SetSRID(ST_MakePoint($6, $5), 4326), $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18, CURRENT_TIMESTAMP
      )
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
        wheelchair = EXCLUDED.wheelchair,
        stars = EXCLUDED.stars,
        rooms = EXCLUDED.rooms,
        beds = EXCLUDED.beds,
        source_region = EXCLUDED.source_region,
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
        poi.wheelchair,
        poi.stars,
        poi.rooms,
        poi.beds,
        poi.source_region,
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
