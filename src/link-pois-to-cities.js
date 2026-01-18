#!/usr/bin/env node

/**
 * Link POIs to their nearest cities
 *
 * This script updates the nearest_city_id field for all POIs by finding
 * the closest city within a reasonable radius (50km).
 *
 * Usage:
 *   node src/link-pois-to-cities.js
 */

import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function linkPOIsToCities() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    console.log('Starting POI to city linkage...\n');

    // Get counts
    const totalPOIs = await pool.query('SELECT COUNT(*) FROM pois');
    const linkedPOIs = await pool.query('SELECT COUNT(*) FROM pois WHERE nearest_city_id IS NOT NULL');
    const totalCities = await pool.query('SELECT COUNT(*) FROM geonames_cities');

    console.log(`Total POIs: ${totalPOIs.rows[0].count}`);
    console.log(`Already linked: ${linkedPOIs.rows[0].count}`);
    console.log(`Total cities: ${totalCities.rows[0].count}`);
    console.log('');

    if (linkedPOIs.rows[0].count > 0) {
      console.log('⚠️  Some POIs are already linked. This will re-link ALL POIs.');
      console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('Linking POIs to nearest cities (this may take a while)...\n');

    const startTime = Date.now();

    // Use a single UPDATE query with a subquery to find nearest city
    // This is much faster than updating row by row
    const result = await pool.query(`
      UPDATE pois p
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
      WHERE nearest_city_id IS NULL
    `);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✓ Linked ${result.rowCount} POIs to nearest cities in ${duration}s\n`);

    // Show updated stats
    const newLinked = await pool.query('SELECT COUNT(*) FROM pois WHERE nearest_city_id IS NOT NULL');
    const stillUnlinked = await pool.query('SELECT COUNT(*) FROM pois WHERE nearest_city_id IS NULL');

    console.log('Final statistics:');
    console.log(`  Linked POIs: ${newLinked.rows[0].count}`);
    console.log(`  Unlinked POIs: ${stillUnlinked.rows[0].count} (no city within 50km)`);

    // Show sample of linked POIs
    console.log('\nSample linked POIs:');
    const samples = await pool.query(`
      SELECT p.name, p.poi_type, c.name as city_name, c.country_code
      FROM pois p
      JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
      WHERE p.name IS NOT NULL
      LIMIT 10
    `);

    samples.rows.forEach(poi => {
      console.log(`  - ${poi.name} (${poi.poi_type}) → ${poi.city_name}, ${poi.country_code}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  linkPOIsToCities();
}

export { linkPOIsToCities };
