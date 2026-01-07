import { createReadStream, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HotelDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../data');
const CITIES_FILE = 'cities15000.txt';
const COUNTRIES_FILE = 'countryInfo.txt';

/**
 * Parse a GeoNames countryInfo line
 * Format: ISO ISO3 ISO-Numeric fips Country Capital Area(sq km) Population Continent tld CurrencyCode CurrencyName Phone PostalCodeFormat PostalCodeRegex Languages geonameid neighbours EquivalentFipsCode
 */
function parseCountryInfoLine(line) {
  const fields = line.split('\t');

  return {
    iso: fields[0],
    iso3: fields[1],
    iso_numeric: fields[2],
    fips: fields[3],
    country: fields[4],
    capital: fields[5],
    area_sq_km: parseInt(fields[6]) || null,
    population: parseInt(fields[7]) || 0,
    continent: fields[8],
    tld: fields[9],
    currency_code: fields[10],
    currency_name: fields[11],
    phone: fields[12],
    postal_code_format: fields[13],
    postal_code_regex: fields[14],
    languages: fields[15],
    geoname_id: parseInt(fields[16]) || null,
    neighbours: fields[17],
    equivalent_fips_code: fields[18]
  };
}

/**
 * Parse a GeoNames cities line
 * Format documentation: http://download.geonames.org/export/dump/readme.txt
 */
function parseGeonamesLine(line) {
  const fields = line.split('\t');
  
  return {
    geoname_id: parseInt(fields[0]),
    name: fields[1],
    ascii_name: fields[2],
    alternate_names: fields[3],
    latitude: parseFloat(fields[4]),
    longitude: parseFloat(fields[5]),
    feature_class: fields[6],
    feature_code: fields[7],
    country_code: fields[8],
    admin1_code: fields[10],
    admin2_code: fields[11],
    population: parseInt(fields[14]) || 0,
    elevation: parseInt(fields[15]) || null,
    timezone: fields[17],
    modification_date: fields[18]
  };
}

/**
 * Import GeoNames country data into the database
 */
async function importCountries(filePath) {
  const db = new HotelDatabase();

  console.log(`Importing GeoNames country data from ${filePath}...`);

  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  let batch = [];

  for await (const line of rl) {
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) continue;

    try {
      const country = parseCountryInfoLine(line);
      batch.push(country);
      count++;
    } catch (error) {
      console.error(`Error parsing line: ${error.message}`);
    }
  }

  // Insert all countries at once
  if (batch.length > 0) {
    db.bulkInsertGeonamesCountries(batch);
  }

  console.log(`Import complete! Imported ${count} countries.\n`);

  db.close();
}

/**
 * Import GeoNames cities data into the database
 */
async function importCities(filePath) {
  const db = new HotelDatabase();
  
  console.log(`Importing GeoNames data from ${filePath}...`);
  
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  let batch = [];
  const BATCH_SIZE = 1000;

  for await (const line of rl) {
    if (!line || line.startsWith('#')) continue;
    
    try {
      const city = parseGeonamesLine(line);
      batch.push(city);
      
      if (batch.length >= BATCH_SIZE) {
        db.bulkInsertGeonamesCities(batch);
        count += batch.length;
        console.log(`Imported ${count} cities...`);
        batch = [];
      }
    } catch (error) {
      console.error(`Error parsing line: ${error.message}`);
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    db.bulkInsertGeonamesCities(batch);
    count += batch.length;
  }

  console.log(`\nImport complete! Imported ${count} cities.`);
  
  const stats = db.getStats();
  console.log('\nDatabase stats:', stats);
  
  db.close();
}

/**
 * Main import function
 */
async function main() {
  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log('\n=== GeoNames Data Import ===\n');

  const countriesFile = join(DATA_DIR, COUNTRIES_FILE);
  const citiesFile = join(DATA_DIR, CITIES_FILE);

  let hasCountries = existsSync(countriesFile);
  let hasCities = existsSync(citiesFile);

  if (!hasCountries && !hasCities) {
    console.log('To import GeoNames data, please download:');
    console.log('1. Countries: http://download.geonames.org/export/dump/countryInfo.txt');
    console.log('2. Cities: http://download.geonames.org/export/dump/cities15000.zip');
    console.log('   Extract cities15000.txt from the zip file');
    console.log(`3. Place both files in: ${DATA_DIR}`);
    console.log('4. Run this script again: npm run import\n');
    console.log('Alternative cities datasets: cities1000.txt or cities5000.txt for smaller DB.\n');
    process.exit(1);
  }

  // Import countries first (if available)
  if (hasCountries) {
    await importCountries(countriesFile);
  } else {
    console.log('⚠️  countryInfo.txt not found, skipping countries import');
    console.log(`   Download from: http://download.geonames.org/export/dump/countryInfo.txt\n`);
  }

  // Import cities (if available)
  if (hasCities) {
    await importCities(citiesFile);
  } else {
    console.log('⚠️  cities15000.txt not found, skipping cities import');
    console.log(`   Download from: http://download.geonames.org/export/dump/cities15000.zip\n`);
  }

  // Show final stats
  const db = new HotelDatabase();
  const stats = db.getStats();
  console.log('=== Final Database Stats ===');
  console.log(`Countries: ${stats.countries}`);
  console.log(`Cities: ${stats.cities}`);
  console.log(`Hotels: ${stats.hotels}`);
  db.close();
}

main().catch(console.error);