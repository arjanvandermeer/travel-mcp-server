import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HotelDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');

/**
 * Import timezones from timeZones.txt
 * Format: countryCode, timezoneId, GMT offset, DST offset, rawOffset
 */
async function importTimezones(filePath) {
  const db = new HotelDatabase();
  console.log('Importing timezones...');

  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  for await (const line of rl) {
    if (!line || line.startsWith('#') || line.startsWith('CountryCode')) continue;

    const fields = line.split('\t');
    batch.push({
      country_code: fields[0],
      timezone_id: fields[1],
      gmt_offset: parseFloat(fields[2]) || 0,
      dst_offset: parseFloat(fields[3]) || 0,
      raw_offset: parseFloat(fields[4]) || 0
    });
  }

  if (batch.length > 0) {
    db.bulkInsertTimezones(batch);
  }

  console.log(`✓ Imported ${batch.length} timezones\n`);
  db.close();
}

/**
 * Import admin1 codes
 * Format: code, name, asciiname, geonameId
 */
async function importAdmin1Codes(filePath) {
  const db = new HotelDatabase();
  console.log('Importing admin1 codes (states/provinces)...');

  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  for await (const line of rl) {
    if (!line) continue;

    const fields = line.split('\t');
    batch.push({
      code: fields[0],
      name: fields[1],
      ascii_name: fields[2],
      geoname_id: parseInt(fields[3]) || null
    });
  }

  if (batch.length > 0) {
    db.bulkInsertAdmin1Codes(batch);
  }

  console.log(`✓ Imported ${batch.length} admin1 codes\n`);
  db.close();
}

/**
 * Import admin2 codes
 * Format: code, name, asciiname, geonameId
 */
async function importAdmin2Codes(filePath) {
  const db = new HotelDatabase();
  console.log('Importing admin2 codes (counties/districts)...');

  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  let count = 0;
  const BATCH_SIZE = 5000;

  for await (const line of rl) {
    if (!line) continue;

    const fields = line.split('\t');
    batch.push({
      code: fields[0],
      name: fields[1],
      ascii_name: fields[2],
      geoname_id: parseInt(fields[3]) || null
    });

    if (batch.length >= BATCH_SIZE) {
      db.bulkInsertAdmin2Codes(batch);
      count += batch.length;
      console.log(`  Imported ${count} admin2 codes...`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    db.bulkInsertAdmin2Codes(batch);
    count += batch.length;
  }

  console.log(`✓ Imported ${count} admin2 codes\n`);
  db.close();
}

/**
 * Import feature codes
 * Format: code, name, description (with language variants)
 */
async function importFeatureCodes(filePath) {
  const db = new HotelDatabase();
  console.log('Importing feature codes...');

  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  for await (const line of rl) {
    if (!line) continue;

    const fields = line.split('\t');
    // Format: A.ADM1 or P.PPLC
    const fullCode = fields[0];
    const name = fields[1] || '';
    const description = fields[2] || '';

    batch.push({
      code: fullCode,
      name: name,
      description: description
    });
  }

  if (batch.length > 0) {
    db.bulkInsertFeatureCodes(batch);
  }

  console.log(`✓ Imported ${batch.length} feature codes\n`);
  db.close();
}

/**
 * Import hierarchy data
 * Format: parentId, childId, type
 */
async function importHierarchy(filePath) {
  const db = new HotelDatabase();
  console.log('Importing hierarchy data...');

  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  let count = 0;
  const BATCH_SIZE = 5000;

  for await (const line of rl) {
    if (!line) continue;

    const fields = line.split('\t');
    batch.push({
      parent_id: parseInt(fields[0]),
      child_id: parseInt(fields[1]),
      type: fields[2] || null
    });

    if (batch.length >= BATCH_SIZE) {
      db.bulkInsertHierarchy(batch);
      count += batch.length;
      console.log(`  Imported ${count} hierarchy relations...`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    db.bulkInsertHierarchy(batch);
    count += batch.length;
  }

  console.log(`✓ Imported ${count} hierarchy relations\n`);
  db.close();
}

/**
 * Import alternate names (LARGE FILE - 190MB+)
 * Only imports names for geoname IDs that exist in our cities table
 * Format: alternateNameId, geonameid, isolanguage, alternate name, isPreferredName, isShortName, isColloquial, isHistoric, from, to
 */
async function importAlternateNames(filePath) {
  const db = new HotelDatabase();
  console.log('Importing alternate names (filtered for existing cities only)...');
  console.log('This may take 5-10 minutes...');

  // Get all geoname IDs we care about
  console.log('  Loading existing city IDs...');
  const existingIds = new Set(
    db.db.prepare('SELECT geoname_id FROM geonames_cities').all().map(r => r.geoname_id)
  );
  console.log(`  Found ${existingIds.size} cities to match against`);

  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  let count = 0;
  let skipped = 0;
  let totalLines = 0;
  const BATCH_SIZE = 10000;

  for await (const line of rl) {
    if (!line) continue;
    totalLines++;

    // Progress indicator every million lines
    if (totalLines % 1000000 === 0) {
      console.log(`  Processed ${totalLines / 1000000}M lines... (imported: ${count}, skipped: ${skipped})`);
    }

    try {
      const fields = line.split('\t');
      const geonameId = parseInt(fields[1]);

      // Only import if this geoname ID exists in our cities
      if (!existingIds.has(geonameId)) {
        skipped++;
        continue;
      }

      batch.push({
        alternate_name_id: parseInt(fields[0]),
        geoname_id: geonameId,
        iso_language: fields[2] || null,
        alternate_name: fields[3],
        is_preferred_name: fields[4] === '1' ? 1 : 0,
        is_short_name: fields[5] === '1' ? 1 : 0,
        is_colloquial: fields[6] === '1' ? 1 : 0,
        is_historic: fields[7] === '1' ? 1 : 0,
        from_period: fields[8] || null,
        to_period: fields[9] || null
      });

      if (batch.length >= BATCH_SIZE) {
        db.bulkInsertAlternateNames(batch);
        count += batch.length;
        batch = [];
      }
    } catch (error) {
      // Skip malformed lines
      skipped++;
    }
  }

  if (batch.length > 0) {
    db.bulkInsertAlternateNames(batch);
    count += batch.length;
  }

  console.log(`✓ Imported ${count} alternate names (skipped ${skipped} for non-existing cities)\n`);
  db.close();
}

/**
 * Main import function
 */
async function main() {
  console.log('\n=== GeoNames Extended Data Import ===\n');
  console.log('This will import additional GeoNames datasets:');
  console.log('- Timezones (small, fast)');
  console.log('- Admin codes (moderate)');
  console.log('- Feature codes (small, fast)');
  console.log('- Hierarchy (moderate)');
  console.log('- Alternate names (LARGE - may take 5-10 minutes)\n');

  const files = {
    timezones: join(DATA_DIR, 'timeZones.txt'),
    admin1: join(DATA_DIR, 'admin1CodesASCII.txt'),
    admin2: join(DATA_DIR, 'admin2Codes.txt'),
    featureCodes: join(DATA_DIR, 'featureCodes_en.txt'),
    hierarchy: join(DATA_DIR, 'hierarchy.txt'),
    alternateNames: join(DATA_DIR, 'alternateNamesV2.txt')
  };

  // Check which files are available
  const available = {};
  for (const [key, path] of Object.entries(files)) {
    available[key] = existsSync(path);
  }

  const anyAvailable = Object.values(available).some(v => v);

  if (!anyAvailable) {
    console.log('No extended data files found. To import:');
    console.log('\n1. Download files from http://download.geonames.org/export/dump/');
    console.log('   - timeZones.txt');
    console.log('   - admin1CodesASCII.txt');
    console.log('   - admin2Codes.txt');
    console.log('   - featureCodes_en.txt');
    console.log('   - hierarchy.zip (extract hierarchy.txt)');
    console.log('   - alternateNamesV2.zip (extract alternateNamesV2.txt)');
    console.log(`\n2. Place files in: ${DATA_DIR}`);
    console.log('3. Run: npm run import:extended\n');
    process.exit(1);
  }

  // Import available files
  if (available.timezones) {
    await importTimezones(files.timezones);
  } else {
    console.log('⚠️  timeZones.txt not found, skipping\n');
  }

  if (available.admin1) {
    await importAdmin1Codes(files.admin1);
  } else {
    console.log('⚠️  admin1CodesASCII.txt not found, skipping\n');
  }

  if (available.admin2) {
    await importAdmin2Codes(files.admin2);
  } else {
    console.log('⚠️  admin2Codes.txt not found, skipping\n');
  }

  if (available.featureCodes) {
    await importFeatureCodes(files.featureCodes);
  } else {
    console.log('⚠️  featureCodes_en.txt not found, skipping\n');
  }

  if (available.hierarchy) {
    await importHierarchy(files.hierarchy);
  } else {
    console.log('⚠️  hierarchy.txt not found, skipping\n');
  }

  if (available.alternateNames) {
    await importAlternateNames(files.alternateNames);
  } else {
    console.log('⚠️  alternateNamesV2.txt not found, skipping\n');
  }

  // Show final stats
  const db = new HotelDatabase();
  const stats = db.getStats();
  console.log('=== Final Database Stats ===');
  console.log(`Countries: ${stats.countries}`);
  console.log(`Cities: ${stats.cities}`);
  console.log(`Hotels: ${stats.hotels}`);
  console.log(`Alternate Names: ${stats.alternate_names}`);
  console.log(`Admin1 Codes: ${stats.admin1_codes}`);
  console.log(`Admin2 Codes: ${stats.admin2_codes}`);
  console.log(`Timezones: ${stats.timezones}`);
  console.log(`Feature Codes: ${stats.feature_codes}`);
  console.log(`Hierarchy Relations: ${stats.hierarchy_relations}`);
  db.close();
}

main().catch(console.error);
