#!/usr/bin/env node

/**
 * Initialize PostgreSQL database schema
 *
 * This script:
 * 1. Connects to PostgreSQL
 * 2. Reads and executes the non-destructive schema.sql
 * 3. Verifies PostGIS is working
 * 4. Shows database statistics
 *
 * Usage:
 *   node src/init.js
 *   node src/init.js --reset   # destructive local reset, then recreate schema
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection string from environment or default
const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://<user>:<password>@localhost:5432/travel';

const RESET_TABLES = [
  'user_favorites',
  'user_config',
  'user_tokens',
  'users',
  'osm_google_mappings',
  'google_places',
  'google_api_usage',
  'import_sources',
  'import_log',
  'imports',
  'osm_pois',
  'hotels',
  'geonames_cities',
  'geonames_admin1_codes',
  'geonames_countries',
  'regions',
  'app_config',
];

async function resetDatabase(client) {
  console.log('\n⚠️  Destructive reset requested with --reset');
  console.log('Dropping application tables before recreating schema...');
  await client.query(`DROP TABLE IF EXISTS ${RESET_TABLES.join(', ')} CASCADE`);
  console.log('✓ Existing application tables dropped');
}

async function initializeDatabase({ reset = false } = {}) {
  const client = new pg.Client({ connectionString: CONNECTION_STRING });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('✓ Connected to PostgreSQL');

    if (reset) {
      await resetDatabase(client);
    }

    // Check PostGIS version
    console.log('\nChecking PostGIS extension...');
    const versionResult = await client.query('SELECT PostGIS_Version()');
    console.log('✓ PostGIS version:', versionResult.rows[0].postgis_version);

    // Read schema file
    console.log('\nReading schema.sql...');
    const schemaPath = join(__dirname, '..', 'data', 'schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf-8');
    console.log(`✓ Schema file loaded (${schemaSql.length} characters)`);

    // Execute schema
    console.log('\nExecuting non-destructive schema...');
    await client.query(schemaSql);
    console.log('✓ Schema initialized successfully');

    // Verify tables were created
    console.log('\nVerifying tables...');
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('✓ Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    // Verify spatial indexes
    console.log('\nVerifying spatial indexes...');
    const indexesResult = await client.query(`
      SELECT
        schemaname,
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE '%_location%'
      ORDER BY tablename, indexname
    `);

    console.log('✓ Spatial indexes created:');
    indexesResult.rows.forEach(row => {
      console.log(`  - ${row.tablename}.${row.indexname}`);
    });

    // Verify helper functions (if any exist)
    console.log('\nVerifying helper functions...');
    const functionsResult = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_type = 'FUNCTION'
      ORDER BY routine_name
    `);

    if (functionsResult.rows.length > 0) {
      console.log('✓ Helper functions created:');
      functionsResult.rows.forEach(row => {
        console.log(`  - ${row.routine_name}()`);
      });
    } else {
      console.log('✓ No custom functions (queries handled in application code)');
    }

    // Show current statistics (all zeros for now)
    console.log('\nDatabase statistics:');
    const stats = await Promise.all([
      client.query('SELECT COUNT(*) FROM geonames_countries'),
      client.query('SELECT COUNT(*) FROM geonames_admin1_codes'),
      client.query('SELECT COUNT(*) FROM geonames_cities'),
      client.query('SELECT COUNT(*) FROM osm_pois'),
      client.query('SELECT COUNT(*) FROM regions'),
      client.query('SELECT COUNT(*) FROM import_log'),
    ]);

    console.log(`  - Countries: ${stats[0].rows[0].count}`);
    console.log(`  - Admin1 Codes (States/Provinces): ${stats[1].rows[0].count}`);
    console.log(`  - Cities: ${stats[2].rows[0].count}`);
    console.log(`  - POIs: ${stats[3].rows[0].count}`);
    console.log(`  - Regions: ${stats[4].rows[0].count}`);
    console.log(`  - Import records: ${stats[5].rows[0].count}`);

    console.log('\n✅ Database initialization complete!');
    console.log('\nNext steps:');
    console.log('  1. Import GeoNames data (countries, admin1 codes, cities): npm run db:import-geonames');
    console.log('  2. Download OSM data: curl -L -o data/thailand-latest.osm.pbf https://download.geofabrik.de/asia/thailand-latest.osm.pbf');
    console.log('  3. Import OSM POI data: node src/import-osm-pbf.js data/thailand-latest.osm.pbf all');

  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase({ reset: process.argv.includes('--reset') });
}

export { initializeDatabase, resetDatabase };
