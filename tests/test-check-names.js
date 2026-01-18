#!/usr/bin/env node

/**
 * Check POI name distribution
 */

import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function checkNames() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    // Check total POIs
    const total = await pool.query('SELECT COUNT(*) FROM osm_pois');
    console.log(`Total POIs: ${total.rows[0].count}\n`);

    // Check POIs with NULL names
    const nullNames = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE name IS NULL');
    console.log(`POIs with NULL names: ${nullNames.rows[0].count}`);

    // Check POIs with empty names
    const emptyNames = await pool.query("SELECT COUNT(*) FROM osm_pois WHERE name = ''");
    console.log(`POIs with empty names: ${emptyNames.rows[0].count}`);

    // Check POIs with actual names
    const withNames = await pool.query('SELECT COUNT(*) FROM osm_pois WHERE name IS NOT NULL AND name != \'\'');
    console.log(`POIs with names: ${withNames.rows[0].count}\n`);

    // Sample of named hotels
    console.log('Sample named hotels:');
    const namedHotels = await pool.query(`
      SELECT name, address, latitude, longitude
      FROM osm_pois
      WHERE poi_type = 'hotel' AND name IS NOT NULL AND name != ''
      LIMIT 10
    `);
    namedHotels.rows.forEach(h => {
      console.log(`  - ${h.name}${h.address ? ' (' + h.address + ')' : ''}`);
    });

    console.log('\nSample NULL/empty name hotels:');
    const unnamedHotels = await pool.query(`
      SELECT osm_id, address, latitude, longitude
      FROM osm_pois
      WHERE poi_type = 'hotel' AND (name IS NULL OR name = '')
      LIMIT 10
    `);
    unnamedHotels.rows.forEach(h => {
      console.log(`  - [No name] ${h.address || 'No address'} (OSM ID: ${h.osm_id})`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkNames();
