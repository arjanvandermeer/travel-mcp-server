#!/usr/bin/env node

/**
 * Import OSM POI data from PBF files into PostgreSQL
 *
 * This script supports two modes:
 * 1. Keyword mode: Looks up source URL from database, downloads, imports, and cleans up
 * 2. File mode: Imports from an existing local PBF file
 *
 * Usage:
 *   node src/import-osm-pbf.js <keyword-or-file> [poi-type]
 *
 * Examples:
 *   node src/import-osm-pbf.js france all          # Downloads and imports France
 *   node src/import-osm-pbf.js thailand            # Downloads and imports Thailand (all POIs)
 *   node src/import-osm-pbf.js local-file.osm.pbf  # Imports from local file
 *
 * The import_sources table contains keyword-to-URL mappings.
 * Run: psql $DATABASE_URL < data/migrations/001_import_sources.sql
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import pg from 'pg';
import parseOSM from 'osm-pbf-parser';
import through2 from 'through2';
import dotenv from 'dotenv';
import * as telemetry from './telemetry.js';
import { matchPOIType, extractPOIData, shouldFilterPOI } from './lib/osm-mappings.js';
import { parseImportArgs } from './lib/arg-parsers.js';
import { linkPOIsToCities } from './link-pois-to-cities.js';

dotenv.config();

const PG_CONNECTION = process.env.DATABASE_URL || 'postgresql://<user>:<password>@localhost:5432/travel';

// POI_MAPPINGS is now imported from './lib/osm-mappings.js'

/**
 * Look up import source from database by keyword
 * @param {pg.Pool} pool - PostgreSQL pool
 * @param {string} keyword - e.g., 'france', 'thailand'
 * @returns {Object|null} - Import source record or null
 */
async function lookupImportSource(pool, keyword) {
  const result = await pool.query(
    'SELECT * FROM import_sources WHERE keyword = $1 AND enabled = true',
    [keyword.toLowerCase()]
  );
  return result.rows[0] || null;
}

/**
 * Check if a file should be downloaded based on age
 * @param {string} filePath - Path to the file
 * @param {number} maxAgeDays - Maximum age in days before re-downloading
 * @returns {{shouldDownload: boolean, reason: string, fileAge?: number}}
 */
function checkFileAge(filePath, maxAgeDays = 7) {
  if (!fs.existsSync(filePath)) {
    return { shouldDownload: true, reason: 'file does not exist' };
  }

  const stats = fs.statSync(filePath);
  const fileAgeDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

  if (fileAgeDays > maxAgeDays) {
    return {
      shouldDownload: true,
      reason: `file is ${fileAgeDays.toFixed(1)} days old (max: ${maxAgeDays} days)`,
      fileAge: fileAgeDays,
    };
  }

  return {
    shouldDownload: false,
    reason: `file is ${fileAgeDays.toFixed(1)} days old (still fresh)`,
    fileAge: fileAgeDays,
  };
}

/**
 * Download a file from URL with progress display
 * Does NOT delete files on failure - allows resuming/retrying
 * @param {string} url - URL to download from
 * @param {string} destPath - Local path to save file
 * @returns {Promise<void>}
 */
async function downloadFile(url, destPath) {
  // Use a temp file for downloading to avoid corrupting existing files
  const tempPath = destPath + '.downloading';

  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading from: ${url}`);
    console.log(`   Saving to: ${destPath}`);

    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(tempPath);

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        // Clean up temp file on redirect
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        console.log(`   Following redirect to: ${response.headers.location}`);
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        // Clean up temp file on HTTP error
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;
      let lastPercent = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent >= lastPercent + 5) {
            const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
            const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r   Progress: ${percent}% (${mb}/${totalMb} MB)`);
            lastPercent = percent;
          }
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        // Move temp file to final destination on success
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath); // Remove old file first
        }
        fs.renameSync(tempPath, destPath);
        console.log('\n   ✓ Download complete\n');
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      // Keep temp file for debugging but don't corrupt the original
      console.error(`\n   ⚠️  Download interrupted: ${err.message}`);
      console.error(`   Partial file kept at: ${tempPath}`);
      reject(err);
    });

    file.on('error', (err) => {
      file.close();
      // Keep temp file for debugging
      console.error(`\n   ⚠️  File write error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Clean up stale imports:
 * - 'running' for more than 24 hours (crashed/interrupted)
 * - 'aborted' for more than 1 hour (never picked up the abort signal)
 * @param {pg.Pool} pool - PostgreSQL pool
 */
async function cleanupStaleImports(pool) {
  // Clean up stale 'running' jobs (> 24 hours)
  const runningResult = await pool.query(`
    UPDATE import_log
    SET status = 'failed',
        completed_at = CURRENT_TIMESTAMP,
        error_message = 'Job running longer than 24 hours - likely interrupted or crashed'
    WHERE status = 'running'
      AND started_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
    RETURNING id, import_type, started_at
  `);

  if (runningResult.rowCount > 0) {
    console.log(`⚠️  Cleaned up ${runningResult.rowCount} stale running import(s):`);
    for (const row of runningResult.rows) {
      console.log(`   - Import #${row.id} (${row.import_type}) started at ${row.started_at}`);
    }
    console.log('');
  }

  // Clean up stale 'aborted' jobs (> 1 hour - never responded to abort)
  const abortedResult = await pool.query(`
    UPDATE import_log
    SET status = 'failed',
        completed_at = CURRENT_TIMESTAMP,
        error_message = 'Aborted import, cancelled after inactivity'
    WHERE status = 'aborted'
      AND started_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
    RETURNING id, import_type, started_at
  `);

  if (abortedResult.rowCount > 0) {
    console.log(`⚠️  Cleaned up ${abortedResult.rowCount} stale aborted import(s):`);
    for (const row of abortedResult.rows) {
      console.log(`   - Import #${row.id} (${row.import_type}) started at ${row.started_at}`);
    }
    console.log('');
  }
}

/**
 * Abort any existing running imports for the same region
 * @param {pg.Pool} pool - PostgreSQL pool
 * @param {string} regionName - Region being imported
 * @returns {number} - Number of imports aborted
 */
async function abortExistingImports(pool, regionName) {
  const result = await pool.query(`
    UPDATE import_log
    SET status = 'aborted',
        completed_at = CURRENT_TIMESTAMP,
        error_message = 'Aborted by new import for same region'
    WHERE status = 'running'
      AND region_name = $1
    RETURNING id, started_at
  `, [regionName]);

  if (result.rowCount > 0) {
    console.log(`⚠️  Aborted ${result.rowCount} existing import(s) for ${regionName}:`);
    for (const row of result.rows) {
      console.log(`   - Import #${row.id} started at ${row.started_at}`);
    }
    console.log('');
  }

  return result.rowCount;
}

/**
 * Check if import is still running (hasn't been aborted by another job)
 * @param {pg.Pool} pool - PostgreSQL pool
 * @param {number} importId - Our import ID
 * @returns {boolean} - true if still running, false if aborted
 */
async function checkImportStillRunning(pool, importId) {
  const result = await pool.query(
    'SELECT status FROM import_log WHERE id = $1',
    [importId]
  );
  return result.rows[0]?.status === 'running';
}

/**
 * Custom error for when import is aborted by another job
 */
class ImportAbortedError extends Error {
  constructor(importId) {
    super(`Import #${importId} was aborted by another job`);
    this.name = 'ImportAbortedError';
    this.importId = importId;
  }
}

/**
 * Main import function - handles both keyword and file-based imports
 * @param {string} input - Either a keyword (e.g., 'france') or file path
 * @param {string} poiType - Type of POIs to import ('all', 'hotel', etc.)
 */
async function importOSM(input, poiType = 'all') {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });
  let pbfPath = null;
  let shouldDeleteFile = false;
  let importSourceId = null;
  let sourceUrl = null;
  let regionName;
  const importStartTime = Date.now();

  // Initialize telemetry
  await telemetry.initTelemetry();
  const transaction = telemetry.startTransaction('osm.import', 'import');
  transaction.setTag('poi_type', poiType);
  transaction.setTag('input', input);

  try {
    // Test connection
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL');
    client.release();

    // Determine if input is a file or keyword
    const isFile = input.endsWith('.osm.pbf') || input.endsWith('.pbf') || fs.existsSync(input);

    if (isFile) {
      // File mode - use local file
      if (!fs.existsSync(input)) {
        console.error(`❌ File not found: ${input}`);
        process.exit(1);
      }
      pbfPath = input;
      regionName = path.basename(pbfPath, '.osm.pbf').replace(/-latest$/, '');

      // Try to find matching import source for metadata
      const source = await lookupImportSource(pool, regionName);
      if (source) {
        importSourceId = source.id;
        sourceUrl = source.source_url;
      }
    } else {
      // Keyword mode - look up and download
      const source = await lookupImportSource(pool, input);

      if (!source) {
        console.error(`❌ Unknown keyword: "${input}"`);
        console.error('\nAvailable keywords:');
        const available = await pool.query(
          'SELECT keyword, display_name FROM import_sources WHERE enabled = true ORDER BY keyword'
        );
        for (const row of available.rows) {
          console.error(`  - ${row.keyword} (${row.display_name})`);
        }
        process.exit(1);
      }

      importSourceId = source.id;
      sourceUrl = source.source_url;
      regionName = source.keyword;
      transaction.setTag('region', regionName);

      // Check if we need to download the file
      // Use ./data/ subdir if it exists (writable in Docker), otherwise cwd
      const filename = `${source.keyword}-latest.osm.pbf`;
      const dataDir = path.join(process.cwd(), 'data');
      const downloadDir = fs.existsSync(dataDir) ? dataDir : process.cwd();
      pbfPath = path.join(downloadDir, filename);

      const fileCheck = checkFileAge(pbfPath, 7); // 7 days max age

      if (fileCheck.shouldDownload) {
        console.log(`📂 ${fileCheck.reason}`);

        // Download the file with telemetry tracking
        const downloadSpan = transaction.startChild('http', `Download ${regionName}`);
        await downloadFile(source.source_url, pbfPath);
        downloadSpan.finish();

        // Record file size
        const fileSize = fs.statSync(pbfPath).size;
        telemetry.recordDistribution('osm.download.size', fileSize, { tags: { region: regionName }, unit: 'byte' });

        shouldDeleteFile = true;
      } else {
        const fileSize = fs.statSync(pbfPath).size;
        const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);
        console.log(`📂 Using cached file: ${pbfPath}`);
        console.log(`   ${fileCheck.reason} (${fileSizeMB} MB)`);
        console.log(`   To force re-download, delete the file or wait until it's older than 7 days\n`);

        // Don't delete cached files after import
        shouldDeleteFile = false;
      }
    }

    // Get file stats for source_date
    const fileStats = fs.statSync(pbfPath);
    const sourceDate = fileStats.mtime;
    const sourceFile = path.basename(pbfPath);

    console.log(`Starting import from: ${pbfPath}`);
    console.log(`Region: ${regionName}`);
    console.log(`POI Type: ${poiType}`);
    console.log(`Source URL: ${sourceUrl || 'local file'}`);
    console.log(`Source Date: ${sourceDate.toISOString().split('T')[0]}`);
    console.log('');

    // Clean up stale imports (running > 24 hours)
    await cleanupStaleImports(pool);

    // Abort any existing running imports for the same region
    await abortExistingImports(pool, regionName);

    // Record import start in import_log
    const importResult = await pool.query(`
      INSERT INTO import_log (import_type, source_file, source_url, source_date, region_name, status, started_at)
      VALUES ($1, $2, $3, $4, $5, 'running', CURRENT_TIMESTAMP)
      RETURNING id
    `, [`osm_${poiType}`, sourceFile, sourceUrl, sourceDate, regionName]);
    const importId = importResult.rows[0].id;

    try {
      // Parse PBF and import
      const recordsImported = await parsePBFFile(pbfPath, pool, poiType, regionName, importId);

      // Check if any records were imported
      if (recordsImported === 0) {
        await pool.query(`
          UPDATE import_log
          SET status = 'failed',
              completed_at = CURRENT_TIMESTAMP,
              records_imported = 0,
              error_message = $1
          WHERE id = $2
        `, [`No ${poiType} POIs found in ${sourceFile}. The file may not contain data for the requested POI type, or all POIs were filtered out (e.g., missing names).`, importId]);

        console.log(`\n⚠️  Import completed but found 0 ${poiType} POIs`);
        console.log('   This may indicate:');
        console.log('   - The PBF file doesn\'t contain data for this POI type');
        console.log('   - All POIs were filtered out (missing required name field)');
        console.log('   - Wrong POI type specified');
      } else {
        // Record import completion
        await pool.query(`
          UPDATE import_log
          SET status = 'completed',
              completed_at = CURRENT_TIMESTAMP,
              records_imported = $1
          WHERE id = $2
        `, [recordsImported, importId]);

        // Update import_sources with last import info
        if (importSourceId) {
          await pool.query(`
            UPDATE import_sources
            SET last_imported_at = CURRENT_TIMESTAMP,
                last_import_id = $1
            WHERE id = $2
          `, [importId, importSourceId]);
        }

        // Record telemetry metrics
        const duration = Date.now() - importStartTime;
        transaction.setTag('region', regionName);
        transaction.setData('records_imported', recordsImported);
        transaction.setData('duration_ms', duration);
        transaction.setStatus('ok');

        telemetry.incrementCounter('osm.import.completed', 1, { region: regionName, poi_type: poiType });
        telemetry.recordDistribution('osm.import.records', recordsImported, { tags: { region: regionName }, unit: 'none' });
        telemetry.recordDistribution('osm.import.duration', duration, { tags: { region: regionName }, unit: 'millisecond' });

        console.log('\n✅ Import complete!');
      }

      // Show statistics
      await showStatistics(pool, poiType);

      // Link newly imported POIs to nearest cities
      if (recordsImported > 0) {
        try {
          console.log('\nLinking imported POIs to nearest cities...');
          await linkPOIsToCities(pool, { sourceRegion: regionName });
        } catch (linkError) {
          console.warn('Warning: City linking failed (non-fatal):', linkError.message);
        }
      }

    } catch (error) {
      // Handle abort vs failure differently
      if (error instanceof ImportAbortedError) {
        await pool.query(`
          UPDATE import_log
          SET status = 'aborted',
              completed_at = CURRENT_TIMESTAMP,
              error_message = 'Aborted by another import job'
          WHERE id = $1
        `, [importId]).catch(() => {});
        console.log('\n⚠️  Import was aborted by another job starting for the same region');

        // Track abort in telemetry
        transaction.setTag('region', regionName);
        transaction.setStatus('aborted');
        telemetry.incrementCounter('osm.import.aborted', 1, { region: regionName });
      } else {
        // Record import failure
        await pool.query(`
          UPDATE import_log
          SET status = 'failed',
              completed_at = CURRENT_TIMESTAMP,
              error_message = $1
          WHERE id = $2
        `, [error.message, importId]).catch(() => {});

        // Track failure in telemetry
        transaction.setTag('region', regionName);
        transaction.setStatus('error');
        telemetry.incrementCounter('osm.import.failed', 1, { region: regionName });
        telemetry.captureException(error, { region: regionName, poi_type: poiType });
      }

      throw error;
    }

  } catch (error) {
    if (error instanceof ImportAbortedError) {
      console.log('Exiting gracefully after abort.');
      transaction.finish();
      await telemetry.flush();
      process.exit(0);
    }
    console.error('❌ Import failed:', error.message);
    console.error(error);
    transaction.finish();
    await telemetry.flush();
    process.exit(1);
  } finally {
    // Clean up downloaded file
    if (shouldDeleteFile && pbfPath && fs.existsSync(pbfPath)) {
      console.log(`\n🗑️  Removing downloaded file: ${pbfPath}`);
      fs.unlinkSync(pbfPath);
    }

    // Finish telemetry transaction and flush
    transaction.finish();
    await telemetry.flush();

    await pool.end();
  }
}

async function showStatistics(pool, poiType) {
  if (poiType === 'all') {
    const stats = await pool.query(`
      SELECT poi_type, COUNT(*) as count
      FROM osm_pois
      GROUP BY poi_type
      ORDER BY count DESC
    `);

    console.log('\nPOIs by type:');
    let total = 0;
    stats.rows.forEach(row => {
      console.log(`  ${row.poi_type}: ${row.count}`);
      total += parseInt(row.count);
    });
    console.log(`  TOTAL: ${total}`);

    // Show sample POIs
    console.log(`\nSample POIs from this import:`);
    const samples = await pool.query(`
      SELECT poi_type, name, address
      FROM osm_pois
      WHERE name IS NOT NULL
      ORDER BY imported_at DESC
      LIMIT 10
    `);

    samples.rows.forEach(poi => {
      const address = poi.address ? `, ${poi.address}` : '';
      console.log(`  [${poi.poi_type}] ${poi.name}${address}`);
    });
  } else {
    const stats = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE stars IS NOT NULL) as with_stars
      FROM osm_pois
      WHERE poi_type = $1
    `, [poiType]);

    console.log('\nDatabase statistics:');
    console.log(`  Total ${poiType}s: ${stats.rows[0].total}`);
    console.log(`  With star ratings: ${stats.rows[0].with_stars}`);

    // Show sample POIs
    console.log(`\nSample ${poiType}s from this import:`);
    const samples = await pool.query(`
      SELECT name, stars, address, latitude, longitude
      FROM osm_pois
      WHERE poi_type = $1 AND name IS NOT NULL
      ORDER BY imported_at DESC
      LIMIT 5
    `, [poiType]);

    samples.rows.forEach(poi => {
      const stars = poi.stars ? ` (${poi.stars}⭐)` : '';
      const address = poi.address ? `, ${poi.address}` : '';
      console.log(`  - ${poi.name}${stars}${address}`);
    });
  }
}

async function parsePBFFile(pbfPath, pool, poiType, regionName, importId) {
  // Three-pass approach (memory efficient):
  // Pass 1: Find ways with POI tags and collect their node IDs
  // Pass 2: Collect coordinates only for needed nodes
  // Pass 3: Process nodes AND ways with POI tags

  console.log('Parsing PBF file (three-pass for nodes + ways)...\n');

  // Helper to check if we've been aborted by another job
  let lastStatusCheck = Date.now();
  const STATUS_CHECK_INTERVAL = 30000; // Check every 30 seconds

  async function checkNotAborted() {
    const now = Date.now();
    if (now - lastStatusCheck >= STATUS_CHECK_INTERVAL) {
      lastStatusCheck = now;
      const stillRunning = await checkImportStillRunning(pool, importId);
      if (!stillRunning) {
        throw new ImportAbortedError(importId);
      }
    }
  }

  // Helper to update records_imported count in import_log
  async function updateRecordsImported(count) {
    await pool.query(
      'UPDATE import_log SET records_imported = $1 WHERE id = $2',
      [count, importId]
    ).catch(() => {}); // Don't fail if update fails
  }

  // Pass 1: Find POI ways and collect their node refs
  console.log('Pass 1: Finding POI ways and collecting required node IDs...');
  const neededNodeIds = new Set();
  const poiWays = []; // Store way data for pass 3

  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    let waysFound = 0;

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj((items, enc, next) => {
        for (const item of items) {
          if (item.type === 'way' && item.tags && item.refs && item.refs.length > 0) {
            const matchedType = matchPOIType(item.tags, poiType);
            if (matchedType) {
              // Store this way for later processing
              poiWays.push({
                id: item.id,
                tags: item.tags,
                refs: item.refs,
                matchedType,
              });
              // Mark its nodes as needed
              for (const ref of item.refs) {
                neededNodeIds.add(ref);
              }
              waysFound++;
              if (waysFound % 1000 === 0) {
                console.log(`  Found ${waysFound} POI ways, need ${neededNodeIds.size.toLocaleString()} nodes...`);
              }
            }
          }
        }
        next();
      }))
      .on('finish', () => {
        console.log(`  ✓ Found ${poiWays.length} POI ways, need ${neededNodeIds.size.toLocaleString()} node coordinates\n`);
        resolve();
      })
      .on('error', reject);
  });

  // Pass 2: Collect coordinates only for needed nodes
  console.log('Pass 2: Collecting coordinates for needed nodes...');
  const nodeCoords = new Map();

  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    let collected = 0;

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj((items, enc, next) => {
        for (const item of items) {
          if (item.type === 'node' && item.lat && item.lon && neededNodeIds.has(item.id)) {
            nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
            collected++;
            if (collected % 10000 === 0) {
              console.log(`  Collected ${collected.toLocaleString()} / ${neededNodeIds.size.toLocaleString()} node coordinates...`);
            }
          }
        }
        next();
      }))
      .on('finish', () => {
        console.log(`  ✓ Collected ${nodeCoords.size.toLocaleString()} node coordinates\n`);
        resolve();
      })
      .on('error', reject);
  });

  // Clear the set to free memory
  neededNodeIds.clear();

  // Pass 3: Process POI nodes and use collected way data
  console.log('Pass 3: Processing POIs (nodes + ways)...');

  let processed = 0;
  let nodesPOIs = 0;
  let waysPOIs = 0;
  let pois = [];
  const batchSize = 1000;

  // First, process all the ways we collected
  for (const way of poiWays) {
    const coords = way.refs
      .map(ref => nodeCoords.get(ref))
      .filter(c => c !== undefined);

    if (coords.length > 0) {
      const centroid = {
        lat: coords.reduce((sum, c) => sum + c.lat, 0) / coords.length,
        lon: coords.reduce((sum, c) => sum + c.lon, 0) / coords.length,
      };

      const wayItem = {
        id: way.id,
        type: 'way',
        lat: centroid.lat,
        lon: centroid.lon,
        tags: way.tags,
      };

      const poi = extractPOIData(wayItem, way.matchedType, regionName);
      // Skip POIs without a valid name (uses extracted pure function)
      if (shouldFilterPOI(poi)) {
        continue;
      }
      pois.push(poi);
      waysPOIs++;

      if (pois.length >= batchSize) {
        await insertBatch(pool, pois);
        await checkNotAborted(); // Check if we've been aborted
        processed += pois.length;
        await updateRecordsImported(processed); // Update progress in DB
        console.log(`  Processed: ${processed} POIs (${nodesPOIs} nodes, ${waysPOIs} ways)`);
        pois = [];
      }
    }
  }

  // Clear way data and node coords to free memory
  poiWays.length = 0;
  nodeCoords.clear();

  // Now process POI nodes (single pass through file)
  await new Promise((resolve, reject) => {
    const osm = parseOSM();

    fs.createReadStream(pbfPath)
      .pipe(osm)
      .pipe(through2.obj(async (items, enc, next) => {
        try {
          for (const item of items) {
            if (item.type === 'node' && item.lat && item.lon && item.tags) {
              const matchedType = matchPOIType(item.tags, poiType);
              if (matchedType) {
                const poi = extractPOIData(item, matchedType, regionName);
                // Skip POIs without a valid name (uses extracted pure function)
                if (shouldFilterPOI(poi)) {
                  continue;
                }
                pois.push(poi);
                nodesPOIs++;

                if (pois.length >= batchSize) {
                  await insertBatch(pool, pois);
                  await checkNotAborted(); // Check if we've been aborted
                  processed += pois.length;
                  await updateRecordsImported(processed); // Update progress in DB
                  console.log(`  Processed: ${processed} POIs (${nodesPOIs} nodes, ${waysPOIs} ways)`);
                  pois = [];
                }
              }
            }
          }
          next();
        } catch (error) {
          next(error);
        }
      }))
      .on('finish', async () => {
        try {
          if (pois.length > 0) {
            await insertBatch(pool, pois);
            processed += pois.length;
            await updateRecordsImported(processed); // Final count update
          }
          console.log(`\n✓ PBF parsing complete`);
          console.log(`  Total: ${processed} POIs (${nodesPOIs} nodes, ${waysPOIs} ways)`);
          resolve(processed);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });

  return processed;
}

// matchPOIType, extractPOIData, and shouldFilterPOI are now imported from './lib/osm-mappings.js'

async function insertBatch(pool, pois) {
  if (pois.length === 0) return;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO osm_pois (
        osm_id, osm_type, poi_type, name, name_en,
        location, latitude, longitude,
        address, phone, email, website, opening_hours,
        cuisine, wheelchair,
        stars, rooms, beds,
        source_region, tags, imported_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($7, $6), 4326), $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14,
        $15, $16, $17,
        $18, $19, CURRENT_TIMESTAMP
      )
      ON CONFLICT (osm_id) DO UPDATE SET
        poi_type = EXCLUDED.poi_type,
        name = EXCLUDED.name,
        name_en = EXCLUDED.name_en,
        location = EXCLUDED.location,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        website = EXCLUDED.website,
        opening_hours = EXCLUDED.opening_hours,
        cuisine = EXCLUDED.cuisine,
        wheelchair = EXCLUDED.wheelchair,
        stars = EXCLUDED.stars,
        rooms = EXCLUDED.rooms,
        beds = EXCLUDED.beds,
        source_region = EXCLUDED.source_region,
        tags = EXCLUDED.tags,
        imported_at = CURRENT_TIMESTAMP
    `;

    for (const poi of pois) {
      try {
        await client.query(insertQuery, [
          poi.osm_id,
          poi.osm_type,
          poi.poi_type,
          poi.name,
          poi.name_en,
          poi.latitude,
          poi.longitude,
          poi.address,
          poi.phone,
          poi.email,
          poi.website,
          poi.opening_hours,
          poi.cuisine,
          poi.wheelchair,
          poi.stars,
          poi.rooms,
          poi.beds,
          poi.source_region,
          JSON.stringify(poi.osm_tags),
        ]);
      } catch (insertError) {
        console.error(`\n❌ INSERT ERROR for POI:`);
        console.error(`   osm_id: ${poi.osm_id}`);
        console.error(`   name: ${poi.name}`);
        console.error(`   rooms: ${poi.rooms} (type: ${typeof poi.rooms})`);
        console.error(`   beds: ${poi.beds} (type: ${typeof poi.beds})`);
        console.error(`   stars: ${poi.stars}`);
        console.error(`   Error: ${insertError.message}`);
        throw insertError;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly (uses extracted pure function for arg parsing)
if (import.meta.url === `file://${process.argv[1]}`) {
  const { input, poiType } = parseImportArgs(process.argv.slice(2));

  if (!input) {
    console.log('Usage: node src/import-osm-pbf.js <keyword-or-file> [poi-type]');
    console.log('');
    console.log('Examples:');
    console.log('  node src/import-osm-pbf.js france           # Download and import France (all POIs)');
    console.log('  node src/import-osm-pbf.js thailand hotel   # Download and import Thailand hotels');
    console.log('  node src/import-osm-pbf.js local.osm.pbf    # Import from local file');
    console.log('');
    console.log('Available keywords are stored in the import_sources table.');
    console.log('Run migration: psql $DATABASE_URL < data/migrations/001_import_sources.sql');
    process.exit(1);
  }

  importOSM(input, poiType);
}

export { importOSM };
