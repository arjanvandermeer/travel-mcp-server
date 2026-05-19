#!/usr/bin/env node

/**
 * Refresh stale imports based on refresh_interval_days
 *
 * This script finds import_sources that are due for refresh and re-imports them.
 * Designed to be run as a cron job, Lambda function, or manually.
 *
 * Usage:
 *   node scripts/refresh-imports.js [options]
 *
 * Options:
 *   --dry-run       Show what would be refreshed without actually importing
 *   --max=N         Maximum number of regions to refresh (for Lambda timeouts)
 *   --region=NAME   Refresh only a specific region
 *   --force         Refresh even if not due yet
 *   --list          Just list all import sources and their status
 *
 * Examples:
 *   node scripts/refresh-imports.js --dry-run
 *   node scripts/refresh-imports.js --max=3
 *   node scripts/refresh-imports.js --region=thailand --force
 *   node scripts/refresh-imports.js --list
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import pg from 'pg';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as telemetry from '../src/telemetry.js';
import { parseRefreshArgs } from '../src/lib/arg-parsers.js';
import { TravelDatabase } from '../src/database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PG_CONNECTION = process.env.DATABASE_URL || 'postgresql://<user>:<password>@localhost:5432/travel';

// Parse command line arguments (uses extracted pure function)
function parseArgs() {
  const options = parseRefreshArgs(process.argv.slice(2));

  // Handle help flag - show usage and exit
  if (options.help) {
    console.log(`
Refresh stale imports based on refresh_interval_days

Usage:
  node scripts/refresh-imports.js [options]

Options:
  --dry-run       Show what would be refreshed without actually importing
  --max=N         Maximum number of regions to refresh (for Lambda timeouts)
  --region=NAME   Refresh only a specific region
  --force         Refresh even if not due yet
  --list          Just list all import sources and their status
  --optimize      Run database optimization after imports complete
  --refresh-geonames  Re-import GeoNames countries and cities data
  --geonames-country=XX  Limit GeoNames refresh to a 2-letter country code
  --refresh-google    Refresh stale Google Places cache entries
  --skip-osm          Skip OSM import source refresh checks
  --help, -h      Show this help message

Examples:
  node scripts/refresh-imports.js --dry-run
  node scripts/refresh-imports.js --max=3
  node scripts/refresh-imports.js --region=thailand --force
  node scripts/refresh-imports.js --list
  node scripts/refresh-imports.js --optimize   # Refresh and optimize
  node scripts/refresh-imports.js --skip-osm --refresh-geonames
`);
    process.exit(0);
  }

  return options;
}

/**
 * Get import sources that are due for refresh
 */
async function getStaleImports(pool, options) {
  let query;
  let params = [];

  if (options.region) {
    // Specific region
    if (options.force) {
      query = `
        SELECT * FROM import_sources
        WHERE keyword = $1 AND enabled = true
        ORDER BY keyword
      `;
    } else {
      query = `
        SELECT * FROM import_sources
        WHERE keyword = $1
          AND enabled = true
          AND (last_imported_at IS NULL
               OR last_imported_at < CURRENT_TIMESTAMP - (refresh_interval_days || ' days')::interval)
        ORDER BY keyword
      `;
    }
    params = [options.region.toLowerCase()];
  } else if (options.force) {
    // All enabled sources (force refresh)
    query = `
      SELECT * FROM import_sources
      WHERE enabled = true
      ORDER BY keyword
    `;
  } else {
    // Only stale sources
    query = `
      SELECT * FROM import_sources
      WHERE enabled = true
        AND (last_imported_at IS NULL
             OR last_imported_at < CURRENT_TIMESTAMP - (refresh_interval_days || ' days')::interval)
      ORDER BY
        CASE WHEN last_imported_at IS NULL THEN 0 ELSE 1 END,
        last_imported_at ASC
    `;
  }

  const result = await pool.query(query, params);

  // Apply max limit if specified
  if (options.max && result.rows.length > options.max) {
    return result.rows.slice(0, options.max);
  }

  return result.rows;
}

/**
 * List all import sources with their status
 */
async function listImportSources(pool) {
  const result = await pool.query(`
    SELECT
      keyword,
      display_name,
      enabled,
      refresh_interval_days,
      last_imported_at,
      CASE
        WHEN last_imported_at IS NULL THEN 'never'
        WHEN last_imported_at < CURRENT_TIMESTAMP - (refresh_interval_days || ' days')::interval THEN 'stale'
        ELSE 'fresh'
      END as status,
      CASE
        WHEN last_imported_at IS NULL THEN NULL
        ELSE ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_imported_at)) / 86400)
      END as days_since_import
    FROM import_sources
    ORDER BY
      enabled DESC,
      status DESC,
      keyword
  `);

  console.log('\nImport Sources:\n');
  console.log('%-25s %-25s %-8s %-8s %-10s %s'.replace(/%(-?\d+)s/g, (_, n) => `%${n}s`));
  console.log(
    padRight('Keyword', 25),
    padRight('Display Name', 25),
    padRight('Enabled', 8),
    padRight('Refresh', 8),
    padRight('Status', 10),
    'Days Ago'
  );
  console.log('-'.repeat(90));

  for (const row of result.rows) {
    console.log(
      padRight(row.keyword, 25),
      padRight(row.display_name || '', 25),
      padRight(row.enabled ? 'yes' : 'no', 8),
      padRight(`${row.refresh_interval_days}d`, 8),
      padRight(row.status, 10),
      row.days_since_import !== null ? `${row.days_since_import}` : '-'
    );
  }

  // Summary
  const stale = result.rows.filter(r => r.status === 'stale' && r.enabled).length;
  const never = result.rows.filter(r => r.status === 'never' && r.enabled).length;
  const fresh = result.rows.filter(r => r.status === 'fresh' && r.enabled).length;
  const disabled = result.rows.filter(r => !r.enabled).length;

  console.log('\n' + '-'.repeat(90));
  console.log(`Total: ${result.rows.length} sources (${fresh} fresh, ${stale} stale, ${never} never imported, ${disabled} disabled)`);
}

function padRight(str, len) {
  str = String(str);
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

/**
 * Run import for a single region
 */
async function runImport(keyword) {
  return new Promise((resolve, _reject) => {
    const importScript = path.join(__dirname, 'import-osm.js');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting import for: ${keyword}`);
    console.log('='.repeat(60));

    const child = spawn('node', [importScript, keyword, 'all'], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ keyword, success: true });
      } else {
        resolve({ keyword, success: false, code });
      }
    });

    child.on('error', (error) => {
      resolve({ keyword, success: false, error: error.message });
    });
  });
}

/**
 * Run GeoNames import
 */
async function runGeonamesImport(options = {}) {
  return new Promise((resolve) => {
    const geonamesScript = path.join(__dirname, 'import-geonames.js');
    const args = [geonamesScript];
    if (options.geonamesCountryCode) {
      args.push(`--country-code=${options.geonamesCountryCode}`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(options.geonamesCountryCode
      ? `Running GeoNames import for ${options.geonamesCountryCode}...`
      : 'Running GeoNames import...');
    console.log('='.repeat(60));

    const child = spawn('node', args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Run database optimization
 */
async function runOptimization() {
  return new Promise((resolve) => {
    const optimizeScript = path.join(__dirname, 'optimize-db.js');

    console.log(`\n${'='.repeat(60)}`);
    console.log('Running database optimization...');
    console.log('='.repeat(60));

    const child = spawn('node', [optimizeScript], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  // Initialize telemetry
  await telemetry.initTelemetry();
  const transaction = telemetry.startTransaction('osm.refresh', 'scheduled');

  try {
    // Test connection
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL');
    client.release();

    // List mode
    if (options.list) {
      await listImportSources(pool);
      transaction.finish();
      await telemetry.flush();
      return;
    }

    // Get stale imports unless this run is intentionally data-source specific.
    const staleImports = options.skipOsm ? [] : await getStaleImports(pool, options);

    if (staleImports.length === 0 && !options.refreshGoogle && !options.refreshGeonames) {
      if (options.region) {
        console.log(`\nNo refresh needed for "${options.region}" (or region not found/disabled)`);
      } else if (options.skipOsm) {
        console.log('\nNo refresh work requested. Use --refresh-google and/or --refresh-geonames with --skip-osm.');
      } else {
        console.log('\n✓ All imports are up to date!');
      }
      return;
    }

    const results = [];
    const successful = [];
    const failed = [];

    if (staleImports.length > 0) {
      console.log(`\nFound ${staleImports.length} region(s) to refresh:`);
      for (const source of staleImports) {
        const lastImport = source.last_imported_at
          ? `last imported ${Math.round((Date.now() - new Date(source.last_imported_at).getTime()) / 86400000)} days ago`
          : 'never imported';
        console.log(`  - ${source.keyword} (${source.display_name}) - ${lastImport}`);
      }

      if (!options.dryRun) {
        // Run imports
        console.log('\nStarting imports...\n');

        for (const source of staleImports) {
          const result = await runImport(source.keyword);
          results.push(result);
        }

        successful.push(...results.filter(r => r.success));
        failed.push(...results.filter(r => !r.success));

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('REFRESH SUMMARY');
        console.log('='.repeat(60));
      } else {
        console.log('\n[DRY RUN] No imports were executed.');
      }
    }

    if (successful.length > 0) {
      console.log(`\n✓ Successfully refreshed (${successful.length}):`);
      for (const r of successful) {
        console.log(`  - ${r.keyword}`);
      }
    }

    if (failed.length > 0) {
      console.log(`\n✗ Failed to refresh (${failed.length}):`);
      for (const r of failed) {
        console.log(`  - ${r.keyword}: ${r.error || `exit code ${r.code}`}`);
      }
    }

    // Run optimization if requested and at least one import succeeded
    if (options.optimize && successful.length > 0) {
      const optimizeSuccess = await runOptimization();
      transaction.setData('optimization_run', true);
      transaction.setData('optimization_success', optimizeSuccess);
    }

    // Run GeoNames import if requested
    if (options.refreshGeonames) {
      const geonamesSuccess = await runGeonamesImport(options);
      transaction.setData('geonames_refresh', true);
      transaction.setData('geonames_country_code', options.geonamesCountryCode || null);
      transaction.setData('geonames_success', geonamesSuccess);
      if (geonamesSuccess) {
        console.log('\n✓ GeoNames import completed successfully');
      } else {
        console.log('\n✗ GeoNames import failed');
      }
    }

    // Refresh stale Google Places cache entries if requested
    if (options.refreshGoogle) {
      console.log('\nRefreshing stale Google Places cache entries...');
      const db = new TravelDatabase({ pool });
      const staleEntries = await db.getStaleGooglePlacesEntries(options.max || 100);

      if (staleEntries.length === 0) {
        console.log('✓ All Google Places cache entries are up to date!');
      } else {
        console.log(`Found ${staleEntries.length} stale Google Places entries to refresh`);

        if (!options.dryRun) {
          let refreshed = 0;
          let errors = 0;
          const batchSize = 3;

          for (let i = 0; i < staleEntries.length; i += batchSize) {
            const batch = staleEntries.slice(i, i + batchSize);
            await Promise.all(batch.map(async (entry) => {
              try {
                await db.enrichOSMPOI(entry.osm_id);
                refreshed++;
              } catch (err) {
                errors++;
                console.error(`  Error refreshing OSM ${entry.osm_id}: ${err.message}`);
              }
            }));
          }

          console.log(`\n✓ Google Places refresh complete: ${refreshed} refreshed, ${errors} errors`);
          transaction.setData('google_refresh_count', refreshed);
          transaction.setData('google_refresh_errors', errors);
        } else {
          console.log('[DRY RUN] No Google Places entries were refreshed.');
        }
      }
      transaction.setData('google_refresh', true);
    }

    // Record telemetry
    transaction.setData('regions_attempted', results.length);
    transaction.setData('regions_successful', successful.length);
    transaction.setData('regions_failed', failed.length);
    telemetry.incrementCounter('osm.refresh.completed', 1);
    telemetry.recordDistribution('osm.refresh.regions', results.length, { unit: 'none' });

    if (failed.length > 0) {
      transaction.setStatus('error');
      telemetry.incrementCounter('osm.refresh.with_failures', 1);
    } else {
      transaction.setStatus('ok');
    }

    // Exit with error if any failed
    if (failed.length > 0) {
      transaction.finish();
      await telemetry.flush();
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    telemetry.captureException(error);
    transaction.setStatus('error');
    transaction.finish();
    await telemetry.flush();
    process.exit(1);
  } finally {
    transaction.finish();
    await telemetry.flush();
    await pool.end();
  }
}

main();
