#!/usr/bin/env node

/**
 * Check all food-related POI types in the database
 */

import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function checkFoodPOITypes() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    console.log('Food & drink related POI types in database:\n');

    const result = await pool.query(`
      SELECT poi_type, COUNT(*) as count
      FROM pois
      WHERE poi_type IN ('restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court')
      GROUP BY poi_type
      ORDER BY count DESC
    `);

    console.log('POI types and counts:');
    result.rows.forEach(r => {
      console.log(`  ${r.poi_type}: ${r.count}`);
    });

    console.log('\n---\n');

    // Check if Starbucks is in the database
    console.log('Starbucks in database:\n');
    const starbucks = await pool.query(`
      SELECT poi_type, COUNT(*) as count
      FROM pois
      WHERE name ILIKE '%starbucks%'
      GROUP BY poi_type
    `);

    starbucks.rows.forEach(r => {
      console.log(`  ${r.poi_type}: ${r.count}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkFoodPOITypes();
