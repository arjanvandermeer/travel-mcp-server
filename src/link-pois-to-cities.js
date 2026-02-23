#!/usr/bin/env node

/**
 * Link POIs to their nearest cities (same-country only)
 *
 * Updates the nearest_city_id field on osm_pois by finding the closest
 * geonames_cities entry within 50km, restricted to cities in the same
 * country as the POI's source region. Processes in batches for resumability.
 *
 * Can be run standalone or called as a post-import step.
 *
 * Usage:
 *   node src/link-pois-to-cities.js [--region=thailand-latest] [--force] [--batch=10000]
 *
 * Options:
 *   --region=NAME   Only link POIs from this source_region
 *   --force         Re-link all POIs (reset nearest_city_id first)
 *   --batch=N       Batch size (default: 10000)
 */

import pg from 'pg';

const PG_CONNECTION = process.env.DATABASE_URL ||
  'postgresql://<user>:<password>@localhost:5432/travel';

const DEFAULT_BATCH_SIZE = 10000;

/**
 * Derive region → country mapping automatically from spatial data.
 * Samples 50 POIs per source_region, finds the nearest city for each,
 * and uses the most common country as that region's country.
 *
 * This is self-maintaining — no hardcoded mapping to update when
 * new regions are imported.
 *
 * @param {pg.Pool} pool
 * @returns {Object} Mapping of source_region → country_code
 */
async function deriveRegionCountries(pool) {
  const result = await pool.query(`
    WITH sampled AS (
      SELECT source_region, location
      FROM (
        SELECT source_region, location,
               ROW_NUMBER() OVER (PARTITION BY source_region ORDER BY random()) as rn
        FROM osm_pois
        WHERE source_region IS NOT NULL AND location IS NOT NULL
      ) t
      WHERE rn <= 50
    )
    SELECT s.source_region,
           mode() WITHIN GROUP (ORDER BY nearest.country_code) as country_code
    FROM sampled s
    CROSS JOIN LATERAL (
      SELECT c.country_code
      FROM geonames_cities c
      ORDER BY c.location <-> s.location
      LIMIT 1
    ) nearest
    GROUP BY s.source_region
  `);

  const mapping = {};
  for (const row of result.rows) {
    mapping[row.source_region] = row.country_code;
  }

  console.log(`  Derived ${Object.keys(mapping).length} region→country mappings:`);
  for (const [region, country] of Object.entries(mapping)) {
    console.log(`    ${region} → ${country}`);
  }

  return mapping;
}

/**
 * Link unlinked POIs to their nearest same-country city, in batches.
 * @param {pg.Pool} pool - Database pool to use
 * @param {object} [options]
 * @param {string} [options.sourceRegion] - Only link POIs from this source_region
 * @param {boolean} [options.force] - Reset and re-link all POIs
 * @param {number} [options.batchSize] - Number of POIs per batch
 * @returns {number} Number of POIs linked
 */
async function linkPOIsToCities(pool, options = {}) {
  const { sourceRegion, force = false, batchSize = DEFAULT_BATCH_SIZE } = options;

  // --force: reset nearest_city_id so all POIs get re-linked
  if (force) {
    const resetConditions = ['nearest_city_id IS NOT NULL'];
    const resetParams = [];
    if (sourceRegion) {
      resetParams.push(sourceRegion);
      resetConditions.push(`source_region = $${resetParams.length}`);
    }
    const resetWhere = `WHERE ${resetConditions.join(' AND ')}`;
    const resetResult = await pool.query(
      `UPDATE osm_pois SET nearest_city_id = NULL ${resetWhere}`, resetParams
    );
    console.log(`  --force: Reset ${resetResult.rowCount} POIs for re-linking`);
  }

  // Count unlinked POIs
  const conditions = ['nearest_city_id IS NULL'];
  const countParams = [];
  if (sourceRegion) {
    countParams.push(sourceRegion);
    conditions.push(`source_region = $${countParams.length}`);
  }
  const whereClause = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM osm_pois WHERE ${whereClause}`, countParams
  );
  const totalUnlinked = parseInt(countResult.rows[0].count, 10);

  if (totalUnlinked === 0) {
    console.log('  No unlinked POIs to process.');
    return 0;
  }

  // Derive region→country mapping from spatial data (self-maintaining, no hardcoded values)
  const regionCountryMap = await deriveRegionCountries(pool);
  const regionMapJson = JSON.stringify(regionCountryMap);

  console.log(`  Linking ${totalUnlinked.toLocaleString()} POIs in batches of ${batchSize.toLocaleString()}...`);
  const startTime = Date.now();
  let totalLinked = 0;
  let cursor = 0; // Track progress by osm_id to avoid re-processing orphans
  let totalProcessed = 0;

  while (true) {
    // 1. Fetch next batch of unlinked POI IDs in deterministic order
    const fetchParams = [cursor, batchSize];
    const fetchConditions = ['nearest_city_id IS NULL', `osm_id > $1`];
    if (sourceRegion) {
      fetchParams.push(sourceRegion);
      fetchConditions.push(`source_region = $${fetchParams.length}`);
    }
    const fetchWhere = fetchConditions.join(' AND ');

    const batch = await pool.query(
      `SELECT osm_id FROM osm_pois WHERE ${fetchWhere} ORDER BY osm_id LIMIT $2`,
      fetchParams
    );

    if (batch.rows.length === 0) break;

    const osmIds = batch.rows.map(r => r.osm_id);
    cursor = osmIds[osmIds.length - 1];
    totalProcessed += osmIds.length;

    // 2. Link this batch to nearest same-country cities using KNN spatial index
    //    region_map is derived from spatial sampling (no hardcoded values)
    //    LEFT JOIN: POIs with unknown source_region get unrestricted linking
    const result = await pool.query(`
      WITH region_map AS (
        SELECT key as source_region, value as country_code
        FROM jsonb_each_text($2::jsonb)
      )
      UPDATE osm_pois p
      SET nearest_city_id = sub.geoname_id
      FROM (
        SELECT p2.osm_id, nearest.geoname_id
        FROM osm_pois p2
        LEFT JOIN region_map rm ON p2.source_region = rm.source_region
        CROSS JOIN LATERAL (
          SELECT c.geoname_id
          FROM geonames_cities c
          WHERE ST_DWithin(c.location::geography, p2.location::geography, 50000)
            AND (rm.country_code IS NULL OR c.country_code = rm.country_code)
          ORDER BY c.location::geography <-> p2.location::geography
          LIMIT 1
        ) nearest
        WHERE p2.osm_id = ANY($1::bigint[])
      ) sub
      WHERE p.osm_id = sub.osm_id
    `, [osmIds, regionMapJson]);

    const linked = result.rowCount;
    totalLinked += linked;
    const orphans = osmIds.length - linked;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((totalProcessed / totalUnlinked) * 100).toFixed(1);
    const rate = totalProcessed > 0 ? (totalProcessed / ((Date.now() - startTime) / 1000)).toFixed(0) : 0;
    console.log(`  ${totalProcessed.toLocaleString()} / ${totalUnlinked.toLocaleString()} (${pct}%) — ${elapsed}s elapsed, ${rate} POIs/s${orphans > 0 ? `, ${orphans} no city` : ''}`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Done: linked ${totalLinked.toLocaleString()} POIs in ${duration}s`);

  return totalLinked;
}

// Standalone execution
async function main() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    // Parse flags
    const regionArg = process.argv.find(a => a.startsWith('--region='));
    const sourceRegion = regionArg ? regionArg.split('=')[1] : undefined;
    const force = process.argv.includes('--force');
    const batchArg = process.argv.find(a => a.startsWith('--batch='));
    const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) || DEFAULT_BATCH_SIZE : DEFAULT_BATCH_SIZE;

    console.log('Starting POI to city linkage...');
    if (sourceRegion) console.log(`  Region filter: ${sourceRegion}`);
    if (force) console.log('  Mode: --force (re-linking all POIs)');
    console.log(`  Batch size: ${batchSize.toLocaleString()}`);
    console.log('  Country restriction: auto-derived from spatial data');

    // Show current stats
    const totalPOIs = await pool.query('SELECT COUNT(*) FROM osm_pois');
    const linkedPOIs = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE nearest_city_id IS NOT NULL');
    console.log(`  Total POIs: ${parseInt(totalPOIs.rows[0].count, 10).toLocaleString()}`);
    console.log(`  Already linked: ${parseInt(linkedPOIs.rows[0].count, 10).toLocaleString()}\n`);

    const linked = await linkPOIsToCities(pool, { sourceRegion, force, batchSize });

    // Show final stats
    const newLinked = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE nearest_city_id IS NOT NULL');
    const stillUnlinked = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE nearest_city_id IS NULL');
    console.log(`\nFinal statistics:`);
    console.log(`  Linked POIs: ${parseInt(newLinked.rows[0].count, 10).toLocaleString()}`);
    console.log(`  Unlinked POIs: ${parseInt(stillUnlinked.rows[0].count, 10).toLocaleString()} (no same-country city within 50km)`);

    if (linked > 0) {
      console.log('\nSample linked POIs:');
      const samples = await pool.query(`
        SELECT p.name, p.poi_type, c.name as city_name, c.country_code
        FROM osm_pois p
        JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
        WHERE p.name IS NOT NULL
        LIMIT 10
      `);
      samples.rows.forEach(poi => {
        console.log(`  - ${poi.name} (${poi.poi_type}) -> ${poi.city_name}, ${poi.country_code}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { linkPOIsToCities, deriveRegionCountries };
