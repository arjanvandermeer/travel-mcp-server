#!/usr/bin/env node

/**
 * Test Starbucks search with more details
 */

import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function testStarbucksDetails() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    console.log('Starbucks locations in Bangkok with addresses:\n');

    const result = await pool.query(`
      SELECT
        p.osm_id,
        p.name,
        p.poi_type,
        p.address,
        p.latitude,
        p.longitude,
        p.nearest_city_id,
        c.name as city_name,
        ST_Distance(
          p.location::geography,
          ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography
        ) / 1000.0 as distance_km
      FROM pois p
      LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
      WHERE p.name ILIKE '%starbucks%'
        AND ST_DWithin(
          p.location::geography,
          ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography,
          30000
        )
      ORDER BY distance_km
      LIMIT 15
    `);

    console.log(`Found ${result.rows.length} Starbucks locations:\n`);
    result.rows.forEach((p, i) => {
      console.log(`${i + 1}. ${p.name}`);
      console.log(`   Address: ${p.address || 'No address'}`);
      console.log(`   City: ${p.city_name || 'Not linked (nearest_city_id: ' + p.nearest_city_id + ')'}`);
      console.log(`   Distance: ${p.distance_km.toFixed(2)} km`);
      console.log(`   Coords: ${p.latitude}, ${p.longitude}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

testStarbucksDetails();
