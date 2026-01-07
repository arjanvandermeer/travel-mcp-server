import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache TTL configuration (in days)
const CACHE_TTL = {
  region_hotels: 30,        // Refresh region every 30 days
  individual_hotel: 90,     // Refresh specific hotel every 90 days
};

export class HotelDatabase {
  constructor(dbPath = null) {
    const defaultPath = join(__dirname, '../data/hotels.db');
    this.db = new Database(dbPath || defaultPath);
    this.initSchema();

    // Track in-progress fetches to prevent duplicate requests
    this.activeFetches = new Map(); // regionHash -> Promise
  }

  initSchema() {
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // GeoNames countries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_countries (
        iso TEXT PRIMARY KEY,
        iso3 TEXT,
        iso_numeric TEXT,
        fips TEXT,
        country TEXT NOT NULL,
        capital TEXT,
        area_sq_km INTEGER,
        population INTEGER,
        continent TEXT,
        tld TEXT,
        currency_code TEXT,
        currency_name TEXT,
        phone TEXT,
        postal_code_format TEXT,
        postal_code_regex TEXT,
        languages TEXT,
        geoname_id INTEGER UNIQUE,
        neighbours TEXT,
        equivalent_fips_code TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_countries_name ON geonames_countries(country COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_countries_iso3 ON geonames_countries(iso3);
      CREATE INDEX IF NOT EXISTS idx_countries_geonameid ON geonames_countries(geoname_id);
    `);

    // GeoNames alternate names table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_alternate_names (
        alternate_name_id INTEGER PRIMARY KEY,
        geoname_id INTEGER NOT NULL,
        iso_language TEXT,
        alternate_name TEXT NOT NULL,
        is_preferred_name INTEGER DEFAULT 0,
        is_short_name INTEGER DEFAULT 0,
        is_colloquial INTEGER DEFAULT 0,
        is_historic INTEGER DEFAULT 0,
        from_period TEXT,
        to_period TEXT,
        FOREIGN KEY (geoname_id) REFERENCES geonames_cities(geoname_id)
      );

      CREATE INDEX IF NOT EXISTS idx_altnames_geonameid ON geonames_alternate_names(geoname_id);
      CREATE INDEX IF NOT EXISTS idx_altnames_name ON geonames_alternate_names(alternate_name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_altnames_language ON geonames_alternate_names(iso_language);
    `);

    // GeoNames admin1 codes (states/provinces)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_admin1_codes (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ascii_name TEXT,
        geoname_id INTEGER UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_admin1_name ON geonames_admin1_codes(name COLLATE NOCASE);
    `);

    // GeoNames admin2 codes (counties/districts)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_admin2_codes (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ascii_name TEXT,
        geoname_id INTEGER UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_admin2_name ON geonames_admin2_codes(name COLLATE NOCASE);
    `);

    // GeoNames timezones
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_timezones (
        timezone_id TEXT PRIMARY KEY,
        country_code TEXT,
        gmt_offset REAL,
        dst_offset REAL,
        raw_offset REAL
      );

      CREATE INDEX IF NOT EXISTS idx_timezones_country ON geonames_timezones(country_code);
    `);

    // GeoNames feature codes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_feature_codes (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT
      );
    `);

    // GeoNames hierarchy
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_hierarchy (
        parent_id INTEGER NOT NULL,
        child_id INTEGER NOT NULL,
        type TEXT,
        PRIMARY KEY (parent_id, child_id)
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON geonames_hierarchy(parent_id);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_child ON geonames_hierarchy(child_id);
    `);

    // GeoNames cities table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geonames_cities (
        geoname_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        ascii_name TEXT,
        alternate_names TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        feature_class TEXT,
        feature_code TEXT,
        country_code TEXT,
        admin1_code TEXT,
        admin2_code TEXT,
        population INTEGER,
        elevation INTEGER,
        timezone TEXT,
        modification_date TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_geonames_name ON geonames_cities(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_geonames_coords ON geonames_cities(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_geonames_country ON geonames_cities(country_code);
      CREATE INDEX IF NOT EXISTS idx_geonames_admin1 ON geonames_cities(admin1_code);
    `);

    // OSM Cache Metadata (tracks freshness of cached regions)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS osm_cache_metadata (
        region_hash TEXT PRIMARY KEY,
        region_type TEXT NOT NULL,
        bbox TEXT NOT NULL,
        city_geoname_id INTEGER,
        data_type TEXT NOT NULL,
        expected_count INTEGER,
        actual_count INTEGER,
        is_complete INTEGER DEFAULT 0,
        last_fetched INTEGER NOT NULL,
        cache_ttl_days INTEGER DEFAULT 30,
        FOREIGN KEY (city_geoname_id) REFERENCES geonames_cities(geoname_id)
      );

      CREATE INDEX IF NOT EXISTS idx_osm_cache_metadata_type ON osm_cache_metadata(data_type);
      CREATE INDEX IF NOT EXISTS idx_osm_cache_metadata_city ON osm_cache_metadata(city_geoname_id);
    `);

    // OSM Hotels Cache (populated on-demand from OSM Overpass API)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS osm_cache_hotels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        osm_id TEXT UNIQUE,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        address TEXT,
        city TEXT,
        country_code TEXT,
        phone TEXT,
        website TEXT,
        email TEXT,
        stars INTEGER,
        rooms INTEGER,
        amenities TEXT, -- JSON array of amenities
        created_at INTEGER DEFAULT (unixepoch('now')),
        updated_at INTEGER DEFAULT (unixepoch('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_osm_cache_hotels_name ON osm_cache_hotels(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_osm_cache_hotels_coords ON osm_cache_hotels(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_osm_cache_hotels_city ON osm_cache_hotels(city COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_osm_cache_hotels_country ON osm_cache_hotels(country_code);
      CREATE INDEX IF NOT EXISTS idx_osm_cache_hotels_updated ON osm_cache_hotels(updated_at);
    `);

    // Hotel amenities lookup table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS amenities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        category TEXT
      );
      
      INSERT OR IGNORE INTO amenities (name, category) VALUES
        ('wifi', 'internet'),
        ('parking', 'parking'),
        ('pool', 'recreation'),
        ('gym', 'recreation'),
        ('restaurant', 'dining'),
        ('bar', 'dining'),
        ('spa', 'recreation'),
        ('air_conditioning', 'comfort'),
        ('pet_friendly', 'policies'),
        ('wheelchair_accessible', 'accessibility'),
        ('breakfast', 'dining'),
        ('room_service', 'services'),
        ('airport_shuttle', 'transport'),
        ('business_center', 'business'),
        ('conference_room', 'business');
    `);

    // Database schema initialized silently for MCP compatibility
  }

  // GeoNames Countries methods
  insertGeonamesCountry(country) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_countries (
        iso, iso3, iso_numeric, fips, country, capital, area_sq_km, population,
        continent, tld, currency_code, currency_name, phone, postal_code_format,
        postal_code_regex, languages, geoname_id, neighbours, equivalent_fips_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      country.iso,
      country.iso3,
      country.iso_numeric,
      country.fips,
      country.country,
      country.capital,
      country.area_sq_km,
      country.population,
      country.continent,
      country.tld,
      country.currency_code,
      country.currency_name,
      country.phone,
      country.postal_code_format,
      country.postal_code_regex,
      country.languages,
      country.geoname_id,
      country.neighbours,
      country.equivalent_fips_code
    );
  }

  bulkInsertGeonamesCountries(countries) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_countries (
        iso, iso3, iso_numeric, fips, country, capital, area_sq_km, population,
        continent, tld, currency_code, currency_name, phone, postal_code_format,
        postal_code_regex, languages, geoname_id, neighbours, equivalent_fips_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((countries) => {
      for (const country of countries) {
        insert.run(
          country.iso,
          country.iso3,
          country.iso_numeric,
          country.fips,
          country.country,
          country.capital,
          country.area_sq_km,
          country.population,
          country.continent,
          country.tld,
          country.currency_code,
          country.currency_name,
          country.phone,
          country.postal_code_format,
          country.postal_code_regex,
          country.languages,
          country.geoname_id,
          country.neighbours,
          country.equivalent_fips_code
        );
      }
    });

    insertMany(countries);
  }

  searchCountries(query, limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM geonames_countries
      WHERE country LIKE ? OR iso LIKE ? OR iso3 LIKE ?
      ORDER BY population DESC NULLS LAST
      LIMIT ?
    `);

    const searchTerm = `%${query}%`;
    return stmt.all(searchTerm, searchTerm, searchTerm, limit);
  }

  getCountryByISO(iso) {
    const stmt = this.db.prepare('SELECT * FROM geonames_countries WHERE iso = ? OR iso3 = ?');
    return stmt.get(iso.toUpperCase(), iso.toUpperCase());
  }

  getCountryByGeonameId(geonameId) {
    const stmt = this.db.prepare('SELECT * FROM geonames_countries WHERE geoname_id = ?');
    return stmt.get(geonameId);
  }

  getAllCountries() {
    const stmt = this.db.prepare('SELECT * FROM geonames_countries ORDER BY country');
    return stmt.all();
  }

  // GeoNames Alternate Names methods
  bulkInsertAlternateNames(alternateNames) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_alternate_names (
        alternate_name_id, geoname_id, iso_language, alternate_name,
        is_preferred_name, is_short_name, is_colloquial, is_historic,
        from_period, to_period
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((names) => {
      for (const name of names) {
        insert.run(
          name.alternate_name_id,
          name.geoname_id,
          name.iso_language,
          name.alternate_name,
          name.is_preferred_name,
          name.is_short_name,
          name.is_colloquial,
          name.is_historic,
          name.from_period,
          name.to_period
        );
      }
    });

    insertMany(alternateNames);
  }

  getAlternateNamesByGeonameId(geonameId) {
    const stmt = this.db.prepare('SELECT * FROM geonames_alternate_names WHERE geoname_id = ?');
    return stmt.all(geonameId);
  }

  searchByAlternateName(query, limit = 10) {
    const stmt = this.db.prepare(`
      SELECT DISTINCT c.*, a.alternate_name as matched_name, a.iso_language
      FROM geonames_cities c
      JOIN geonames_alternate_names a ON c.geoname_id = a.geoname_id
      WHERE a.alternate_name LIKE ?
      ORDER BY c.population DESC NULLS LAST
      LIMIT ?
    `);
    return stmt.all(`%${query}%`, limit);
  }

  // GeoNames Admin Codes methods
  bulkInsertAdmin1Codes(codes) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_admin1_codes (code, name, ascii_name, geoname_id)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((codes) => {
      for (const code of codes) {
        insert.run(code.code, code.name, code.ascii_name, code.geoname_id);
      }
    });

    insertMany(codes);
  }

  bulkInsertAdmin2Codes(codes) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_admin2_codes (code, name, ascii_name, geoname_id)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((codes) => {
      for (const code of codes) {
        insert.run(code.code, code.name, code.ascii_name, code.geoname_id);
      }
    });

    insertMany(codes);
  }

  getAdmin1ByCode(code) {
    const stmt = this.db.prepare('SELECT * FROM geonames_admin1_codes WHERE code = ?');
    return stmt.get(code);
  }

  getAdmin2ByCode(code) {
    const stmt = this.db.prepare('SELECT * FROM geonames_admin2_codes WHERE code = ?');
    return stmt.get(code);
  }

  searchAdmin1(query, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM geonames_admin1_codes
      WHERE name LIKE ? OR ascii_name LIKE ?
      LIMIT ?
    `);
    return stmt.all(`%${query}%`, `%${query}%`, limit);
  }

  // GeoNames Timezone methods
  bulkInsertTimezones(timezones) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_timezones (
        timezone_id, country_code, gmt_offset, dst_offset, raw_offset
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((zones) => {
      for (const zone of zones) {
        insert.run(
          zone.timezone_id,
          zone.country_code,
          zone.gmt_offset,
          zone.dst_offset,
          zone.raw_offset
        );
      }
    });

    insertMany(timezones);
  }

  getTimezoneById(timezoneId) {
    const stmt = this.db.prepare('SELECT * FROM geonames_timezones WHERE timezone_id = ?');
    return stmt.get(timezoneId);
  }

  getTimezonesByCountry(countryCode) {
    const stmt = this.db.prepare('SELECT * FROM geonames_timezones WHERE country_code = ?');
    return stmt.all(countryCode);
  }

  // GeoNames Feature Codes methods
  bulkInsertFeatureCodes(codes) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_feature_codes (code, name, description)
      VALUES (?, ?, ?)
    `);

    const insertMany = this.db.transaction((codes) => {
      for (const code of codes) {
        insert.run(code.code, code.name, code.description);
      }
    });

    insertMany(codes);
  }

  getFeatureCodeDescription(code) {
    const stmt = this.db.prepare('SELECT * FROM geonames_feature_codes WHERE code = ?');
    return stmt.get(code);
  }

  // GeoNames Hierarchy methods
  bulkInsertHierarchy(relations) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_hierarchy (parent_id, child_id, type)
      VALUES (?, ?, ?)
    `);

    const insertMany = this.db.transaction((relations) => {
      for (const rel of relations) {
        insert.run(rel.parent_id, rel.child_id, rel.type);
      }
    });

    insertMany(relations);
  }

  getChildrenOf(geonameId) {
    const stmt = this.db.prepare(`
      SELECT c.*, h.type as relationship_type
      FROM geonames_hierarchy h
      JOIN geonames_cities c ON h.child_id = c.geoname_id
      WHERE h.parent_id = ?
    `);
    return stmt.all(geonameId);
  }

  getParentsOf(geonameId) {
    const stmt = this.db.prepare(`
      SELECT c.*, h.type as relationship_type
      FROM geonames_hierarchy h
      JOIN geonames_cities c ON h.parent_id = c.geoname_id
      WHERE h.child_id = ?
    `);
    return stmt.all(geonameId);
  }

  // GeoNames Cities methods
  insertGeonamesCity(city) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_cities (
        geoname_id, name, ascii_name, alternate_names, latitude, longitude,
        feature_class, feature_code, country_code, admin1_code, admin2_code,
        population, elevation, timezone, modification_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      city.geoname_id,
      city.name,
      city.ascii_name,
      city.alternate_names,
      city.latitude,
      city.longitude,
      city.feature_class,
      city.feature_code,
      city.country_code,
      city.admin1_code,
      city.admin2_code,
      city.population,
      city.elevation,
      city.timezone,
      city.modification_date
    );
  }

  bulkInsertGeonamesCities(cities) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO geonames_cities (
        geoname_id, name, ascii_name, alternate_names, latitude, longitude,
        feature_class, feature_code, country_code, admin1_code, admin2_code,
        population, elevation, timezone, modification_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((cities) => {
      for (const city of cities) {
        insert.run(
          city.geoname_id,
          city.name,
          city.ascii_name,
          city.alternate_names,
          city.latitude,
          city.longitude,
          city.feature_class,
          city.feature_code,
          city.country_code,
          city.admin1_code,
          city.admin2_code,
          city.population,
          city.elevation,
          city.timezone,
          city.modification_date
        );
      }
    });

    insertMany(cities);
  }

  searchCities(query, limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM geonames_cities 
      WHERE name LIKE ? OR ascii_name LIKE ? OR alternate_names LIKE ?
      ORDER BY population DESC NULLS LAST
      LIMIT ?
    `);
    
    const searchTerm = `%${query}%`;
    return stmt.all(searchTerm, searchTerm, searchTerm, limit);
  }

  getCityByGeonameId(geonameId) {
    const stmt = this.db.prepare('SELECT * FROM geonames_cities WHERE geoname_id = ?');
    return stmt.get(geonameId);
  }

  getCitiesNearCoordinates(lat, lon, radiusKm = 50, limit = 20) {
    // Simple bounding box search (for more accuracy, we'd need PostGIS or similar)
    const latDelta = radiusKm / 111; // ~111km per degree latitude
    const lonDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

    const stmt = this.db.prepare(`
      SELECT *,
        (
          6371 * acos(
            cos(radians(?)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(latitude))
          )
        ) as distance_km
      FROM geonames_cities
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      ORDER BY distance_km
      LIMIT ?
    `);

    return stmt.all(
      lat, lon, lat,
      lat - latDelta, lat + latDelta,
      lon - lonDelta, lon + lonDelta,
      limit
    );
  }

  /**
   * Check if a point is inside a polygon using ray casting algorithm
   * @param {number} lat - Latitude of the point
   * @param {number} lon - Longitude of the point
   * @param {Array<Array<number>>} polygon - Array of [lat, lon] coordinates defining polygon vertices
   * @returns {boolean}
   */
  isPointInPolygon(lat, lon, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [lat1, lon1] = polygon[i];
      const [lat2, lon2] = polygon[j];

      const intersect = ((lon1 > lon) !== (lon2 > lon)) &&
        (lat < (lat2 - lat1) * (lon - lon1) / (lon2 - lon1) + lat1);

      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Find cities within a polygon
   * @param {Array<Array<number>>} polygon - Array of [lat, lon] coordinates
   * @param {number} limit - Maximum number of results
   * @returns {Array} Cities within the polygon
   */
  getCitiesInPolygon(polygon, limit = 100) {
    // Calculate bounding box for initial filter
    const lats = polygon.map(p => p[0]);
    const lons = polygon.map(p => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Get all cities in bounding box
    const stmt = this.db.prepare(`
      SELECT *
      FROM geonames_cities
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `);

    const candidates = stmt.all(minLat, maxLat, minLon, maxLon);

    // Filter to only cities actually inside polygon
    const citiesInPolygon = candidates.filter(city =>
      this.isPointInPolygon(city.latitude, city.longitude, polygon)
    );

    // Sort by population and limit
    return citiesInPolygon
      .sort((a, b) => (b.population || 0) - (a.population || 0))
      .slice(0, limit);
  }

  // OSM Cache Metadata methods

  /**
   * Calculate hash for a bounding box
   */
  calculateBboxHash(south, west, north, east) {
    const bboxString = `${south},${west},${north},${east}`;
    return crypto.createHash('md5').update(bboxString).digest('hex');
  }

  /**
   * Get cache metadata for a region
   */
  getCacheMetadata(regionHash, dataType = 'hotels') {
    const stmt = this.db.prepare(`
      SELECT * FROM osm_cache_metadata
      WHERE region_hash = ? AND data_type = ?
    `);
    return stmt.get(regionHash, dataType);
  }

  /**
   * Check if cache is fresh (not stale)
   */
  isCacheFresh(metadata) {
    if (!metadata) return false;
    const now = Math.floor(Date.now() / 1000);
    const ageInDays = (now - metadata.last_fetched) / 86400;
    return ageInDays < metadata.cache_ttl_days;
  }

  /**
   * Insert or update cache metadata
   */
  upsertCacheMetadata(metadata) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO osm_cache_metadata (
        region_hash, region_type, bbox, city_geoname_id, data_type,
        expected_count, actual_count, is_complete, last_fetched, cache_ttl_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      metadata.region_hash,
      metadata.region_type,
      metadata.bbox,
      metadata.city_geoname_id || null,
      metadata.data_type,
      metadata.expected_count || null,
      metadata.actual_count || 0,
      metadata.is_complete || 0,
      metadata.last_fetched,
      metadata.cache_ttl_days || CACHE_TTL.region_hotels
    );
  }

  // OSM Hotel Cache methods
  insertHotel(hotel) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO osm_cache_hotels (
        osm_id, name, latitude, longitude, address, city, country_code,
        phone, website, email, stars, rooms, amenities
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      hotel.osm_id,
      hotel.name,
      hotel.latitude,
      hotel.longitude,
      hotel.address,
      hotel.city,
      hotel.country_code,
      hotel.phone,
      hotel.website,
      hotel.email,
      hotel.stars,
      hotel.rooms,
      JSON.stringify(hotel.amenities || [])
    );
  }

  searchHotels(query, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM osm_cache_hotels
      WHERE name LIKE ? OR city LIKE ? OR address LIKE ?
      LIMIT ?
    `);

    const searchTerm = `%${query}%`;
    return stmt.all(searchTerm, searchTerm, searchTerm, limit);
  }

  async getHotelsNearCoordinates(lat, lon, radiusKm = 10, limit = 50) {
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

    // Calculate bounding box
    const south = lat - latDelta;
    const north = lat + latDelta;
    const west = lon - lonDelta;
    const east = lon + lonDelta;

    // Check cache metadata
    const regionHash = this.calculateBboxHash(south, west, north, east);
    const metadata = this.getCacheMetadata(regionHash, 'hotels');

    // If cache is missing or stale, trigger background refresh
    if (!metadata || !this.isCacheFresh(metadata)) {
      // Check if there's already an active fetch for this region
      if (!this.activeFetches.has(regionHash)) {
        // Start new fetch and track it
        const fetchPromise = this.refreshRegionCache(south, west, north, east, regionHash)
          .catch(err => {
            console.error(`Background refresh failed for region ${regionHash}:`, err.message);
          })
          .finally(() => {
            // Remove from active fetches when done
            this.activeFetches.delete(regionHash);
          });

        this.activeFetches.set(regionHash, fetchPromise);

        console.log(`Started background fetch for region ${regionHash}`);
      } else {
        console.log(`Fetch already in progress for region ${regionHash}, skipping duplicate`);
      }

      // If no metadata at all, return empty (first call)
      if (!metadata) {
        return [];
      }
      // If stale, return stale data while refreshing in background
      console.log(`Returning stale data while refreshing region ${regionHash}`);
    }

    // Query cached hotels
    const stmt = this.db.prepare(`
      SELECT *,
        (
          6371 * acos(
            cos(radians(?)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(latitude))
          )
        ) as distance_km
      FROM osm_cache_hotels
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      ORDER BY distance_km
      LIMIT ?
    `);

    return stmt.all(
      lat, lon, lat,
      south, north,
      west, east,
      limit
    );
  }

  /**
   * Refresh region cache in background
   * For large regions, splits into tiles to avoid OSM API timeouts
   */
  async refreshRegionCache(south, west, north, east, regionHash) {
    const { queryHotelCount, fetchHotels, parseOSMElement, splitBoundingBox } = await import('./osm-api.js');

    console.log(`Fetching hotel count for region ${regionHash}...`);
    const expectedCount = await queryHotelCount(south, west, north, east);

    if (expectedCount === null) {
      console.error('Failed to query hotel count');
      return;
    }

    console.log(`Expecting ${expectedCount} hotels in region`);

    // Determine if we need to split the region
    const latSpan = north - south;
    const lonSpan = east - west;
    const areaSize = latSpan * lonSpan;

    // Split if region is large or has many hotels
    const shouldSplit = areaSize > 0.04 || expectedCount > 200;
    const tiles = shouldSplit
      ? splitBoundingBox(south, west, north, east, 4)
      : [{ south, west, north, east }];

    if (tiles.length > 1) {
      console.log(`Splitting into ${tiles.length} tiles to avoid API timeout`);
    }

    let imported = 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      console.log(`Fetching tile ${i + 1}/${tiles.length}...`);

      const elements = await fetchHotels(tile.south, tile.west, tile.north, tile.east);

      for (const element of elements) {
        const hotel = parseOSMElement(element);
        if (hotel) {
          try {
            this.insertHotel(hotel);
            imported++;
          } catch (error) {
            // Skip duplicates or errors
          }
        }
      }
    }

    // Update metadata
    const now = Math.floor(Date.now() / 1000);
    this.upsertCacheMetadata({
      region_hash: regionHash,
      region_type: 'coordinates',
      bbox: JSON.stringify({ south, west, north, east }),
      data_type: 'hotels',
      expected_count: expectedCount,
      actual_count: imported,
      is_complete: imported >= expectedCount ? 1 : 0,
      last_fetched: now,
      cache_ttl_days: CACHE_TTL.region_hotels,
    });

    console.log(`✓ Refreshed region ${regionHash}: ${imported}/${expectedCount} hotels`);
  }

  async getHotelByOsmId(osmId) {
    const stmt = this.db.prepare('SELECT * FROM osm_cache_hotels WHERE osm_id = ?');
    const hotel = stmt.get(osmId);

    // If hotel exists, check if it's stale
    if (hotel) {
      const now = Math.floor(Date.now() / 1000);
      const ageInDays = (now - hotel.updated_at) / 86400;

      // If older than individual hotel TTL, trigger background refresh
      if (ageInDays > CACHE_TTL.individual_hotel) {
        console.log(`Hotel ${osmId} is stale (${Math.floor(ageInDays)} days old), refreshing in background`);
        this.refreshIndividualHotel(osmId).catch(err => {
          console.error(`Failed to refresh hotel ${osmId}:`, err.message);
        });
      }
    }

    return hotel;
  }

  /**
   * Refresh individual hotel data from OSM
   */
  async refreshIndividualHotel(osmId) {
    const { fetchHotelById } = await import('./osm-api.js');

    console.log(`Fetching updated data for hotel ${osmId}...`);
    const hotelData = await fetchHotelById(osmId);

    if (hotelData) {
      // Update the hotel with fresh data
      this.insertHotel(hotelData);
      console.log(`✓ Refreshed hotel ${osmId}`);
    } else {
      console.error(`Failed to fetch hotel ${osmId} from OSM`);
    }
  }

  getHotelsInPolygon(polygon, limit = 100) {
    // Calculate bounding box for initial filter
    const lats = polygon.map(p => p[0]);
    const lons = polygon.map(p => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Get all hotels in bounding box
    const stmt = this.db.prepare(`
      SELECT * FROM osm_cache_hotels
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `);

    const candidates = stmt.all(minLat, maxLat, minLon, maxLon);

    // Filter to only hotels actually inside polygon
    const hotelsInPolygon = candidates.filter(hotel =>
      this.isPointInPolygon(hotel.latitude, hotel.longitude, polygon)
    );

    // Limit results
    return hotelsInPolygon.slice(0, limit);
  }

  // Stats
  getStats() {
    const countriesCount = this.db.prepare('SELECT COUNT(*) as count FROM geonames_countries').get();
    const citiesCount = this.db.prepare('SELECT COUNT(*) as count FROM geonames_cities').get();
    const hotelsCount = this.db.prepare('SELECT COUNT(*) as count FROM osm_cache_hotels').get();
    const alternateNamesCount = this.db.prepare('SELECT COUNT(*) as count FROM geonames_alternate_names').get();
    const admin1Count = this.db.prepare('SELECT COUNT(*) as count FROM geonames_admin1_codes').get();
    const admin2Count = this.db.prepare('SELECT COUNT(*) as count FROM geonames_admin2_codes').get();
    const timezonesCount = this.db.prepare('SELECT COUNT(*) as count FROM geonames_timezones').get();
    const featureCodesCount = this.db.prepare('SELECT COUNT(*) as count FROM geonames_feature_codes').get();
    const hierarchyCount = this.db.prepare('SELECT COUNT(*) as count FROM geonames_hierarchy').get();

    return {
      countries: countriesCount.count,
      cities: citiesCount.count,
      hotels: hotelsCount.count,
      alternate_names: alternateNamesCount.count,
      admin1_codes: admin1Count.count,
      admin2_codes: admin2Count.count,
      timezones: timezonesCount.count,
      feature_codes: featureCodesCount.count,
      hierarchy_relations: hierarchyCount.count
    };
  }

  close() {
    this.db.close();
  }
}

export default HotelDatabase;
