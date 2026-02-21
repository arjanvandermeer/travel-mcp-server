#!/usr/bin/env node

/**
 * Link POIs to their nearest cities
 *
 * Updates the nearest_city_id field on osm_pois by finding the closest
 * geonames_cities entry within 50km.
 *
 * Can be run standalone or called as a post-import step.
 *
 * Usage:
 *   node src/link-pois-to-cities.js [--region=thailand-latest]
 */

import pg from 'pg';

const PG_CONNECTION = process.env.DATABASE_URL ||
  'postgresql://traveluser:travelpass@localhost:5432/travel';

/**
 * Link unlinked POIs to their nearest city.
 * @param {pg.Pool} pool - Database pool to use
 * @param {string} [sourceRegion] - Only link POIs from this source_region
 * @returns {number} Number of POIs linked
 */
async function linkPOIsToCities(pool, sourceRegion) {
  const conditions = ['nearest_city_id IS NULL'];
  const params = [];

  if (sourceRegion) {
    params.push(sourceRegion);
    conditions.push(`source_region = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM osm_pois WHERE ${whereClause}`, params
  );
  const unlinkedCount = parseInt(countResult.rows[0].count, 10);

  if (unlinkedCount === 0) {
    console.log('  No unlinked POIs to process.');
    return 0;
  }

  console.log(`  Linking ${unlinkedCount} unlinked POIs to nearest cities...`);
  const startTime = Date.now();

  const result = await pool.query(`
    UPDATE osm_pois p
    SET nearest_city_id = (
      SELECT c.geoname_id
      FROM geonames_cities c
      WHERE ST_DWithin(
        p.location::geography,
        c.location::geography,
        50000  -- 50km radius
      )
      ORDER BY ST_Distance(p.location::geography, c.location::geography)
      LIMIT 1
    )
    WHERE ${whereClause}
  `, params);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Linked ${result.rowCount} POIs to nearest cities in ${duration}s`);

  return result.rowCount;
}

// Standalone execution
async function main() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    // Parse --region flag
    const regionArg = process.argv.find(a => a.startsWith('--region='));
    const sourceRegion = regionArg ? regionArg.split('=')[1] : undefined;

    console.log('Starting POI to city linkage...');
    if (sourceRegion) {
      console.log(`  Region filter: ${sourceRegion}`);
    }

    // Show current stats
    const totalPOIs = await pool.query('SELECT COUNT(*) FROM osm_pois');
    const linkedPOIs = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE nearest_city_id IS NOT NULL');
    console.log(`  Total POIs: ${totalPOIs.rows[0].count}`);
    console.log(`  Already linked: ${linkedPOIs.rows[0].count}\n`);

    const linked = await linkPOIsToCities(pool, sourceRegion);

    // Show final stats
    const newLinked = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE nearest_city_id IS NOT NULL');
    const stillUnlinked = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE nearest_city_id IS NULL');
    console.log(`\nFinal statistics:`);
    console.log(`  Linked POIs: ${newLinked.rows[0].count}`);
    console.log(`  Unlinked POIs: ${stillUnlinked.rows[0].count} (no city within 50km)`);

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
