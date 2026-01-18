#!/usr/bin/env node

/**
 * Initialize PostgreSQL database schema
 *
 * This script:
 * 1. Connects to PostgreSQL
 * 2. Reads and executes schema.sql
 * 3. Verifies PostGIS is working
 * 4. Shows database statistics
 *
 * Usage:
 *   node src/init-postgres.js
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
const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function initializeDatabase() {
  const client = new pg.Client({ connectionString: CONNECTION_STRING });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('✓ Connected to PostgreSQL');

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
    console.log('\nExecuting schema...');
    await client.query(schemaSql);
    console.log('✓ Schema created successfully');

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
      client.query('SELECT COUNT(*) FROM geonames_cities'),
      client.query('SELECT COUNT(*) FROM osm_pois'),
      client.query('SELECT COUNT(*) FROM regions'),
      client.query('SELECT COUNT(*) FROM imports'),
    ]);

    console.log(`  - Countries: ${stats[0].rows[0].count}`);
    console.log(`  - Cities: ${stats[1].rows[0].count}`);
    console.log(`  - POIs: ${stats[2].rows[0].count}`);
    console.log(`  - Regions: ${stats[3].rows[0].count}`);
    console.log(`  - Import records: ${stats[4].rows[0].count}`);

    console.log('\n✅ Database initialization complete!');
    console.log('\nNext steps:');
    console.log('  1. Import GeoNames data: npm run db:import-geonames');
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
  initializeDatabase();
}

export { initializeDatabase };
