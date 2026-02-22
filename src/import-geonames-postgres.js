#!/usr/bin/env node

/**
 * Import GeoNames data directly into PostgreSQL
 *
 * Downloads and imports:
 * - Countries (countryInfo.txt)
 * - Cities with population > 1000 (cities1000.txt)
 *
 * Usage:
 *   node src/import-geonames-postgres.js
 */

import fs from 'fs';
import https from 'https';
import { createWriteStream } from 'fs';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'data');
const PG_CONNECTION = process.env.DATABASE_URL ||
  'postgresql://<user>:<password>@localhost:5432/travel';

const GEONAMES_URLS = {
  countries: 'https://download.geonames.org/export/dump/countryInfo.txt',
  cities: 'https://download.geonames.org/export/dump/cities1000.zip',
  admin1: 'https://download.geonames.org/export/dump/admin1CodesASCII.txt',
};

async function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          const fileStream = createWriteStream(outputPath);
          redirectResponse.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        }).on('error', reject);
      } else {
        const fileStream = createWriteStream(outputPath);
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
      }
    }).on('error', reject);
  });
}

async function unzip(zipPath, outputPath) {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec(`unzip -o "${zipPath}" -d "${dirname(outputPath)}"`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Clean up stale imports that have been 'running' for more than 24 hours
 * @param {pg.Pool} pool - PostgreSQL pool
 */
async function cleanupStaleImports(pool) {
  const result = await pool.query(`
    UPDATE imports
    SET status = 'failed',
        completed_at = CURRENT_TIMESTAMP,
        error_message = 'Job running longer than 24 hours - likely interrupted or crashed'
    WHERE status = 'running'
      AND started_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
    RETURNING id, import_type, started_at
  `);

  if (result.rowCount > 0) {
    console.log(`⚠️  Cleaned up ${result.rowCount} stale import(s):`);
    for (const row of result.rows) {
      console.log(`   - Import #${row.id} (${row.import_type}) started at ${row.started_at}`);
    }
    console.log('');
  }
}

async function importCountries(pool) {
  console.log('\n=== Importing Countries ===');

  const filePath = join(DATA_DIR, 'countryInfo.txt');
  let importId;

  if (!fs.existsSync(filePath)) {
    console.log('Downloading countryInfo.txt...');
    await download(GEONAMES_URLS.countries, filePath);
    console.log('✓ Downloaded');
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => !line.startsWith('#') && line.trim());

  console.log(`Found ${lines.length} countries`);
  console.log('Importing into PostgreSQL...');

  // Start import tracking
  const importResult = await pool.query(`
    INSERT INTO imports (
      import_type, source_file, source_url, metadata, status
    ) VALUES ($1, $2, $3, $4, 'running')
    RETURNING id
  `, ['geonames_countries', 'countryInfo.txt', GEONAMES_URLS.countries, null]);

  importId = importResult.rows[0].id;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO geonames_countries (
        iso_alpha2, iso_alpha3, iso_numeric, fips, country,
        capital, area_sq_km, population, continent, tld,
        currency_code, currency_name, phone, postal_code_format,
        postal_code_regex, languages, geoname_id, neighbours,
        equivalent_fips_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (iso_alpha2) DO UPDATE SET
        iso_alpha3 = EXCLUDED.iso_alpha3,
        country = EXCLUDED.country,
        population = EXCLUDED.population,
        capital = EXCLUDED.capital,
        geoname_id = EXCLUDED.geoname_id
    `;

    let imported = 0;
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 19) continue;

      await client.query(insertQuery, [
        parts[0],  // ISO
        parts[1],  // ISO3
        parts[2] || null,  // ISO-Numeric
        parts[3] || null,  // fips
        parts[4],  // Country
        parts[5] || null,  // Capital
        parts[6] ? parseFloat(parts[6]) : null,  // Area (km²)
        parts[7] ? parseInt(parts[7]) : null,  // Population
        parts[8] || null,  // Continent
        parts[9] || null,  // tld
        parts[10] || null,  // CurrencyCode
        parts[11] || null,  // CurrencyName
        parts[12] || null,  // Phone
        parts[13] || null,  // Postal Code Format
        parts[14] || null,  // Postal Code Regex
        parts[15] || null,  // Languages
        parts[16] ? parseInt(parts[16]) : null,  // geonameid
        parts[17] || null,  // neighbours
        parts[18] || null,  // EquivalentFipsCode
      ]);
      imported++;
    }

    await client.query('COMMIT');
    console.log(`✓ Imported ${imported} countries`);

    // Check if any records were imported
    if (imported === 0) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            records_imported = 0,
            error_message = 'No countries found in countryInfo.txt. File may be empty or corrupted.'
        WHERE id = $1
      `, [importId]);
      console.log('⚠️  Import completed but found 0 countries');
    } else {
      // Mark import as completed
      await pool.query(`
        UPDATE imports
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            records_imported = $2
        WHERE id = $1
      `, [importId, imported]);
    }

  } catch (error) {
    await client.query('ROLLBACK');

    // Mark import as failed
    if (importId) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = $2
        WHERE id = $1
      `, [importId, error.message]).catch(e => console.error('Failed to update import status:', e.message));
    }

    throw error;
  } finally {
    client.release();
  }
}

async function importCities(pool) {
  console.log('\n=== Importing Cities ===');

  const zipPath = join(DATA_DIR, 'cities1000.zip');
  const txtPath = join(DATA_DIR, 'cities1000.txt');
  let importId;

  if (!fs.existsSync(txtPath)) {
    if (!fs.existsSync(zipPath)) {
      console.log('Downloading cities1000.zip (~35MB)...');
      await download(GEONAMES_URLS.cities, zipPath);
      console.log('✓ Downloaded');
    }

    console.log('Extracting cities1000.txt...');
    await unzip(zipPath, txtPath);
    console.log('✓ Extracted');
  }

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  console.log(`Found ${lines.length} cities`);
  console.log('Importing into PostgreSQL (this may take a minute)...');

  // Start import tracking
  const importResult = await pool.query(`
    INSERT INTO imports (
      import_type, source_file, source_url, metadata, status
    ) VALUES ($1, $2, $3, $4, 'running')
    RETURNING id
  `, ['geonames_cities', 'cities1000.txt', GEONAMES_URLS.cities, JSON.stringify({ min_population: 1000 })]);

  importId = importResult.rows[0].id;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO geonames_cities (
        geoname_id, name, ascii_name, alternate_names,
        location, latitude, longitude,
        feature_class, feature_code, country_code, cc2,
        admin1_code, admin2_code, admin3_code, admin4_code,
        population, elevation, dem, timezone, modification_date
      ) VALUES ($1, $2, $3, $4,
                ST_SetSRID(ST_MakePoint($6, $5), 4326), $5, $6,
                $7, $8, $9, $10,
                $11, $12, $13, $14,
                $15, $16, $17, $18, $19)
      ON CONFLICT (geoname_id) DO UPDATE SET
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        population = EXCLUDED.population,
        modification_date = EXCLUDED.modification_date
    `;

    let imported = 0;
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 19) continue;

      await client.query(insertQuery, [
        parseInt(parts[0]),  // geonameid
        parts[1],            // name
        parts[2],            // asciiname
        parts[3] || null,    // alternatenames
        parseFloat(parts[4]), // latitude
        parseFloat(parts[5]), // longitude
        parts[6],            // feature class
        parts[7],            // feature code
        parts[8],            // country code
        parts[9] || null,    // cc2
        parts[10] || null,   // admin1 code
        parts[11] || null,   // admin2 code
        parts[12] || null,   // admin3 code
        parts[13] || null,   // admin4 code
        parts[14] ? parseInt(parts[14]) : null,  // population
        parts[15] ? parseInt(parts[15]) : null,  // elevation
        parts[16] ? parseInt(parts[16]) : null,  // dem
        parts[17] || null,   // timezone
        parts[18] || null,   // modification date
      ]);

      imported++;
      if (imported % 10000 === 0) {
        console.log(`  Progress: ${imported}/${lines.length} (${Math.round(imported/lines.length*100)}%)`);
      }
    }

    await client.query('COMMIT');
    console.log(`✓ Imported ${imported} cities`);

    // Check if any records were imported
    if (imported === 0) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            records_imported = 0,
            error_message = 'No cities found in cities1000.txt. File may be empty or corrupted.'
        WHERE id = $1
      `, [importId]);
      console.log('⚠️  Import completed but found 0 cities');
    } else {
      // Mark import as completed
      await pool.query(`
        UPDATE imports
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            records_imported = $2
        WHERE id = $1
      `, [importId, imported]);
    }

  } catch (error) {
    await client.query('ROLLBACK');

    // Mark import as failed
    if (importId) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = $2
        WHERE id = $1
      `, [importId, error.message]).catch(e => console.error('Failed to update import status:', e.message));
    }

    throw error;
  } finally {
    client.release();
  }
}

async function importAdmin1Codes(pool) {
  console.log('\n=== Importing Admin1 Codes (States/Provinces) ===');

  const filePath = join(DATA_DIR, 'admin1CodesASCII.txt');
  let importId;

  if (!fs.existsSync(filePath)) {
    console.log('Downloading admin1CodesASCII.txt...');
    await download(GEONAMES_URLS.admin1, filePath);
    console.log('✓ Downloaded');
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  console.log(`Found ${lines.length} admin1 codes`);
  console.log('Importing into PostgreSQL...');

  // Start import tracking
  const importResult = await pool.query(`
    INSERT INTO imports (
      import_type, source_file, source_url, metadata, status
    ) VALUES ($1, $2, $3, $4, 'running')
    RETURNING id
  `, ['geonames_admin1', 'admin1CodesASCII.txt', GEONAMES_URLS.admin1, null]);

  importId = importResult.rows[0].id;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clear existing data
    await client.query('DELETE FROM geonames_admin1_codes');

    let imported = 0;

    for (const line of lines) {
      // Format: US.NY	New York	New York	5128638
      const parts = line.split('\t');
      if (parts.length < 2) continue;

      const code = parts[0]; // e.g., 'US.NY'
      const name = parts[1];
      const asciiName = parts[2] || parts[1];
      const geonameId = parts[3] ? parseInt(parts[3]) : null;

      // Split code into country and admin1
      const [countryCode, admin1Code] = code.split('.');
      if (!countryCode || !admin1Code) continue;

      await client.query(`
        INSERT INTO geonames_admin1_codes (code, country_code, admin1_code, name, ascii_name, geoname_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          ascii_name = EXCLUDED.ascii_name,
          geoname_id = EXCLUDED.geoname_id
      `, [code, countryCode, admin1Code, name, asciiName, geonameId]);

      imported++;
      if (imported % 500 === 0) {
        console.log(`  Imported ${imported} admin1 codes...`);
      }
    }

    await client.query('COMMIT');
    console.log(`✓ Imported ${imported} admin1 codes`);

    // Check if any records were imported
    if (imported === 0) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            records_imported = 0,
            error_message = 'No admin1 codes found in admin1CodesASCII.txt. File may be empty or corrupted.'
        WHERE id = $1
      `, [importId]);
      console.log('⚠️  Import completed but found 0 admin1 codes');
    } else {
      // Update import status
      await pool.query(`
        UPDATE imports
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            records_imported = $2
        WHERE id = $1
      `, [importId, imported]);
    }

  } catch (error) {
    await client.query('ROLLBACK');

    if (importId) {
      await pool.query(`
        UPDATE imports
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = $2
        WHERE id = $1
      `, [importId, error.message]).catch(e => console.error('Failed to update import status:', e.message));
    }

    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    console.log('GeoNames Import to PostgreSQL');
    console.log('==============================');

    // Clean up stale imports (running > 24 hours)
    await cleanupStaleImports(pool);

    await importCountries(pool);
    await importCities(pool);
    await importAdmin1Codes(pool);

    // Show statistics
    console.log('\n=== Database Statistics ===');
    const countriesCount = await pool.query('SELECT COUNT(*) FROM geonames_countries');
    const citiesCount = await pool.query('SELECT COUNT(*) FROM geonames_cities');
    const admin1Count = await pool.query('SELECT COUNT(*) FROM geonames_admin1_codes');

    console.log(`Countries: ${countriesCount.rows[0].count}`);
    console.log(`Cities: ${citiesCount.rows[0].count}`);
    console.log(`Admin1 Codes (States/Provinces): ${admin1Count.rows[0].count}`);

    console.log('\n✅ GeoNames import complete!');

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main as importGeoNames };
