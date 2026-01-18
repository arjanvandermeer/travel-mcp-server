#!/usr/bin/env node

/**
 * Test Conrad and Hilton searches
 */

import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function testConradHilton() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    console.log('Test 1: Check if Conrad hotels exist in database\n');
    const conrad = await pool.query(`
      SELECT name, poi_type, address, latitude, longitude
      FROM pois
      WHERE name ILIKE '%conrad%'
      LIMIT 20
    `);
    console.log(`Found ${conrad.rows.length} Conrad entries:`);
    conrad.rows.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    console.log('Test 2: Check if Hilton hotels exist in database\n');
    const hilton = await pool.query(`
      SELECT name, poi_type, address, latitude, longitude
      FROM pois
      WHERE name ILIKE '%hilton%'
      LIMIT 20
    `);
    console.log(`Found ${hilton.rows.length} Hilton entries:`);
    hilton.rows.forEach(p => console.log(`  - ${p.name} (${p.poi_type})`));

    console.log('\n---\n');

    console.log('Test 3: Check enriched_pois view for Conrad\n');
    const conradView = await pool.query(`
      SELECT best_name, poi_type, city, country_code
      FROM enriched_pois
      WHERE best_name ILIKE '%conrad%'
      LIMIT 20
    `);
    console.log(`Found ${conradView.rows.length} Conrad in view:`);
    conradView.rows.forEach(p => console.log(`  - ${p.best_name} (${p.poi_type})`));

    console.log('\n---\n');

    console.log('Test 4: Check enriched_pois view for Hilton\n');
    const hiltonView = await pool.query(`
      SELECT best_name, poi_type, city, country_code
      FROM enriched_pois
      WHERE best_name ILIKE '%hilton%'
      LIMIT 20
    `);
    console.log(`Found ${hiltonView.rows.length} Hilton in view:`);
    hiltonView.rows.forEach(p => console.log(`  - ${p.best_name} (${p.poi_type})`));

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

testConradHilton();
