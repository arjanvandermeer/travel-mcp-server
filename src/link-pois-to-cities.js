#!/usr/bin/env node

/**
 * Link POIs to their nearest cities
 *
 * Updates the nearest_city_id field on osm_pois by finding the closest
 * geonames_cities entry within 50km. Processes in batches for resumability.
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
  'postgresql://traveluser:travelpass@localhost:5432/travel';

const DEFAULT_BATCH_SIZE = 10000;

/**
 * Link unlinked POIs to their nearest city, in batches.
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
    const resetConditions = [];
    const resetParams = [];
    if (sourceRegion) {
      resetParams.push(sourceRegion);
      resetConditions.push(`source_region = $${resetParams.length}`);
    }
    const resetWhere = resetConditions.length > 0
      ? `WHERE ${resetConditions.join(' AND ')}`
      : '';
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

  console.log(`  Linking ${totalUnlinked.toLocaleString()} POIs in batches of ${batchSize.toLocaleString()}...`);
  const startTime = Date.now();
  let totalLinked = 0;

  while (true) {
    const batchParams = [batchSize];
    const batchConditions = ['nearest_city_id IS NULL'];
    if (sourceRegion) {
      batchParams.push(sourceRegion);
      batchConditions.push(`source_region = $${batchParams.length}`);
    }
    const batchWhere = batchConditions.join(' AND ');

    const result = await pool.query(`
      UPDATE osm_pois p
      SET nearest_city_id = sub.geoname_id
      FROM (
        SELECT p2.osm_id,
          (SELECT c.geoname_id
           FROM geonames_cities c
           WHERE ST_DWithin(p2.location::geography, c.location::geography, 50000)
           ORDER BY ST_Distance(p2.location::geography, c.location::geography)
           LIMIT 1
          ) AS geoname_id
        FROM osm_pois p2
        WHERE ${batchWhere}
        LIMIT $1
      ) sub
      WHERE p.osm_id = sub.osm_id
    `, batchParams);

    const linked = result.rowCount;
    totalLinked += linked;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((totalLinked / totalUnlinked) * 100).toFixed(1);
    const rate = totalLinked > 0 ? (totalLinked / ((Date.now() - startTime) / 1000)).toFixed(0) : 0;
    console.log(`  ${totalLinked.toLocaleString()} / ${totalUnlinked.toLocaleString()} (${pct}%) — ${elapsed}s elapsed, ${rate} POIs/s`);

    if (linked < batchSize) break;
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
    console.log(`  Unlinked POIs: ${parseInt(stillUnlinked.rows[0].count, 10).toLocaleString()} (no city within 50km)`);

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

export { linkPOIsToCities };
