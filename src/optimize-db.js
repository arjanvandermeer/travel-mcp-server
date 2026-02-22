#!/usr/bin/env node

/**
 * Database Optimization Script
 *
 * Runs maintenance tasks to optimize database performance after imports:
 * - VACUUM ANALYZE: Reclaims storage and updates statistics
 * - REINDEX: Rebuilds indexes for optimal performance
 * - Statistics update for query planner
 *
 * Usage:
 *   node src/optimize-db.js [options]
 *
 * Options:
 *   --full          Run VACUUM FULL (reclaims more space but locks tables)
 *   --reindex       Also rebuild all indexes
 *   --table=NAME    Only optimize specific table
 *   --dry-run       Show what would be done without executing
 *
 * Examples:
 *   node src/optimize-db.js                    # Standard optimization
 *   node src/optimize-db.js --full             # Full vacuum (locks tables)
 *   node src/optimize-db.js --table=osm_pois   # Only optimize osm_pois
 *   node src/optimize-db.js --reindex          # Also rebuild indexes
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import pg from 'pg';
import * as telemetry from './telemetry.js';
import { parseOptimizeArgs } from './lib/arg-parsers.js';

const PG_CONNECTION = process.env.DATABASE_URL || 'postgresql://<user>:<password>@localhost:5432/travel';

// Tables to optimize (ordered by typical size/importance)
const TABLES_TO_OPTIMIZE = [
  'osm_pois',
  'geonames_cities',
  'geonames_admin1_codes',
  'geonames_countries',
  'google_places',
  'osm_google_mappings',
  'import_log',
  'import_sources',
];

// Parse command line arguments (uses extracted pure function)
function parseArgs() {
  const options = parseOptimizeArgs(process.argv.slice(2));

  // Handle help flag - show usage and exit
  if (options.help) {
    console.log(`
Database Optimization Script

Runs maintenance tasks to optimize database performance after imports.

Usage:
  node src/optimize-db.js [options]

Options:
  --full          Run VACUUM FULL (reclaims more space but locks tables)
  --reindex       Also rebuild all indexes
  --table=NAME    Only optimize specific table
  --dry-run       Show what would be done without executing
  --help, -h      Show this help message

Examples:
  node src/optimize-db.js                    # Standard optimization
  node src/optimize-db.js --full             # Full vacuum (locks tables)
  node src/optimize-db.js --table=osm_pois   # Only optimize osm_pois
  node src/optimize-db.js --reindex          # Also rebuild indexes
`);
    process.exit(0);
  }

  return options;
}

/**
 * Get table statistics
 */
async function getTableStats(pool, tableName) {
  const result = await pool.query(`
    SELECT
      pg_size_pretty(pg_total_relation_size($1)) as total_size,
      pg_size_pretty(pg_table_size($1)) as table_size,
      pg_size_pretty(pg_indexes_size($1)) as indexes_size,
      (SELECT reltuples::bigint FROM pg_class WHERE relname = $1) as row_estimate,
      (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = $1) as dead_tuples,
      (SELECT last_vacuum FROM pg_stat_user_tables WHERE relname = $1) as last_vacuum,
      (SELECT last_analyze FROM pg_stat_user_tables WHERE relname = $1) as last_analyze
  `, [tableName]);

  return result.rows[0];
}

/**
 * Run VACUUM ANALYZE on a table
 */
async function vacuumTable(pool, tableName, full = false) {
  const vacuumType = full ? 'VACUUM FULL ANALYZE' : 'VACUUM ANALYZE';
  console.log(`  Running ${vacuumType} ${tableName}...`);

  const startTime = Date.now();
  await pool.query(`${vacuumType} ${tableName}`);
  const duration = Date.now() - startTime;

  console.log(`  ✓ Completed in ${(duration / 1000).toFixed(1)}s`);
  return duration;
}

/**
 * Reindex a table
 */
async function reindexTable(pool, tableName) {
  console.log(`  Running REINDEX TABLE ${tableName}...`);

  const startTime = Date.now();
  await pool.query(`REINDEX TABLE ${tableName}`);
  const duration = Date.now() - startTime;

  console.log(`  ✓ Completed in ${(duration / 1000).toFixed(1)}s`);
  return duration;
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });
  const startTime = Date.now();

  // Initialize telemetry
  await telemetry.initTelemetry();
  const transaction = telemetry.startTransaction('db.optimize', 'maintenance');

  try {
    // Test connection
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL\n');
    client.release();

    // Determine which tables to optimize
    const tables = options.table
      ? [options.table]
      : TABLES_TO_OPTIMIZE;

    console.log(`Database Optimization${options.dryRun ? ' [DRY RUN]' : ''}`);
    console.log('='.repeat(50));
    console.log(`Mode: ${options.full ? 'VACUUM FULL' : 'VACUUM'} ANALYZE${options.reindex ? ' + REINDEX' : ''}`);
    console.log(`Tables: ${tables.join(', ')}\n`);

    // Show current stats
    console.log('Current table statistics:');
    console.log('-'.repeat(50));

    for (const table of tables) {
      try {
        const stats = await getTableStats(pool, table);
        console.log(`\n${table}:`);
        console.log(`  Size: ${stats.total_size} (table: ${stats.table_size}, indexes: ${stats.indexes_size})`);
        console.log(`  Rows: ~${parseInt(stats.row_estimate || 0).toLocaleString()}`);
        console.log(`  Dead tuples: ${parseInt(stats.dead_tuples || 0).toLocaleString()}`);
        console.log(`  Last vacuum: ${stats.last_vacuum || 'never'}`);
        console.log(`  Last analyze: ${stats.last_analyze || 'never'}`);
      } catch (error) {
        console.log(`\n${table}: (table not found or error: ${error.message})`);
      }
    }

    if (options.dryRun) {
      console.log('\n[DRY RUN] No optimization was performed.');
      transaction.setData('dry_run', true);
      transaction.setStatus('ok');
      return;
    }

    // Run optimization
    console.log('\n' + '='.repeat(50));
    console.log('Running optimization...\n');

    let totalVacuumTime = 0;
    let totalReindexTime = 0;
    let tablesOptimized = 0;

    for (const table of tables) {
      try {
        console.log(`\nOptimizing ${table}:`);

        // Vacuum
        const vacuumTime = await vacuumTable(pool, table, options.full);
        totalVacuumTime += vacuumTime;

        // Reindex if requested
        if (options.reindex) {
          const reindexTime = await reindexTable(pool, table);
          totalReindexTime += reindexTime;
        }

        tablesOptimized++;
      } catch (error) {
        console.log(`  ✗ Error: ${error.message}`);
        telemetry.captureException(error, { table });
      }
    }

    // Summary
    const totalDuration = Date.now() - startTime;
    console.log('\n' + '='.repeat(50));
    console.log('OPTIMIZATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`Tables optimized: ${tablesOptimized}/${tables.length}`);
    console.log(`Vacuum time: ${(totalVacuumTime / 1000).toFixed(1)}s`);
    if (options.reindex) {
      console.log(`Reindex time: ${(totalReindexTime / 1000).toFixed(1)}s`);
    }
    console.log(`Total time: ${(totalDuration / 1000).toFixed(1)}s`);

    // Record telemetry
    transaction.setData('tables_optimized', tablesOptimized);
    transaction.setData('vacuum_time_ms', totalVacuumTime);
    transaction.setData('reindex_time_ms', totalReindexTime);
    transaction.setData('total_time_ms', totalDuration);
    transaction.setStatus('ok');

    telemetry.incrementCounter('db.optimize.completed', 1);
    telemetry.recordDistribution('db.optimize.duration', totalDuration, { unit: 'millisecond' });

    console.log('\n✅ Optimization complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    telemetry.captureException(error);
    transaction.setStatus('error');
    process.exit(1);
  } finally {
    transaction.finish();
    await telemetry.flush();
    await pool.end();
  }
}

main();
