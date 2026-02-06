/**
 * Sample Test Data Fixtures
 *
 * This module provides consistent test data for unit and integration tests.
 * Use these fixtures to ensure tests are deterministic and readable.
 */

// =============================================================================
// CITIES
// =============================================================================

export const cities = {
  bangkok: {
    id: 1,
    name: 'Bangkok',
    ascii_name: 'Bangkok',
    country_code: 'TH',
    admin1_code: '10',
    population: 8280925,
    latitude: 13.7563,
    longitude: 100.5018,
    timezone: 'Asia/Bangkok',
  },
  chiangMai: {
    id: 2,
    name: 'Chiang Mai',
    ascii_name: 'Chiang Mai',
    country_code: 'TH',
    admin1_code: '50',
    population: 127240,
    latitude: 18.7883,
    longitude: 98.9853,
    timezone: 'Asia/Bangkok',
  },
  tokyo: {
    id: 3,
    name: 'Tokyo',
    ascii_name: 'Tokyo',
    country_code: 'JP',
    admin1_code: '40',
    population: 13960000,
    latitude: 35.6762,
    longitude: 139.6503,
    timezone: 'Asia/Tokyo',
  },
  paris: {
    id: 4,
    name: 'Paris',
    ascii_name: 'Paris',
    country_code: 'FR',
    admin1_code: '11',
    population: 2161000,
    latitude: 48.8566,
    longitude: 2.3522,
    timezone: 'Europe/Paris',
  },
};

export const citiesArray = Object.values(cities);

// =============================================================================
// COUNTRIES
// =============================================================================

export const countries = {
  thailand: {
    iso: 'TH',
    iso3: 'THA',
    name: 'Thailand',
    capital: 'Bangkok',
    population: 69950850,
    area: 513120,
    continent: 'AS',
    currency_code: 'THB',
    languages: 'th',
  },
  japan: {
    iso: 'JP',
    iso3: 'JPN',
    name: 'Japan',
    capital: 'Tokyo',
    population: 126476461,
    area: 377930,
    continent: 'AS',
    currency_code: 'JPY',
    languages: 'ja',
  },
  france: {
    iso: 'FR',
    iso3: 'FRA',
    name: 'France',
    capital: 'Paris',
    population: 67390000,
    area: 643801,
    continent: 'EU',
    currency_code: 'EUR',
    languages: 'fr-FR',
  },
};

export const countriesArray = Object.values(countries);

// =============================================================================
// POIS (Hotels, Restaurants, etc.)
// =============================================================================

export const hotels = {
  grandPalace: {
    osm_id: 'n12345678',
    osm_type: 'node',
    poi_type: 'hotel',
    name: 'Grand Palace Hotel',
    latitude: 13.7500,
    longitude: 100.4913,
    address: '123 Charoen Krung Road, Bangkok',
    phone: '+66 2 123 4567',
    email: 'info@grandpalace.th',
    website: 'https://grandpalace.th',
    stars: 5,
    rooms: 200,
    source_region: 'thailand',
  },
  sukhumvitInn: {
    osm_id: 'n23456789',
    osm_type: 'node',
    poi_type: 'hotel',
    name: 'Sukhumvit Inn',
    latitude: 13.7400,
    longitude: 100.5600,
    address: '456 Sukhumvit Road, Bangkok',
    phone: '+66 2 234 5678',
    stars: 3,
    rooms: 50,
    source_region: 'thailand',
  },
  tokyoRyokan: {
    osm_id: 'n34567890',
    osm_type: 'node',
    poi_type: 'hotel',
    name: 'Traditional Tokyo Ryokan',
    latitude: 35.6800,
    longitude: 139.7600,
    address: '1-2-3 Asakusa, Tokyo',
    stars: 4,
    rooms: 20,
    source_region: 'japan',
  },
};

export const restaurants = {
  thaiKitchen: {
    osm_id: 'n45678901',
    osm_type: 'node',
    poi_type: 'restaurant',
    name: 'Thai Kitchen',
    latitude: 13.7450,
    longitude: 100.5300,
    address: '789 Silom Road, Bangkok',
    cuisine: 'thai',
    opening_hours: 'Mo-Su 10:00-22:00',
    source_region: 'thailand',
  },
  sushiMaster: {
    osm_id: 'n56789012',
    osm_type: 'node',
    poi_type: 'restaurant',
    name: 'Sushi Master',
    latitude: 35.6750,
    longitude: 139.7500,
    address: '4-5-6 Ginza, Tokyo',
    cuisine: 'japanese;sushi',
    opening_hours: 'Mo-Sa 11:00-21:00',
    source_region: 'japan',
  },
};

export const attractions = {
  grandPalaceTemple: {
    osm_id: 'w12345678',
    osm_type: 'way',
    poi_type: 'attraction',
    name: 'Grand Palace',
    latitude: 13.7500,
    longitude: 100.4914,
    address: 'Na Phra Lan Road, Bangkok',
    website: 'https://www.royalgrandpalace.th',
    source_region: 'thailand',
  },
  eiffelTower: {
    osm_id: 'w23456789',
    osm_type: 'way',
    poi_type: 'attraction',
    name: 'Eiffel Tower',
    latitude: 48.8584,
    longitude: 2.2945,
    address: 'Champ de Mars, Paris',
    website: 'https://www.toureiffel.paris',
    source_region: 'france',
  },
};

export const allPOIs = [...Object.values(hotels), ...Object.values(restaurants), ...Object.values(attractions)];

// =============================================================================
// IMPORT SOURCES
// =============================================================================

export const importSources = {
  thailand: {
    id: 1,
    keyword: 'thailand',
    source_url: 'https://download.geofabrik.de/asia/thailand-latest.osm.pbf',
    display_name: 'Thailand',
    min_pois: 100,
    refresh_interval_days: 30,
    enabled: true,
    last_imported_at: new Date('2024-01-15T10:00:00Z'),
  },
  japan: {
    id: 2,
    keyword: 'japan',
    source_url: 'https://download.geofabrik.de/asia/japan-latest.osm.pbf',
    display_name: 'Japan',
    min_pois: 1000,
    refresh_interval_days: 30,
    enabled: true,
    last_imported_at: null, // Never imported
  },
  france: {
    id: 3,
    keyword: 'france',
    source_url: 'https://download.geofabrik.de/europe/france-latest.osm.pbf',
    display_name: 'France',
    min_pois: 5000,
    refresh_interval_days: 14,
    enabled: true,
    last_imported_at: new Date('2023-12-01T10:00:00Z'), // Stale
  },
  antarctica: {
    id: 4,
    keyword: 'antarctica',
    source_url: 'https://download.geofabrik.de/antarctica-latest.osm.pbf',
    display_name: 'Antarctica',
    min_pois: 10,
    refresh_interval_days: 90,
    enabled: false, // Disabled
    last_imported_at: null,
  },
};

export const importSourcesArray = Object.values(importSources);

// =============================================================================
// IMPORT LOG
// =============================================================================

export const importLogs = {
  completed: {
    id: 1,
    import_type: 'osm_all',
    source_file: 'thailand-latest.osm.pbf',
    source_url: 'https://download.geofabrik.de/asia/thailand-latest.osm.pbf',
    source_date: new Date('2024-01-15'),
    region_name: 'thailand',
    status: 'completed',
    records_imported: 45000,
    started_at: new Date('2024-01-15T10:00:00Z'),
    completed_at: new Date('2024-01-15T10:30:00Z'),
  },
  running: {
    id: 2,
    import_type: 'osm_all',
    source_file: 'japan-latest.osm.pbf',
    source_url: 'https://download.geofabrik.de/asia/japan-latest.osm.pbf',
    source_date: new Date('2024-01-20'),
    region_name: 'japan',
    status: 'running',
    records_imported: 12000,
    started_at: new Date('2024-01-20T14:00:00Z'),
    completed_at: null,
  },
  failed: {
    id: 3,
    import_type: 'osm_all',
    source_file: 'france-latest.osm.pbf',
    source_url: 'https://download.geofabrik.de/europe/france-latest.osm.pbf',
    source_date: new Date('2024-01-18'),
    region_name: 'france',
    status: 'failed',
    records_imported: 5000,
    error_message: 'Connection timeout after 3600 seconds',
    started_at: new Date('2024-01-18T02:00:00Z'),
    completed_at: new Date('2024-01-18T03:00:00Z'),
  },
  aborted: {
    id: 4,
    import_type: 'osm_all',
    source_file: 'italy-latest.osm.pbf',
    source_url: 'https://download.geofabrik.de/europe/italy-latest.osm.pbf',
    source_date: new Date('2024-01-19'),
    region_name: 'italy',
    status: 'aborted',
    records_imported: 8000,
    error_message: 'Aborted by new import for same region',
    started_at: new Date('2024-01-19T10:00:00Z'),
    completed_at: new Date('2024-01-19T10:15:00Z'),
  },
};

// =============================================================================
// OSM TAG MAPPINGS (for testing POI extraction)
// =============================================================================

export const osmTags = {
  hotel: {
    tourism: 'hotel',
    name: 'Test Hotel',
    stars: '4',
    rooms: '100',
    phone: '+1234567890',
    website: 'https://test.com',
  },
  restaurant: {
    amenity: 'restaurant',
    name: 'Test Restaurant',
    cuisine: 'italian',
    opening_hours: 'Mo-Fr 11:00-22:00',
  },
  cafe: {
    amenity: 'cafe',
    name: 'Test Cafe',
    cuisine: 'coffee',
  },
  museum: {
    tourism: 'museum',
    name: 'Test Museum',
    website: 'https://museum.test',
  },
  noName: {
    tourism: 'hotel',
    // Missing name - should be filtered out
  },
  unknownName: {
    tourism: 'hotel',
    name: 'unknown', // Should be filtered out
  },
  nonPOI: {
    building: 'yes',
    name: 'Some Building',
    // No POI tags - should not match
  },
};

// =============================================================================
// CLI ARGUMENTS (for testing parseArgs functions)
// =============================================================================

export const cliArgs = {
  refreshImports: {
    dryRun: ['--dry-run'],
    maxThree: ['--max=3'],
    regionThailand: ['--region=thailand'],
    forceRegion: ['--region=japan', '--force'],
    listOnly: ['--list'],
    withOptimize: ['--max=2', '--optimize'],
    combined: ['--dry-run', '--max=5', '--region=france'],
    empty: [],
  },
  optimizeDb: {
    full: ['--full'],
    reindex: ['--reindex'],
    tableOnly: ['--table=osm_pois'],
    dryRun: ['--dry-run'],
    combined: ['--full', '--reindex'],
  },
  importOsm: {
    keyword: ['thailand'],
    keywordWithType: ['thailand', 'hotel'],
    filePath: ['/path/to/file.osm.pbf'],
    fileWithType: ['/path/to/file.osm.pbf', 'restaurant'],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a database response object
 * @param {Array} rows - Array of row objects
 * @returns {Object} Database result format
 */
export function dbResult(rows) {
  return {
    rows,
    rowCount: rows.length,
  };
}

/**
 * Create an empty database response
 * @returns {Object} Empty database result
 */
export function emptyResult() {
  return { rows: [], rowCount: 0 };
}

/**
 * Create an INSERT response with returning ID
 * @param {number} id - The returned ID
 * @returns {Object} Database result with ID
 */
export function insertResult(id) {
  return {
    rows: [{ id }],
    rowCount: 1,
  };
}

export default {
  cities,
  citiesArray,
  countries,
  countriesArray,
  hotels,
  restaurants,
  attractions,
  allPOIs,
  importSources,
  importSourcesArray,
  importLogs,
  osmTags,
  cliArgs,
  dbResult,
  emptyResult,
  insertResult,
};
