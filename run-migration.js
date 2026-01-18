#!/usr/bin/env node

/**
 * Run the Google Places tables migration
 */

import fs from 'fs';
import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function runMigration() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    console.log('Running migration: Add Google Places tables...\n');

    const sql = fs.readFileSync('data/migration-add-google-tables.sql', 'utf8');

    await pool.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify tables were created
    const tables = await pool.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename IN ('google_places', 'osm_google_mappings')
      ORDER BY tablename
    `);

    console.log('Created tables:');
    tables.rows.forEach(t => console.log(`  ✓ ${t.tablename}`));

    // Verify view was recreated
    const views = await pool.query(`
      SELECT viewname FROM pg_views
      WHERE schemaname = 'public'
      AND viewname = 'enriched_pois'
    `);

    console.log('\nRecreated views:');
    views.rows.forEach(v => console.log(`  ✓ ${v.viewname}`));

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
