#!/usr/bin/env node
/**
 * Cleanup script to remove POIs without valid names from the database
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://traveluser:travelpass@localhost:5432/travel';

async function cleanup() {
  const pool = new pg.Pool({ connectionString: CONNECTION_STRING });

  try {
    // First count how many will be deleted
    const countResult = await pool.query(`
      SELECT COUNT(*) as count FROM osm_pois
      WHERE name IS NULL OR name = '' OR LOWER(name) = 'unknown'
    `);
    console.log(`Found ${countResult.rows[0].count} POIs without valid names`);

    if (parseInt(countResult.rows[0].count) > 0) {
      // Delete POIs without names
      const deleteResult = await pool.query(`
        DELETE FROM osm_pois
        WHERE name IS NULL OR name = '' OR LOWER(name) = 'unknown'
      `);
      console.log(`Deleted ${deleteResult.rowCount} POIs without valid names`);
    } else {
      console.log('No POIs to delete');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanup();
