import pg from 'pg';
import { GooglePlacesClient } from './google-places.js';
import * as telemetry from './telemetry.js';
import dotenv from 'dotenv';
import { CONFIG_CACHE_TTL_MS, DB_STATEMENT_TIMEOUT_MS, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, HOMEPAGE_CACHE_MAX_SIZE, HOMEPAGE_CACHE_TTL_MS, COUNTRIES_CACHE_TTL_MS, EARTH_RADIUS_METERS, GOOGLE_PLACES_DAILY_LIMIT_DEFAULT } from './config.js';

// Load environment variables (using dotenv 16.x to avoid verbose output that breaks MCP)
dotenv.config();

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL environment variable is required in production');
}
const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://<user>:<password>@localhost:5432/travel';

const IMPORT_SOURCE_COUNTRY_CODES = {
  thailand: ['TH'],
  vietnam: ['VN'],
  cambodia: ['KH'],
  laos: ['LA'],
  myanmar: ['MM'],
  'malaysia-singapore-brunei': ['MY', 'SG', 'BN'],
  indonesia: ['ID'],
  philippines: ['PH'],
  japan: ['JP'],
  'south-korea': ['KR'],
  china: ['CN'],
  india: ['IN'],
  nepal: ['NP'],
  taiwan: ['TW'],
  'sri-lanka': ['LK'],
  bangladesh: ['BD'],
  pakistan: ['PK'],
  maldives: ['MV'],
  germany: ['DE'],
  france: ['FR'],
  italy: ['IT'],
  spain: ['ES'],
  'great-britain': ['GB'],
  netherlands: ['NL'],
  belgium: ['BE'],
  switzerland: ['CH'],
  austria: ['AT'],
  poland: ['PL'],
  'czech-republic': ['CZ'],
  greece: ['GR'],
  portugal: ['PT'],
  'ireland-and-northern-ireland': ['IE', 'GB'],
  sweden: ['SE'],
  norway: ['NO'],
  finland: ['FI'],
  denmark: ['DK'],
  hungary: ['HU'],
  romania: ['RO'],
  croatia: ['HR'],
  turkey: ['TR'],
  us: ['US'],
  canada: ['CA'],
  mexico: ['MX'],
  brazil: ['BR'],
  argentina: ['AR'],
  chile: ['CL'],
  colombia: ['CO'],
  peru: ['PE'],
  australia: ['AU'],
  'new-zealand': ['NZ'],
  'south-africa': ['ZA'],
  egypt: ['EG'],
  morocco: ['MA'],
  kenya: ['KE'],
  tanzania: ['TZ'],
  ethiopia: ['ET'],
  nigeria: ['NG'],
};

function normalizeImportKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/-latest$/, '')
    .replace(/\.osm\.pbf$/, '');
}

/**
 * Recursively removes null and undefined fields from objects and arrays
 * @param {*} obj - Object, array, or primitive value to clean
 * @returns {*} Cleaned object/array/value with null/undefined fields removed
 */
function removeNullFields(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeNullFields);
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.entries(obj)
      .filter(([_, v]) => v !== null && v !== undefined)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: removeNullFields(v) }), {});
  }
  return obj;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

/**
 * Add resource_uri and preview_url to POI results
 *
 * Each POI gets two URLs for different use cases:
 *
 * 1. resource_uri (ui:// protocol) - MCP resource identifier
 *    Format: ui://{host}/poi/{osm_id}
 *    Example: ui://travel.arjanvandermeer.com/poi/1313852747
 *    Purpose: MCP clients can request this URI to get the rich POI detail page
 *    via the ReadResource method. The ui:// protocol indicates this is a
 *    user-interface resource (rendered HTML for display).
 *
 * 2. preview_url (https:// protocol) - Direct browser link
 *    Format: {baseUrl}/preview/poi/{osm_id}
 *    Example: https://travel.arjanvandermeer.com/preview/poi/1313852747
 *    Purpose: Direct HTTP URL that users can click to open the POI preview
 *    in their browser. Served by the HTTP server's /preview endpoint.
 *
 * @param {Array|Object} pois - POI(s) to add URIs to
 * @param {string} baseUrl - Base URL from server_base_url config (e.g., "https://mcp.example.com")
 */
function addResourceUris(pois, baseUrl) {
  // Normalize base URL (remove trailing slash for consistent concatenation)
  const base = baseUrl ? baseUrl.replace(/\/$/, '') : '';

  // Extract host from baseUrl for ui:// protocol
  // e.g., "https://mcp.example.com" -> "mcp.example.com"
  let uiHost = '';
  if (baseUrl) {
    try {
      uiHost = new URL(baseUrl).host;
    } catch {
      uiHost = '';
    }
  }

  if (Array.isArray(pois)) {
    return pois.map(poi => ({
      ...poi,
      resource_uri: `ui://${uiHost}/poi/${poi.osm_id}`,
      preview_url: `${base}/preview/poi/${poi.osm_id}`,
    }));
  }
  if (pois && pois.osm_id) {
    return {
      ...pois,
      resource_uri: `ui://${uiHost}/poi/${pois.osm_id}`,
      preview_url: `${base}/preview/poi/${pois.osm_id}`,
    };
  }
  return pois;
}

export class TravelDatabase {
  // Config cache TTL in milliseconds (5 minutes)
  static CONFIG_CACHE_TTL = CONFIG_CACHE_TTL_MS;

  /**
   * Create a TravelDatabase instance
   * @param {Object} options - Configuration options
   * @param {pg.Pool} options.pool - Optional: inject a custom pool (for testing with mocks)
   */
  constructor(options = {}) {
    // Allow pool injection for testing, otherwise create default pool
    this.pool = options.pool || new pg.Pool({
      connectionString: CONNECTION_STRING,
      statement_timeout: DB_STATEMENT_TIMEOUT_MS, // Kill queries before Cloudflare's 60s timeout
    });
    this.googlePlaces = null; // Initialize later with config
    this.googlePlacesReady = this.initGooglePlaces(); // Store promise

    // Config cache: Map<key, { value, expiresAt }>
    this._configCache = new Map();

    // Enrichment dedup lock: Map<osmId, Promise> - prevents duplicate API calls for same POI
    this._enrichmentLock = new Map();
  }

  /**
   * Get cached server base URL (convenience method for the most common config)
   */
  async getServerBaseUrl() {
    return this.getConfigCached('server_base_url');
  }

  /**
   * Get a config value with in-memory caching
   * @param {string} key - Config key
   * @param {*} defaultValue - Default value if not found
   * @returns {Promise<*>} Config value
   */
  async getConfigCached(key, defaultValue = null) {
    const now = Date.now();
    const cached = this._configCache.get(key);

    // Return cached value if not expired
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    // Fetch from database
    const value = await this.getConfig(key, defaultValue);

    // Cache the result (even if null/default, to avoid repeated DB lookups)
    this._configCache.set(key, {
      value,
      expiresAt: now + TravelDatabase.CONFIG_CACHE_TTL,
    });

    return value;
  }

  /**
   * Invalidate a config cache entry (call after setConfig)
   * @param {string} key - Config key to invalidate, or null to clear all
   */
  invalidateConfigCache(key = null) {
    if (key) {
      this._configCache.delete(key);
    } else {
      this._configCache.clear();
    }
  }

  async close() {
    await this.pool.end();
  }

  /**
   * Test database connection - throws if connection fails
   */
  async testConnection() {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  async ensureGooglePlacesReady() {
    if (!this.googlePlaces) {
      await this.googlePlacesReady;
    }
  }

  /**
   * Add photo URLs to search results from stored Google Places photo data.
   * Photo URLs are resolved during enrichment and stored in the DB as CDN links.
   * @param {Array} pois - Array of POI objects with google_photos
   * @returns {Array} - POIs with photo_url added (google_photos removed)
   */
  async addPhotoUrls(pois) {
    if (!pois || pois.length === 0) return pois;

    return pois.map(poi => {
      const { google_photos, ...rest } = poi;
      let photo_url = null;

      if (google_photos && Array.isArray(google_photos) && google_photos.length > 0) {
        const firstPhoto = google_photos[0];
        // Use pre-resolved thumbnail URL from enrichment
        photo_url = firstPhoto.url_thumbnail || firstPhoto.url || null;
      }

      return { ...rest, photo_url };
    });
  }

  /**
   * Resolve photo URLs during enrichment via Google Places API.
   * Called by upsertGooglePlace to store CDN URLs alongside photo metadata.
   * @param {Array} photos - Raw photos array from Google Places API response
   * @returns {Array} - Photos with resolved url and url_thumbnail fields
   */
  async resolvePhotoUrls(photos) {
    if (!photos || photos.length === 0) return [];

    const resolved = await Promise.all(photos.slice(0, 10).map(async p => ({
      name: p.name,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
      url: await this.googlePlaces.resolvePhotoUrl(p.name, 800, 600),
      url_thumbnail: await this.googlePlaces.resolvePhotoUrl(p.name, 200, 150),
    })));

    return resolved;
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  async getConfig(key, defaultValue = null) {
    try {
      const result = await this.pool.query(
        'SELECT value FROM app_config WHERE key = $1',
        [key]
      );
      return result.rows.length > 0 && result.rows[0].value ? result.rows[0].value : defaultValue;
    } catch (error) {
      // Silently fall back to default if config table doesn't exist
      // (config table is optional - using env vars is fine)
      if (!error.message.includes('relation "app_config" does not exist')) {
        console.error(`Error reading config ${key}:`, error.message);
      }
      return defaultValue;
    }
  }

  async setConfig(key, value, description = null) {
    await this.pool.query(`
      INSERT INTO app_config (key, value, description, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        description = COALESCE(EXCLUDED.description, app_config.description),
        updated_at = CURRENT_TIMESTAMP
    `, [key, value, description]);

    // Invalidate cache for this key
    this.invalidateConfigCache(key);
  }

  /**
   * Get all config values matching a prefix (e.g., 'telemetry_' or 'google_places_')
   */
  async getConfigByPrefix(prefix) {
    try {
      const result = await this.pool.query(
        'SELECT key, value FROM app_config WHERE key LIKE $1',
        [`${prefix}%`]
      );
      const config = {};
      for (const row of result.rows) {
        // Remove prefix from key for cleaner access
        const shortKey = row.key.replace(prefix, '');
        config[shortKey] = row.value;
      }
      return config;
    } catch (error) {
      if (!error.message.includes('relation "app_config" does not exist')) {
        console.error(`Error reading config prefix ${prefix}:`, error.message);
      }
      return {};
    }
  }

  /**
   * Get telemetry configuration (merged from database and environment)
   * Database values take precedence over environment variables
   */
  async getTelemetryConfig() {
    // Start with env vars as defaults
    const config = {
      sentryDsn: process.env.SENTRY_DSN || null,
      enabled: process.env.TELEMETRY_ENABLED !== 'false',
      sampleRate: parseFloat(process.env.TELEMETRY_SAMPLE_RATE || '1.0'),
      environment: process.env.TELEMETRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      sendDev: process.env.SENTRY_SEND_DEV === 'true',
    };

    // Try to get database config (single query instead of 5 separate ones)
    try {
      const result = await this.pool.query(
        `SELECT key, value FROM app_config WHERE key IN ('sentry_dsn', 'telemetry_enabled', 'telemetry_sample_rate', 'telemetry_environment', 'sentry_send_dev')`
      );
      const dbConfig = new Map(result.rows.map(r => [r.key, r.value]));

      // Override with database values if present
      const dbSentryDsn = dbConfig.get('sentry_dsn');
      const dbEnabled = dbConfig.get('telemetry_enabled');
      const dbSampleRate = dbConfig.get('telemetry_sample_rate');
      const dbEnvironment = dbConfig.get('telemetry_environment');
      const dbSendDev = dbConfig.get('sentry_send_dev');

      if (dbSentryDsn) config.sentryDsn = dbSentryDsn;
      if (dbEnabled !== undefined) config.enabled = dbEnabled !== 'false';
      if (dbSampleRate) config.sampleRate = parseFloat(dbSampleRate);
      if (dbEnvironment) config.environment = dbEnvironment;
      if (dbSendDev !== undefined) config.sendDev = dbSendDev === 'true';
    } catch (_error) {
      // Database config is optional, continue with env vars
    }

    return config;
  }

  async initGooglePlaces() {
    try {
      // Read configuration from database first, fallback to environment variables
      const apiKey = await this.getConfig('google_places_api_key', process.env.GOOGLE_PLACES_API_KEY);
      const envEnabled = process.env.GOOGLE_PLACES_ENABLED !== 'false';
      const enabledStr = await this.getConfig('google_places_enabled', envEnabled ? 'true' : 'false');
      const enabled = enabledStr !== 'false';

      this.googlePlaces = new GooglePlacesClient(apiKey, enabled);

      if (this.googlePlaces.isEnabled()) {
        console.error('✓ Google Places API initialized from database config');
      }
    } catch (_error) {
      console.error('⚠️  Could not initialize Google Places from database, using environment variables');
      this.googlePlaces = new GooglePlacesClient();
    }
  }

  // =========================================================================
  // City Search
  // =========================================================================

  /**
   * Search for cities by name, country, and/or proximity to coordinates.
   * @param {Object} options - Search parameters
   * @param {string|null} options.query - City name search query
   * @param {string|null} options.countryCode - ISO country code filter
   * @param {string|null} options.state - State/province filter
   * @param {number|null} options.latitude - Center latitude for proximity search
   * @param {number|null} options.longitude - Center longitude for proximity search
   * @param {number} options.radiusKm - Search radius in km (default 50)
   * @param {number} options.minPoiCount - Require cities to have at least this many linked POIs
   * @param {number} options.limit - Max results to return (default 10)
   * @returns {Promise<Array<Object>>} Array of city objects with geoname_id, name, country_code, coordinates, and distance
   */
  async searchCities(options) {
    const {
      query = null,
      countryCode = null,
      state = null,
      latitude = null,
      longitude = null,
      radiusKm = 50,
      minPoiCount = 0,
      limit = 10,
    } = options;

    // Debug logging
    console.error(`[searchCities] query=${query}, country=${countryCode}, state=${state}, lat=${latitude}, lon=${longitude}, radius=${radiusKm}km, limit=${limit}`);

    const hasCoords = latitude !== null && longitude !== null;
    const hasQuery = query && query.trim().length > 0;
    const params = [];

    // Build SELECT clause
    let queryText = `
      SELECT
        c.geoname_id,
        c.name,
        c.ascii_name,
        c.country_code,
        co.country as country_name,
        c.admin1_code as state_code,
        a.name as state_name,
        c.population,
        ST_Y(c.location) as latitude,
        ST_X(c.location) as longitude,
        c.timezone
    `;

    // Add distance calculation if coordinates provided
    if (hasCoords) {
      params.push(longitude, latitude);
      queryText += `, ST_Distance(c.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 as distance_km`;
    }

    if (minPoiCount > 0) {
      queryText += `, pc.poi_count`;
    }

    queryText += `
      FROM geonames_cities c
      ${minPoiCount > 0 ? `
      JOIN (
        SELECT nearest_city_id, COUNT(*)::int as poi_count
        FROM osm_pois
        WHERE nearest_city_id IS NOT NULL
        GROUP BY nearest_city_id
        HAVING COUNT(*) >= $${params.length + 1}
      ) pc ON pc.nearest_city_id = c.geoname_id
      ` : ''}
      LEFT JOIN geonames_countries co ON c.country_code = co.iso_alpha2
      LEFT JOIN geonames_admin1_codes a
        ON c.country_code = a.country_code
        AND c.admin1_code = a.admin1_code
      WHERE 1=1
    `;

    if (minPoiCount > 0) {
      params.push(minPoiCount);
    }

    // Add query filter if provided
    if (hasQuery) {
      queryText += ` AND (c.name ILIKE $${params.length + 1} OR c.ascii_name ILIKE $${params.length + 1} OR c.alternate_names ILIKE $${params.length + 1})`;
      params.push(`%${query.replace(/[%_\\]/g, '\\$&')}%`);
    }

    // Add coordinate radius filter
    if (hasCoords) {
      const maxRadius = Math.min(radiusKm, 1000);
      queryText += ` AND ST_DWithin(c.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $${params.length + 1}::float8 * 1000)`;
      params.push(maxRadius);
    }

    // Add country filter
    if (countryCode) {
      queryText += ` AND c.country_code = $${params.length + 1}`;
      params.push(countryCode.toUpperCase());
    }

    // Add state filter
    if (state) {
      queryText += ` AND (c.admin1_code ILIKE $${params.length + 1} OR a.name ILIKE $${params.length + 1} OR a.ascii_name ILIKE $${params.length + 1})`;
      params.push(state);
    }

    // Order by distance if coords provided, otherwise by population
    if (hasCoords) {
      queryText += ` ORDER BY distance_km ASC, c.population DESC NULLS LAST LIMIT $${params.length + 1}`;
    } else {
      queryText += ` ORDER BY c.population DESC NULLS LAST LIMIT $${params.length + 1}`;
    }
    params.push(Math.min(limit, SEARCH_LIMIT_MAX));

    const result = await this.pool.query(queryText, params);
    return removeNullFields(result.rows);
  }

  async getCityByGeonameId(geonameId) {
    const result = await this.pool.query(`
      SELECT
        c.geoname_id,
        c.name,
        c.ascii_name,
        c.country_code,
        co.country as country_name,
        c.admin1_code as state_code,
        a.name as state_name,
        c.population,
        ST_Y(c.location) as latitude,
        ST_X(c.location) as longitude,
        c.timezone
      FROM geonames_cities c
      LEFT JOIN geonames_countries co ON c.country_code = co.iso_alpha2
      LEFT JOIN geonames_admin1_codes a
        ON c.country_code = a.country_code
        AND c.admin1_code = a.admin1_code
      WHERE c.geoname_id = $1
    `, [geonameId]);

    const city = result.rows[0] || null;
    return city ? removeNullFields(city) : null;
  }

  /**
   * Pick a random city from loaded areas, limited to substantial cities with imported POIs.
   * @param {Object} [options]
   * @param {number} [options.minPoiCount=25] - Minimum linked POIs required
   * @param {number} [options.minPopulation=50000] - Minimum city population preferred
   * @returns {Promise<Object|null>} City object with country metadata and POI count
   */
  async getRandomCityWithData(options = {}) {
    const minPoiCount = Number.isFinite(options.minPoiCount) ? Math.max(1, Math.floor(options.minPoiCount)) : 25;
    const minPopulation = Number.isFinite(options.minPopulation) ? Math.max(0, Math.floor(options.minPopulation)) : 50000;

    const loadedResult = await this.pool.query(`
      SELECT DISTINCT
        COALESCE(s.keyword, REPLACE(l.region_name, '-latest', '')) as keyword,
        l.region_name
      FROM import_log l
      LEFT JOIN import_sources s ON s.last_import_id = l.id
        OR s.keyword = REPLACE(l.region_name, '-latest', '')
      WHERE l.status = 'completed'
        AND l.records_imported > 0
        AND l.region_name IS NOT NULL
    `);

    const loadedCountryCodes = [...new Set(loadedResult.rows.flatMap(row => {
      const keyword = normalizeImportKeyword(row.keyword || row.region_name);
      return IMPORT_SOURCE_COUNTRY_CODES[keyword] || [];
    }))];

    const params = [];
    const countryFilter = loadedCountryCodes.length > 0
      ? `AND c.country_code = ANY($${params.push(loadedCountryCodes)}::text[])`
      : '';

    const result = await this.pool.query(`
      SELECT
        c.geoname_id,
        c.name,
        c.ascii_name,
        c.country_code,
        co.country as country_name,
        c.admin1_code as state_code,
        a.name as state_name,
        c.population,
        ST_Y(c.location) as latitude,
        ST_X(c.location) as longitude,
        c.timezone,
        COUNT(p.osm_id)::int as poi_count
      FROM geonames_cities c
      JOIN osm_pois p ON p.nearest_city_id = c.geoname_id
      LEFT JOIN geonames_countries co ON c.country_code = co.iso_alpha2
      LEFT JOIN geonames_admin1_codes a
        ON c.country_code = a.country_code
        AND c.admin1_code = a.admin1_code
      WHERE 1=1
        ${countryFilter}
        AND COALESCE(c.population, 0) >= $${params.push(minPopulation)}
      GROUP BY c.geoname_id, co.country, a.name
      HAVING COUNT(p.osm_id) >= $${params.push(minPoiCount)}
      ORDER BY RANDOM()
      LIMIT 1
    `, params);

    const city = result.rows[0] || null;
    return city ? removeNullFields(city) : null;
  }

  // =========================================================================
  // Google Data Enrichment Helper
  // =========================================================================

  /**
   * Enrich POI results with Google Places data (2-phase pattern).
   * Phase 1 queries osm_pois directly (fast, uses indexes).
   * This Phase 2 helper looks up Google data only for the matching results.
   *
   * @param {Array} rows - POI rows from Phase 1 (must have osm_id)
   * @returns {Array} Same rows with Google fields merged in
   */
  async enrichWithGoogleData(rows) {
    if (!rows || rows.length === 0) return rows;

    const osmIds = rows.map(r => r.osm_id).filter(Boolean);
    if (osmIds.length === 0) return rows;

    const googleResult = await this.pool.query(`
      SELECT m.osm_id,
        g.google_place_id, g.name as google_name,
        g.rating as google_rating, g.user_rating_count as google_review_count,
        g.price_level as google_price_level, g.business_status as google_business_status,
        g.short_formatted_address as google_short_address,
        g.national_phone as google_phone, g.website_uri as google_website,
        g.google_maps_uri as google_maps_url,
        g.opening_hours as google_opening_hours, g.photos as google_photos,
        g.utc_offset_minutes as google_utc_offset_minutes
      FROM osm_google_mappings m
      JOIN google_places g ON m.google_place_id = g.google_place_id
      WHERE m.osm_id = ANY($1) AND m.mapping_status = 'active'
    `, [osmIds]);

    const googleMap = new Map();
    for (const g of googleResult.rows) {
      googleMap.set(g.osm_id, g);
    }

    return rows.map(row => {
      const g = googleMap.get(row.osm_id);
      if (!g) return row;
      return {
        ...row,
        name: g.google_name || row.name, // Prefer Google name
        google_place_id: g.google_place_id,
        google_rating: g.google_rating,
        google_review_count: g.google_review_count,
        google_price_level: g.google_price_level,
        google_business_status: g.google_business_status,
        google_short_address: g.google_short_address,
        google_phone: g.google_phone,
        google_website: g.google_website,
        google_maps_url: g.google_maps_url,
        google_opening_hours: g.google_opening_hours,
        google_photos: g.google_photos,
        google_utc_offset_minutes: g.google_utc_offset_minutes,
      };
    });
  }

  // =========================================================================
  // POI Search (queries osm_pois directly, enriches with Google data)
  // =========================================================================
  //
  // SUPPORTED PARAMETER COMBINATIONS:
  // Must provide either `query` OR `city` (or both). Country/state alone is not enough.
  //
  // | Parameters                    | Behavior                              |
  // |-------------------------------|---------------------------------------|
  // | query                         | Global name search                    |
  // | query + country_code          | Name search filtered by country       |
  // | city + country_code           | All POIs near that city               |
  // | city + state + country_code   | All POIs near city (state disambig)   |
  // | lat + long                    | All POIs near coordinates             |
  // | query + city + country_code   | Name search near city                 |
  // | query + lat + long            | Name search near coordinates          |
  //
  // NOT SUPPORTED (will error or return empty):
  // | country_code only             | Error - too broad                     |
  // | state + country_code (no city)| Error - need city or query            |
  //
  // =========================================================================

  // =========================================================================
  // Extra Filters: cuisine, amenities, dietary
  // Appends WHERE clauses to an in-progress query and pushes bind params.
  // =========================================================================

  /**
   * User-friendly amenity names mapped to OSM tag keys.
   * The tag must exist and not equal 'no' to match.
   */
  static AMENITY_TAG_MAP = {
    wifi: 'internet_access',
    pool: 'swimming_pool',
    parking: 'parking',
    breakfast: 'breakfast',
    air_conditioning: 'air_conditioning',
    pet_friendly: 'pets',
    restaurant: 'restaurant',
    spa: 'spa',
    gym: 'fitness_centre',
    bar: 'bar',
    elevator: 'elevator',
  };

  /**
   * User-friendly dietary names mapped to OSM tag keys.
   */
  static DIETARY_TAG_MAP = {
    vegetarian: 'diet:vegetarian',
    vegan: 'diet:vegan',
    gluten_free: 'diet:gluten_free',
    halal: 'diet:halal',
    kosher: 'diet:kosher',
    organic: 'diet:organic',
    lactose_free: 'diet:lactose_free',
  };

  /**
   * Append cuisine, amenity, and dietary WHERE clauses to a query.
   * Mutates queryParams array. Returns SQL fragment string to append.
   * @param {string[]|null} cuisine - Cuisine values to match (OR logic, ILIKE on p.cuisine)
   * @param {string[]|null} amenities - Amenity keys to require (AND logic, tags JSONB)
   * @param {string[]|null} dietary - Dietary restriction keys to require (AND logic, tags JSONB)
   * @param {Array} queryParams - Bind parameter array (mutated in-place)
   * @returns {string} SQL fragment to append after existing WHERE clauses
   */
  static buildExtraFilters(cuisine, amenities, dietary, queryParams) {
    let sql = '';

    // Cuisine filter: match any of the provided cuisines (OR)
    if (cuisine && cuisine.length > 0) {
      const cuisineClauses = cuisine.map(c => {
        const escaped = c.replace(/[%_\\]/g, '\\$&');
        queryParams.push(`%${escaped}%`);
        return `p.cuisine ILIKE $${queryParams.length}`;
      });
      sql += ` AND (${cuisineClauses.join(' OR ')})`;
    }

    // Amenity filter: require all amenities (AND)
    if (amenities && amenities.length > 0) {
      for (const amenity of amenities) {
        const tagKey = TravelDatabase.AMENITY_TAG_MAP[amenity] || amenity;
        queryParams.push(tagKey);
        const idx = queryParams.length;
        sql += ` AND p.tags->>$${idx} IS NOT NULL AND p.tags->>$${idx} != 'no'`;
      }
    }

    // Dietary filter: require all dietary options (AND)
    if (dietary && dietary.length > 0) {
      for (const diet of dietary) {
        const tagKey = TravelDatabase.DIETARY_TAG_MAP[diet] || diet;
        queryParams.push(tagKey);
        const idx = queryParams.length;
        sql += ` AND p.tags->>$${idx} IS NOT NULL AND p.tags->>$${idx} != 'no'`;
      }
    }

    return sql;
  }

  /**
   * Search for POIs by name, city, coordinates, and/or type filters.
   * @param {Object} params - Search parameters
   * @param {string|null} params.cityName - City name to search within
   * @param {string|null} params.countryCode - ISO country code filter
   * @param {string|null} params.state - State/province filter
   * @param {number|null} params.latitude - Center latitude for coordinate-based search
   * @param {number|null} params.longitude - Center longitude for coordinate-based search
   * @param {number|null} params.radius - Search radius in km
   * @param {string|null} params.poiType - Single POI type filter
   * @param {string[]|null} params.poiTypes - Array of POI type filters
   * @param {string|null} params.name - POI name search query
   * @param {string[]|null} params.cuisine - Cuisine filter (e.g., ["thai", "japanese"])
   * @param {string[]|null} params.amenities - Amenity filter (e.g., ["wifi", "pool"])
   * @param {string[]|null} params.dietary - Dietary restriction filter (e.g., ["vegan", "halal"])
   * @param {boolean} params.openNow - Filter to only currently open POIs
   * @param {number} params.limit - Max results (default SEARCH_LIMIT_DEFAULT, capped at SEARCH_LIMIT_MAX)
   * @param {string|null} params.userId - User ID for including favorite status
   * @returns {Promise<Array<Object>>} Array of POI objects with osm_id, name, coordinates, city, type, and optional favorite status
   */
  async searchPOIs(params) {
    const {
      cityName = null,
      countryCode = null,
      state = null,
      latitude = null,
      longitude = null,
      radius = null,
      poiType = null,
      poiTypes = null,  // New: array of types
      name = null,
      cuisine = null,     // Cuisine filter (e.g., ["thai", "japanese"])
      amenities = null,   // Amenity filter (e.g., ["wifi", "pool"])
      dietary = null,     // Dietary restriction filter (e.g., ["vegan", "halal"])
      openNow = false,    // Filter to only currently open POIs
      limit: rawLimit = SEARCH_LIMIT_DEFAULT,
      offset = 0,
      userId = null,    // For including favorite status in results
    } = params;
    const limit = Math.min(rawLimit, SEARCH_LIMIT_MAX);

    // Debug logging
    const typeDesc = poiTypes ? poiTypes.join(',') : poiType || 'all';
    const extraDesc = [
      cuisine && `cuisine=${cuisine.join(',')}`,
      amenities && `amenities=${amenities.join(',')}`,
      dietary && `dietary=${dietary.join(',')}`,
      openNow && 'openNow',
    ].filter(Boolean).join(', ');
    console.error(`[searchPOIs] query=${name}, city=${cityName}, country=${countryCode}, state=${state}, lat=${latitude}, lon=${longitude}, radius=${radius}km, types=${typeDesc}, limit=${limit}${extraDesc ? `, ${extraDesc}` : ''}`);

    let query;
    let queryParams;

    // Normalize POI type filter - support both single type and array of types
    const typeFilter = poiTypes || (poiType ? [poiType] : null);

    // Determine search strategy based on provided parameters
    const hasName = !!name;
    const hasCity = !!cityName;
    const hasCoords = latitude !== null && latitude !== undefined &&
      longitude !== null && longitude !== undefined;

    // Case 1: Name search (optionally filtered by country)
    // Supports: query only, query + country
    if (hasName && !hasCity && !hasCoords) {
      query = `
        SELECT
          p.osm_id,
          p.poi_type,
          p.name,
          p.latitude,
          p.longitude,
          c.name as city,
          c.country_code,
          p.stars as osm_stars,
          p.cuisine as osm_cuisine,
          p.tags->>'brand' as osm_brand,
          GREATEST(
            similarity(p.name, $1),
            COALESCE(similarity(p.name_en, $1), 0),
            COALESCE(similarity(p.tags->>'brand', $1), 0)
          ) as name_similarity
        FROM osm_pois p
        LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
        WHERE p.name IS NOT NULL
          AND (p.name ILIKE $2 OR p.name_en ILIKE $2 OR p.tags->>'brand' ILIKE $2)
      `;
      const escapedName = name.replace(/[%_\\]/g, '\\$&');
      queryParams = [name, `%${escapedName}%`];

      // Filter by country if provided
      if (countryCode) {
        query += ` AND c.country_code = $${queryParams.length + 1}`;
        queryParams.push(countryCode.toUpperCase());
      }

      if (typeFilter) {
        query += ` AND p.poi_type = ANY($${queryParams.length + 1})`;
        queryParams.push(typeFilter);
      }

      // Extra filters: cuisine, amenities, dietary
      query += TravelDatabase.buildExtraFilters(cuisine, amenities, dietary, queryParams);

      query += ` ORDER BY name_similarity DESC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    // Case 2: Location only (city or coordinates)
    else if (!hasName && (hasCity || hasCoords)) {
      const extraFilters = { cuisine, amenities, dietary };
      if (hasCity) {
        const city = await this.getCityByName(cityName, countryCode, state);
        if (!city) {
          return [];
        }

        const searchRadius = radius || this.getRadiusForPopulation(city.population || 100000);
        return this.searchPOIsNearCoordinates(
          city.latitude,
          city.longitude,
          searchRadius,
          typeFilter,
          limit,
          userId,
          null,
          extraFilters,
          openNow,
          offset,
        );
      } else {
        const searchRadius = radius || 10; // Default 10km
        return this.searchPOIsNearCoordinates(
          latitude,
          longitude,
          searchRadius,
          typeFilter,
          limit,
          userId,
          null,
          extraFilters,
          openNow,
          offset,
        );
      }
    }
    // Case 3: Name + Location (combined search - filter by name AND location)
    else if (hasName && (hasCity || hasCoords)) {
      // First resolve city to coordinates if needed
      let searchLat = latitude;
      let searchLon = longitude;
      let searchRadius = radius;

      if (hasCity) {
        const city = await this.getCityByName(cityName, countryCode, state);
        if (!city) {
          return [];
        }
        searchLat = city.latitude;
        searchLon = city.longitude;
        searchRadius = searchRadius || this.getRadiusForPopulation(city.population || 100000);
      } else {
        searchRadius = searchRadius || 10; // Default 10km for coordinates
      }

      // Combined query: name filter + distance filter
      query = `
        SELECT
          p.osm_id,
          p.poi_type,
          p.name,
          p.latitude,
          p.longitude,
          c.name as city,
          c.country_code,
          p.stars as osm_stars,
          p.cuisine as osm_cuisine,
          p.tags->>'brand' as osm_brand,
          GREATEST(
            similarity(p.name, $1),
            COALESCE(similarity(p.name_en, $1), 0),
            COALESCE(similarity(p.tags->>'brand', $1), 0)
          ) as name_similarity,
          ST_Distance(
            p.location::geography,
            ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
          ) / 1000.0 as distance_km
        FROM osm_pois p
        LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
        WHERE p.name IS NOT NULL
          AND (p.name ILIKE $4 OR p.name_en ILIKE $4 OR p.tags->>'brand' ILIKE $4)
          AND ST_DWithin(
            p.location::geography,
            ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
            $5::float8 * 1000
          )
      `;
      const escapedName3 = name.replace(/[%_\\]/g, '\\$&');
      queryParams = [name, searchLat, searchLon, `%${escapedName3}%`, searchRadius];

      if (typeFilter) {
        query += ` AND p.poi_type = ANY($${queryParams.length + 1})`;
        queryParams.push(typeFilter);
      }

      // Extra filters: cuisine, amenities, dietary
      query += TravelDatabase.buildExtraFilters(cuisine, amenities, dietary, queryParams);

      query += ` ORDER BY name_similarity DESC, distance_km ASC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    else {
      throw new Error('Must provide either name, cityName, or coordinates (latitude + longitude)');
    }

    // For openNow, over-fetch and post-filter using Google Places opening_hours
    const fetchLimit = openNow ? limit * 3 : limit;
    // Replace the limit param (always the last one) with the potentially larger fetch limit
    if (openNow) {
      queryParams[queryParams.length - 1] = fetchLimit;
    }

    const result = await this.pool.query(query, queryParams);
    const enriched = await this.enrichWithGoogleData(result.rows);

    let filtered = enriched;
    if (openNow) {
      filtered = this.filterOpenNow(enriched).slice(0, limit);
    }

    const baseUrl = await this.getServerBaseUrl();
    const withUris = addResourceUris(removeNullFields(filtered), baseUrl);
    const withPhotos = await this.addPhotoUrls(withUris);
    return this.addFavoriteStatus(withPhotos, userId);
  }

  /**
   * Filter POIs to only those currently open, using Google Places opening_hours data.
   * POIs without opening hours data are excluded (we can't determine if they're open).
   */
  filterOpenNow(pois) {
    // Import isOpenNow lazily to avoid circular deps — it's a pure function
    const now = new Date();
    return pois.filter(poi => {
      if (!poi.google_opening_hours?.periods || poi.google_utc_offset_minutes == null) {
        return false; // No hours data — can't confirm open, exclude
      }
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const localMs = utcMs + poi.google_utc_offset_minutes * 60000;
      const localDate = new Date(localMs);
      const day = localDate.getDay();
      const currentMinutes = localDate.getHours() * 60 + localDate.getMinutes();

      for (const period of poi.google_opening_hours.periods) {
        if (!period.open) continue;
        const openDay = period.open.day;
        const openMin = period.open.hour * 60 + period.open.minute;
        if (!period.close) {
          if (openDay === day) return true; // 24 hours
          continue;
        }
        const closeDay = period.close.day;
        const closeMin = period.close.hour * 60 + period.close.minute;
        if (openDay === closeDay && openDay === day) {
          if (currentMinutes >= openMin && currentMinutes < closeMin) return true;
        } else if (openDay !== closeDay) {
          if (day === openDay && currentMinutes >= openMin) return true;
          if (day === closeDay && currentMinutes < closeMin) return true;
        }
      }
      return false;
    });
  }

  /**
   * Add favorite status to POI results for authenticated users
   * Adds is_favorite, favorite_since, favorite_notes fields
   */
  async addFavoriteStatus(pois, userId) {
    if (!userId || !pois || pois.length === 0) {
      return pois;
    }

    const osmIds = pois.map(p => p.osm_id).filter(Boolean);
    if (osmIds.length === 0) {
      return pois;
    }

    // Get favorites for these POIs
    const favResult = await this.pool.query(`
      SELECT poi_osm_id, created_at, notes
      FROM user_favorites
      WHERE user_id = $1 AND poi_osm_id = ANY($2)
    `, [userId, osmIds]);

    // Create a map for quick lookup
    const favMap = new Map();
    for (const fav of favResult.rows) {
      favMap.set(fav.poi_osm_id, {
        favorite_since: fav.created_at,
        favorite_notes: fav.notes,
      });
    }

    // Add favorite status to each POI
    return pois.map(poi => {
      const fav = favMap.get(poi.osm_id);
      return {
        ...poi,
        is_favorite: !!fav,
        ...(fav && { favorite_since: fav.favorite_since }),
        ...(fav?.favorite_notes && { favorite_notes: fav.favorite_notes }),
      };
    });
  }

  /**
   * Search for POIs within a radius of given coordinates.
   * @param {number} latitude - Center latitude
   * @param {number} longitude - Center longitude
   * @param {number} radiusKm - Search radius in kilometers
   * @param {string|string[]|null} typeFilter - POI type(s) to filter by
   * @param {number} rawLimit - Max results (capped at SEARCH_LIMIT_MAX)
   * @param {string|null} userId - User ID for including favorite status
   * @param {string[]|null} excludeOsmIds - OSM IDs to exclude from results
   * @param {Object|null} extraFilters - Additional filters: { cuisine, amenities, dietary }
   * @param {boolean} openNow - Filter to only currently open POIs
   * @returns {Promise<Array<Object>>} Array of POI objects with distance_km included
   */
  async searchPOIsNearCoordinates(latitude, longitude, radiusKm, typeFilter = null, rawLimit = SEARCH_LIMIT_DEFAULT, userId = null, excludeOsmIds = null, extraFilters = null, openNow = false, offset = 0) {
    const limit = Math.min(rawLimit, SEARCH_LIMIT_MAX);
    // Debug logging
    const typeDesc = typeFilter ? (Array.isArray(typeFilter) ? typeFilter.join(',') : typeFilter) : 'all';
    console.error(`[searchPOIsNearCoordinates] lat=${latitude}, lon=${longitude}, radius=${radiusKm}km, types=${typeDesc}, limit=${limit}`);

    let query = `
      SELECT
        p.osm_id,
        p.poi_type,
        p.name,
        p.latitude,
        p.longitude,
        c.name as city,
        c.country_code,
        p.stars as osm_stars,
        p.cuisine as osm_cuisine,
        ST_Distance(
          p.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) / 1000.0 as distance_km
      FROM osm_pois p
      LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
      WHERE p.name IS NOT NULL
        AND ST_DWithin(
          p.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3::float8 * 1000
        )
    `;

    const params = [latitude, longitude, radiusKm];

    if (typeFilter) {
      query += ` AND p.poi_type = ANY($${params.length + 1})`;
      params.push(typeFilter);
    }

    if (excludeOsmIds && excludeOsmIds.length > 0) {
      query += ` AND p.osm_id != ALL($${params.length + 1})`;
      params.push(excludeOsmIds);
    }

    // Extra filters: cuisine, amenities, dietary
    if (extraFilters) {
      query += TravelDatabase.buildExtraFilters(
        extraFilters.cuisine, extraFilters.amenities, extraFilters.dietary, params
      );
    }

    // For openNow, over-fetch and post-filter (offset not applied when openNow since post-filtering changes counts)
    const fetchLimit = openNow ? limit * 3 : limit;
    const fetchOffset = openNow ? 0 : offset;
    query += ` ORDER BY distance_km ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(fetchLimit, fetchOffset);

    const result = await this.pool.query(query, params);
    const enriched = await this.enrichWithGoogleData(result.rows);

    let filtered = enriched;
    if (openNow) {
      filtered = this.filterOpenNow(enriched).slice(0, limit);
    }

    const baseUrl = await this.getServerBaseUrl();
    const withUris = addResourceUris(removeNullFields(filtered), baseUrl);
    const withPhotos = await this.addPhotoUrls(withUris);
    return this.addFavoriteStatus(withPhotos, userId);
  }

  /**
   * Search POIs within a bounding box (for map viewport queries).
   * Uses ST_MakeEnvelope for fast spatial index lookups.
   * Skips Google enrichment for speed — returns lightweight markers.
   * @param {number} swLat - Southwest corner latitude
   * @param {number} swLng - Southwest corner longitude
   * @param {number} neLat - Northeast corner latitude
   * @param {number} neLng - Northeast corner longitude
   * @param {string[]|null} typeFilter - POI types to include
   * @param {number} rawLimit - Max results
   * @param {number} minRating - Minimum Google rating (0 to skip)
   * @param {number|null} userId - User ID for favorite status
   * @returns {Promise<Array>} Lightweight POI objects for map markers
   */
  async searchPOIsInBBox(swLat, swLng, neLat, neLng, typeFilter = null, rawLimit = 200, minRating = 0, userId = null) {
    const limit = Math.min(rawLimit, SEARCH_LIMIT_MAX);
    console.error(`[searchPOIsInBBox] sw=${swLat},${swLng} ne=${neLat},${neLng} types=${typeFilter || 'all'} minRating=${minRating} limit=${limit}`);

    let query = `
      SELECT
        p.osm_id,
        p.poi_type,
        p.name,
        p.latitude,
        p.longitude,
        c.name as city,
        c.country_code,
        p.stars as osm_stars,
        p.cuisine as osm_cuisine,
        g.rating as google_rating,
        g.user_rating_count as google_review_count,
        g.photos->0->>'url' as photo_url
      FROM osm_pois p
      LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
      LEFT JOIN osm_google_mappings m ON p.osm_id = m.osm_id AND m.mapping_status = 'active'
      LEFT JOIN google_places g ON m.google_place_id = g.google_place_id
      WHERE p.name IS NOT NULL
        AND p.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
    `;

    const params = [swLng, swLat, neLng, neLat];

    if (typeFilter && typeFilter.length > 0) {
      query += ` AND p.poi_type = ANY($${params.length + 1})`;
      params.push(typeFilter);
    }

    if (minRating > 0) {
      query += ` AND g.rating >= $${params.length + 1}`;
      params.push(minRating);
    }

    // Prefer POIs with ratings, then by rating desc
    query += ` ORDER BY g.rating DESC NULLS LAST LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(query, params);
    const cleaned = removeNullFields(result.rows);
    return this.addFavoriteStatus(cleaned, userId);
  }

  async getCityByName(name, countryCode = null, state = null) {
    const cities = await this.searchCities({
      query: name,
      countryCode,
      state,
      limit: 1,
    });
    return cities[0] || null;
  }

  getRadiusForPopulation(population) {
    if (population > 5000000) return 30;
    if (population > 1000000) return 20;
    if (population > 500000) return 15;
    if (population > 100000) return 10;
    return 5;
  }

  // =========================================================================
  // POI Details
  // =========================================================================

  /**
   * Get full details for a POI by OSM ID or Google Place ID, with enrichment status.
   * @param {string|null} osmId - OpenStreetMap POI ID
   * @param {string|null} googlePlaceId - Google Places ID
   * @param {string|null} userId - User ID for including favorite status
   * @returns {Promise<Object|null>} POI detail object with enrichment metadata, or null if not found
   */
  async getPOIDetails(osmId = null, googlePlaceId = null, userId = null) {
    // Debug logging
    console.error(`[getPOIDetails] osmId=${osmId}, googlePlaceId=${googlePlaceId}, userId=${userId}`);

    let result;
    if (googlePlaceId) {
      // Look up by Google Places ID
      result = await this.pool.query(`
        SELECT *
        FROM enriched_pois
        WHERE google_place_id = $1
      `, [googlePlaceId]);
    } else if (osmId) {
      // Look up by OSM ID
      result = await this.pool.query(`
        SELECT *
        FROM enriched_pois
        WHERE osm_id = $1
      `, [osmId]);
    } else {
      return null;
    }

    const poi = result.rows[0] || null;
    if (!poi) return null;

    // Get the osm_id for enrichment logic (needed below)
    osmId = poi.osm_id;

    // Determine enrichment status and add helpful metadata
    let enrichment_status = 'complete';
    let enrichment_message = null;

    // Check mapping status to determine if enrichment is needed
    if (poi.mapping_status === 'active' && poi.google_place_id) {
      // Already enriched - complete
      enrichment_status = 'complete';
    } else if (poi.mapping_status === 'pending') {
      const startedAt = poi.mapped_at ? new Date(poi.mapped_at) : new Date();
      const ageMs = Date.now() - startedAt.getTime();
      const isStale = ageMs > 5 * 60 * 1000 && !this._enrichmentLock.has(osmId);
      if (isStale) {
        // Server restart (or crash) left a stale pending row.
        // Reset mapped_at so it looks fresh, then re-trigger enrichment immediately.
        await this.pool.query(
          `UPDATE osm_google_mappings SET mapped_at = CURRENT_TIMESTAMP WHERE osm_id = $1`, [osmId]
        ).catch(() => {});

        const newStartedAt = new Date();
        const checkBackAt  = new Date(newStartedAt.getTime() + 60000);
        enrichment_status  = 'pending';
        enrichment_message = `Enrichment restarted at ${newStartedAt.toISOString()}. Check back after ${checkBackAt.toISOString()}.`;

        const enrichmentPromise = withTimeout(
          this.enrichOSMPOI(osmId),
          120000,
          'Enrichment timeout after 2 minutes'
        ).catch(err => {
          this.pool.query(
            `UPDATE osm_google_mappings SET mapping_status = 'error', mapping_notes = $1 WHERE osm_id = $2`,
            [err.message, osmId]
          ).catch(() => {});
        }).finally(() => { this._enrichmentLock.delete(osmId); });
        this._enrichmentLock.set(osmId, enrichmentPromise);
      } else {
        enrichment_status = 'pending';
        const checkBackAt = new Date(startedAt.getTime() + 60000);
        enrichment_message = `Google Places enrichment in progress (started at ${startedAt.toISOString()}). Check back after ${checkBackAt.toISOString()}.`;
      }
    } else if (poi.mapping_status === 'not_found') {
      enrichment_status = 'failed';
      const attemptedAt = poi.mapped_at ? new Date(poi.mapped_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : null;
      enrichment_message = `Google Places enrichment attempted but no matching location was found. Only OpenStreetMap data is available.${attemptedAt ? ` (last attempted: ${attemptedAt})` : ''}`;
    } else if (poi.mapping_status === 'error') {
      enrichment_status = 'failed';
      const attemptedAt = poi.mapped_at ? new Date(poi.mapped_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : null;
      enrichment_message = `Google Places enrichment failed due to an error. Only OpenStreetMap data is available.${attemptedAt ? ` (last attempted: ${attemptedAt})` : ''}`;
    } else if (!poi.mapping_status) {
      // No enrichment attempt yet - trigger it
      await this.ensureGooglePlacesReady();
      if (this.googlePlaces && this.googlePlaces.isEnabled()) {
        // Check if enrichment is already in-flight for this POI (dedup concurrent requests)
        if (this._enrichmentLock.has(osmId)) {
          enrichment_status = 'pending';
          enrichment_message = 'Google Places enrichment already in progress. Check back shortly for complete information.';
        } else {
          // Mark as pending IMMEDIATELY before starting enrichment
          await this.pool.query(`
            INSERT INTO osm_google_mappings (osm_id, mapping_status, mapped_at)
            VALUES ($1, 'pending', CURRENT_TIMESTAMP)
            ON CONFLICT (osm_id) DO UPDATE SET mapping_status = 'pending', mapped_at = CURRENT_TIMESTAMP
          `, [osmId]);

          const startedAt = new Date();
          const checkBackAt = new Date(startedAt.getTime() + 60000); // 1 minute from now

          enrichment_status = 'pending';
          enrichment_message = `Google Places enrichment started at ${startedAt.toISOString()}. Check back after ${checkBackAt.toISOString()} (approximately 1 minute) for complete information including ratings, reviews, photos, and verified opening hours.`;

          // Fire-and-forget background enrichment with 2-minute timeout and dedup lock
          const enrichmentPromise = withTimeout(
            this.enrichOSMPOI(osmId),
            120000,
            'Enrichment timeout after 2 minutes'
          ).catch(err => {
            console.error(`Background enrichment failed for POI ${osmId}:`, err.message);
            telemetry.captureException(err, { context: 'background_enrichment', osmId });
            // Mark as error if enrichment fails
            this.pool.query(`
              UPDATE osm_google_mappings
              SET mapping_status = 'error', mapping_notes = $1
              WHERE osm_id = $2
            `, [err.message, osmId]).catch(() => {});
          }).finally(() => {
            this._enrichmentLock.delete(osmId);
          });
          this._enrichmentLock.set(osmId, enrichmentPromise);
        }
      } else {
        enrichment_status = 'disabled';
        enrichment_message = 'Google Places enrichment is not enabled. Only OpenStreetMap data is available.';
      }
    }

    // Add enrichment metadata to the response
    const response = {
      ...poi,
      _enrichment: {
        status: enrichment_status,
        message: enrichment_message,
      }
    };

    // Photos: URLs are resolved during enrichment and stored in the DB.
    // No runtime URL computation needed — photo urls are direct CDN links.

    // Remove null/undefined fields and add resource URIs
    const baseUrl = await this.getServerBaseUrl();
    const withUris = addResourceUris(removeNullFields(response), baseUrl);

    // Add favorite status for authenticated users (returns array, we extract single item)
    const withFavorites = await this.addFavoriteStatus([withUris], userId);
    return withFavorites[0];
  }

  /**
   * Get a random POI from the database (for testing/demo purposes)
   * Prefers POIs with Google enrichment data for richer display
   */
  async getRandomPOI() {
    const result = await this.pool.query(`
      SELECT m.osm_id
      FROM osm_google_mappings m
      WHERE m.mapping_status = 'active'
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      // Fallback to any POI if no enriched ones exist
      const fallback = await this.pool.query(`
        SELECT osm_id FROM osm_pois ORDER BY RANDOM() LIMIT 1
      `);
      if (fallback.rows.length === 0) return null;
      return this.getPOIDetails(fallback.rows[0].osm_id);
    }

    return this.getPOIDetails(result.rows[0].osm_id);
  }

  // =========================================================================
  // Google API Rate Limiting
  // =========================================================================

  // Default daily limit (can be overridden in app_config with key 'google_api_daily_limit')
  static DEFAULT_GOOGLE_API_DAILY_LIMIT = GOOGLE_PLACES_DAILY_LIMIT_DEFAULT;

  /**
   * Get today's date as YYYY-MM-DD string (UTC)
   */
  getTodayDateKey() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Atomically consume one unit of Google API quota for today.
   * Uses INSERT...ON CONFLICT with a WHERE clause to avoid TOCTOU race conditions.
   *
   * @returns {Promise<{allowed: boolean, current: number, limit: number, remaining: number}>}
   */
  async consumeGoogleApiQuota() {
    const dateKey = this.getTodayDateKey();
    const limit = parseInt(await this.getConfigCached('google_api_daily_limit', String(TravelDatabase.DEFAULT_GOOGLE_API_DAILY_LIMIT)));

    try {
      const result = await this.pool.query(`
        INSERT INTO google_api_usage (date_key, call_count, updated_at)
        VALUES ($1, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (date_key) DO UPDATE SET
          call_count = google_api_usage.call_count + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE google_api_usage.call_count < $2
        RETURNING call_count
      `, [dateKey, limit]);

      if (result.rows.length > 0) {
        const current = parseInt(result.rows[0].call_count);
        return { allowed: true, current, limit, remaining: Math.max(0, limit - current) };
      }

      // No row returned means the WHERE clause blocked the update (at limit)
      // Fetch actual current count for the response
      const countResult = await this.pool.query(
        'SELECT call_count FROM google_api_usage WHERE date_key = $1',
        [dateKey]
      );
      const current = countResult.rows.length > 0 ? parseInt(countResult.rows[0].call_count) : limit;
      return { allowed: false, current, limit, remaining: 0 };
    } catch (error) {
      if (error.message.includes('relation "google_api_usage" does not exist')) {
        // Table doesn't exist, create it and retry
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS google_api_usage (
            date_key VARCHAR(10) PRIMARY KEY,
            call_count INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        return this.consumeGoogleApiQuota();
      }
      throw error;
    }
  }

  /**
   * @deprecated Use consumeGoogleApiQuota() instead — this has a TOCTOU race condition
   * Check if we can make another Google API call today
   * Returns { allowed: boolean, current: number, limit: number }
   */
  async checkGoogleApiLimit() {
    const dateKey = this.getTodayDateKey();
    const limit = parseInt(await this.getConfigCached('google_api_daily_limit', String(TravelDatabase.DEFAULT_GOOGLE_API_DAILY_LIMIT)));

    try {
      const result = await this.pool.query(
        'SELECT call_count FROM google_api_usage WHERE date_key = $1',
        [dateKey]
      );

      const current = result.rows.length > 0 ? parseInt(result.rows[0].call_count) : 0;
      return {
        allowed: current < limit,
        current,
        limit,
      };
    } catch (error) {
      // If table doesn't exist, allow the call (will be created on increment)
      if (error.message.includes('relation "google_api_usage" does not exist')) {
        return { allowed: true, current: 0, limit };
      }
      throw error;
    }
  }

  /**
   * @deprecated Use consumeGoogleApiQuota() instead — this has a TOCTOU race condition
   * Increment the Google API call counter for today
   * Creates the table and/or row if they don't exist
   */
  async incrementGoogleApiCounter() {
    const dateKey = this.getTodayDateKey();

    try {
      // Upsert: insert or increment
      await this.pool.query(`
        INSERT INTO google_api_usage (date_key, call_count, updated_at)
        VALUES ($1, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (date_key) DO UPDATE SET
          call_count = google_api_usage.call_count + 1,
          updated_at = CURRENT_TIMESTAMP
      `, [dateKey]);
    } catch (error) {
      // If table doesn't exist, create it and retry
      if (error.message.includes('relation "google_api_usage" does not exist')) {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS google_api_usage (
            date_key VARCHAR(10) PRIMARY KEY,
            call_count INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        // Retry the insert
        await this.pool.query(`
          INSERT INTO google_api_usage (date_key, call_count, updated_at)
          VALUES ($1, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (date_key) DO UPDATE SET
            call_count = google_api_usage.call_count + 1,
            updated_at = CURRENT_TIMESTAMP
        `, [dateKey]);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get current Google API usage stats
   */
  async getGoogleApiUsage() {
    const dateKey = this.getTodayDateKey();
    const limit = parseInt(await this.getConfigCached('google_api_daily_limit', String(TravelDatabase.DEFAULT_GOOGLE_API_DAILY_LIMIT)));

    try {
      const result = await this.pool.query(
        'SELECT date_key, call_count, updated_at FROM google_api_usage WHERE date_key = $1',
        [dateKey]
      );

      if (result.rows.length === 0) {
        return { date: dateKey, calls: 0, limit, remaining: limit };
      }

      const row = result.rows[0];
      return {
        date: row.date_key,
        calls: parseInt(row.call_count),
        limit,
        remaining: Math.max(0, limit - parseInt(row.call_count)),
      };
    } catch (error) {
      if (error.message.includes('relation "google_api_usage" does not exist')) {
        return { date: dateKey, calls: 0, limit, remaining: limit };
      }
      throw error;
    }
  }

  // =========================================================================
  // Google Places Enrichment
  // =========================================================================

  /**
   * Enrich an OSM POI with Google Places data, creating/updating the mapping.
   * @param {string} osmId - OpenStreetMap POI ID to enrich
   * @returns {Promise<void>} Resolves when enrichment completes or is skipped (cached/quota/not found)
   * @throws {Error} If database queries fail
   */
  async enrichOSMPOI(osmId) {
    await this.ensureGooglePlacesReady();

    if (!this.googlePlaces || !this.googlePlaces.isEnabled()) {
      return;
    }

    try {
      // Get OSM POI data
      const osmResult = await this.pool.query(`
        SELECT
          osm_id,
          poi_type,
          name,
          name_en,
          latitude,
          longitude,
          tags
        FROM osm_pois
        WHERE osm_id = $1
      `, [osmId]);

      if (osmResult.rows.length === 0) {
        return;
      }

      const osmPOI = osmResult.rows[0];

      // Check if already mapped
      const existingMapping = await this.pool.query(`
        SELECT
          google_place_id,
          mapping_status,
          mapped_at
        FROM osm_google_mappings
        WHERE osm_id = $1
      `, [osmId]);

      // Skip if already mapped and active
      if (existingMapping.rows.length > 0) {
        const mapping = existingMapping.rows[0];
        if (mapping.mapping_status === 'active') {
          // Check if cache expired
          const cacheHours = parseInt(await this.getConfigCached('google_places_cache_hours', '168'));
          const hoursSinceMapping = (Date.now() - new Date(mapping.mapped_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceMapping < cacheHours) {
            return; // Still cached
          }
        }
        // Throttle retries for terminal non-match statuses — no point hammering the API
        if (mapping.mapping_status === 'not_found') {
          const daysSinceCheck = (Date.now() - new Date(mapping.mapped_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceCheck < 7) {
            return; // Don't retry yet
          }
        }
      }

      // Atomically consume quota before making API calls
      const quota1 = await this.consumeGoogleApiQuota();
      if (!quota1.allowed) {
        console.error(`Google API daily limit reached (${quota1.current}/${quota1.limit}). Skipping enrichment for OSM ${osmId}`);
        return;
      }

      // Find matching Google Place
      const matchResult = await this.googlePlaces.findMatchingPlace(osmPOI);

      if (!matchResult) {
        // Mark as not_found
        await this.createMapping(osmId, null, {
          mapping_status: 'not_found',
          mapping_notes: 'No matching Google Place found'
        });
        return;
      }

      // Atomically consume quota before details call
      const quota2 = await this.consumeGoogleApiQuota();
      if (!quota2.allowed) {
        console.error(`Google API daily limit reached (${quota2.current}/${quota2.limit}). Skipping details for OSM ${osmId}`);
        await this.createMapping(osmId, null, {
          mapping_status: 'pending',
          mapping_notes: `Rate limit reached before details fetch (place_id: ${matchResult.place_id})`
        });
        return;
      }

      // Get full place details
      const placeDetails = await this.googlePlaces.getPlaceDetails(matchResult.place_id);

      if (!placeDetails) {
        await this.createMapping(osmId, null, {
          mapping_status: 'error',
          mapping_notes: `Failed to retrieve place details (place_id: ${matchResult.place_id})`
        });
        return;
      }

      if (!this.googlePlaces.isPlaceDetailsNameCompatible(osmPOI, placeDetails)) {
        const googleName = placeDetails.displayName?.text || placeDetails.displayName || placeDetails.name || 'unknown';
        await this.createMapping(osmId, null, {
          mapping_status: 'not_found',
          mapping_notes: `Rejected Google Place name mismatch: "${googleName}" (place_id: ${matchResult.place_id})`
        });
        return;
      }

      // Upsert Google Place data
      await this.upsertGooglePlace(placeDetails);

      // Create/update mapping
      const distanceMeters = this.calculateDistance(
        osmPOI.latitude,
        osmPOI.longitude,
        placeDetails.location.latitude,
        placeDetails.location.longitude
      );

      // Safety check: reject if coordinates diverge > 500m (shouldn't happen with
      // locationRestriction=500m in searchText, but guards against API edge cases).
      if (distanceMeters > 500) {
        await this.createMapping(osmId, null, {
          mapping_status: 'not_found',
          mapping_notes: `Candidate too far away (${Math.round(distanceMeters)}m > 500m limit)`
        });
        return;
      }

      await this.createMapping(osmId, placeDetails.id, {
        match_confidence: matchResult.rating ? 0.95 : 0.80, // Higher if has rating
        match_method: 'nearby_search',
        match_distance_meters: Math.round(distanceMeters),
        mapping_status: 'active'
      });

      console.error(`✓ Enriched OSM POI ${osmId} with Google Place ${placeDetails.id}`);

    } catch (error) {
      console.error(`Error enriching OSM POI ${osmId}:`, error.message);
      telemetry.captureException(error, { context: 'enrich_osm_poi', osmId });
      await this.createMapping(osmId, null, {
        mapping_status: 'error',
        mapping_notes: error.message
      });
    }
  }

  /**
   * Insert or update Google Place data
   */
  async upsertGooglePlace(placeData) {
    const cacheHours = parseInt(await this.getConfigCached('google_places_cache_hours', '168'));
    const cacheExpiresAt = new Date(Date.now() + cacheHours * 60 * 60 * 1000);

    // Extract and format reviews (up to 5)
    const reviews = placeData.reviews ? placeData.reviews.slice(0, 5).map(r => ({
      author: r.authorAttribution?.displayName,
      authorUri: r.authorAttribution?.uri,
      rating: r.rating,
      text: r.text?.text || r.originalText?.text,
      language: r.text?.languageCode || r.originalText?.languageCode,
      publishTime: r.publishTime,
      relativeTime: r.relativePublishTimeDescription,
    })) : null;

    await this.pool.query(`
      INSERT INTO google_places (
        google_place_id,
        name,
        display_name,
        location,
        latitude,
        longitude,
        types,
        primary_type,
        primary_type_display,
        formatted_address,
        short_formatted_address,
        international_phone,
        national_phone,
        website_uri,
        google_maps_uri,
        rating,
        user_rating_count,
        reviews,
        price_level,
        business_status,
        utc_offset_minutes,
        editorial_summary,
        opening_hours,
        current_opening_hours,
        photos,
        service_options,
        accessibility,
        amenities,
        plus_code,
        viewport,
        address_components,
        enriched_at,
        cache_expires_at,
        raw_response
      ) VALUES (
        $1, $2, $3,
        ST_SetSRID(ST_MakePoint($5, $4), 4326),
        $4, $5,
        $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
        $28, $29, $30,
        $31, $32, $33
      )
      ON CONFLICT (google_place_id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        location = EXCLUDED.location,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        types = EXCLUDED.types,
        primary_type = EXCLUDED.primary_type,
        primary_type_display = EXCLUDED.primary_type_display,
        formatted_address = EXCLUDED.formatted_address,
        short_formatted_address = EXCLUDED.short_formatted_address,
        international_phone = EXCLUDED.international_phone,
        national_phone = EXCLUDED.national_phone,
        website_uri = EXCLUDED.website_uri,
        google_maps_uri = EXCLUDED.google_maps_uri,
        rating = EXCLUDED.rating,
        user_rating_count = EXCLUDED.user_rating_count,
        reviews = EXCLUDED.reviews,
        price_level = EXCLUDED.price_level,
        business_status = EXCLUDED.business_status,
        utc_offset_minutes = EXCLUDED.utc_offset_minutes,
        editorial_summary = EXCLUDED.editorial_summary,
        opening_hours = EXCLUDED.opening_hours,
        current_opening_hours = EXCLUDED.current_opening_hours,
        photos = EXCLUDED.photos,
        service_options = EXCLUDED.service_options,
        accessibility = EXCLUDED.accessibility,
        amenities = EXCLUDED.amenities,
        plus_code = EXCLUDED.plus_code,
        viewport = EXCLUDED.viewport,
        address_components = EXCLUDED.address_components,
        enriched_at = EXCLUDED.enriched_at,
        cache_expires_at = EXCLUDED.cache_expires_at,
        raw_response = EXCLUDED.raw_response
    `, [
      placeData.id,
      placeData.displayName?.text || placeData.displayName || '',
      JSON.stringify(placeData.displayName),
      placeData.location?.latitude || null,
      placeData.location?.longitude || null,
      placeData.types || [],
      placeData.primaryType || null,
      placeData.primaryTypeDisplayName?.text || null,
      placeData.formattedAddress || null,
      placeData.shortFormattedAddress || null,
      placeData.internationalPhoneNumber || null,
      placeData.nationalPhoneNumber || null,
      placeData.websiteUri || null,
      placeData.googleMapsUri || null,
      placeData.rating || null,
      placeData.userRatingCount || null,
      JSON.stringify(reviews),
      placeData.priceLevel || null,
      placeData.businessStatus || null,
      placeData.utcOffsetMinutes || null,
      placeData.editorialSummary?.text || null,
      JSON.stringify(placeData.regularOpeningHours || null),
      JSON.stringify(placeData.currentOpeningHours || null),
      JSON.stringify(await this.resolvePhotoUrls(placeData.photos)),
      JSON.stringify({
        delivery: placeData.delivery,
        dineIn: placeData.dineIn,
        takeout: placeData.takeout,
        curbsidePickup: placeData.curbsidePickup,
        reservable: placeData.reservable
      }),
      JSON.stringify(placeData.accessibilityOptions || null),
      JSON.stringify({
        outdoorSeating: placeData.outdoorSeating,
        liveMusic: placeData.liveMusic,
        menuForChildren: placeData.menuForChildren,
        servesBeer: placeData.servesBeer,
        servesWine: placeData.servesWine,
        servesCocktails: placeData.servesCocktails,
        servesBreakfast: placeData.servesBreakfast,
        servesBrunch: placeData.servesBrunch,
        servesLunch: placeData.servesLunch,
        servesDinner: placeData.servesDinner,
        servesCoffee: placeData.servesCoffee,
        servesDessert: placeData.servesDessert,
        servesVegetarianFood: placeData.servesVegetarianFood,
        goodForChildren: placeData.goodForChildren,
        goodForGroups: placeData.goodForGroups,
        goodForWatchingSports: placeData.goodForWatchingSports,
        allowsDogs: placeData.allowsDogs,
        restroom: placeData.restroom,
        parkingOptions: placeData.parkingOptions,
        paymentOptions: placeData.paymentOptions
      }),
      JSON.stringify(placeData.plusCode || null),
      JSON.stringify(placeData.viewport || null),
      JSON.stringify(placeData.addressComponents || null),
      new Date(),
      cacheExpiresAt,
      JSON.stringify(placeData)
    ]);
  }

  /**
   * Create or update mapping between OSM POI and Google Place
   */
  async createMapping(osmId, googlePlaceId, metadata = {}) {
    const {
      match_confidence = null,
      match_method = null,
      match_distance_meters = null,
      mapping_status = 'active',
      mapping_notes = null
    } = metadata;

    if (!googlePlaceId) {
      // Insert mapping with NULL google_place_id for non-active statuses
      if (['not_found', 'error', 'pending'].includes(mapping_status)) {
        await this.pool.query(`
          INSERT INTO osm_google_mappings (
            osm_id,
            google_place_id,
            mapping_status,
            mapping_notes,
            mapped_at
          ) VALUES ($1, NULL, $2, $3, CURRENT_TIMESTAMP)
          ON CONFLICT (osm_id) DO UPDATE SET
            mapping_status = EXCLUDED.mapping_status,
            mapping_notes = EXCLUDED.mapping_notes,
            mapped_at = CURRENT_TIMESTAMP
        `, [osmId, mapping_status, mapping_notes]);
      }
      return;
    }

    await this.pool.query(`
      INSERT INTO osm_google_mappings (
        osm_id,
        google_place_id,
        match_confidence,
        match_method,
        match_distance_meters,
        mapping_status,
        mapping_notes,
        mapped_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (osm_id) DO UPDATE SET
        google_place_id = EXCLUDED.google_place_id,
        match_confidence = EXCLUDED.match_confidence,
        match_method = EXCLUDED.match_method,
        match_distance_meters = EXCLUDED.match_distance_meters,
        mapping_status = EXCLUDED.mapping_status,
        mapping_notes = EXCLUDED.mapping_notes,
        mapped_at = CURRENT_TIMESTAMP
    `, [
      osmId,
      googlePlaceId,
      match_confidence,
      match_method,
      match_distance_meters,
      mapping_status,
      mapping_notes
    ]);
  }

  /**
   * Calculate distance between two coordinates in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = EARTH_RADIUS_METERS;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Batch enrich top POIs from search results
   */
  async batchEnrichPOIs(osmIds, maxConcurrent = 3) {
    if (!Array.isArray(osmIds) || osmIds.length === 0) {
      return;
    }

    // Skip any POI already being enriched (lock held by getPOIDetails stale handler or null handler).
    // enrichOSMPOI itself enforces skip-if-active and daily quota limits.
    const toEnrich = osmIds.filter(id => !this._enrichmentLock.has(id));

    for (let i = 0; i < toEnrich.length; i += maxConcurrent) {
      const batch = toEnrich.slice(i, i + maxConcurrent);
      await Promise.all(batch.map(osmId => this.enrichOSMPOI(osmId).catch(err => {
        console.error(`Background enrichment error for OSM ${osmId}:`, err.message);
        telemetry.captureException(err, { context: 'batch_enrichment', osmId });
      })));
    }
  }

  /**
   * Find stale Google Places cache entries that need refreshing
   */
  async getStaleGooglePlacesEntries(limit = 100) {
    const cacheHours = parseInt(await this.getConfigCached('google_places_cache_hours') || '168');
    const result = await this.pool.query(`
      SELECT m.osm_id, m.google_place_id
      FROM osm_google_mappings m
      WHERE m.mapping_status = 'active'
        AND m.google_place_id IS NOT NULL
        AND m.updated_at < NOW() - INTERVAL '1 hour' * $1
      ORDER BY m.updated_at ASC
      LIMIT $2
    `, [cacheHours, limit]);
    return result.rows;
  }

  // =========================================================================
  // Import Tracking
  // =========================================================================

  async startImport(importType, options = {}) {
    const {
      sourceFile = null,
      sourceUrl = null,
      sourceDate = null,
      regionName = null,
      metadata = null,
    } = options;

    const result = await this.pool.query(`
      INSERT INTO import_log (
        import_type,
        source_file,
        source_url,
        source_date,
        region_name,
        metadata,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'running')
      RETURNING id
    `, [
      importType,
      sourceFile,
      sourceUrl,
      sourceDate,
      regionName,
      metadata ? JSON.stringify(metadata) : null,
    ]);

    return result.rows[0].id;
  }

  async completeImport(importId, recordsImported) {
    await this.pool.query(`
      UPDATE import_log
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          records_imported = $2
      WHERE id = $1
    `, [importId, recordsImported]);
  }

  async failImport(importId, errorMessage) {
    await this.pool.query(`
      UPDATE import_log
      SET status = 'failed',
          completed_at = CURRENT_TIMESTAMP,
          error_message = $2
      WHERE id = $1
    `, [importId, errorMessage]);
  }

  async getImportHistory(limit = 20) {
    const result = await this.pool.query(`
      SELECT
        id,
        import_type,
        source_file,
        source_url,
        source_date,
        region_name,
        started_at,
        completed_at,
        status,
        records_imported,
        error_message,
        metadata
      FROM import_log
      ORDER BY started_at DESC
      LIMIT $1
    `, [Math.min(limit, SEARCH_LIMIT_MAX)]);

    return result.rows;
  }

  // =========================================================================
  // Statistics
  // =========================================================================

  /**
   * Get aggregate database statistics including counts, breakdowns, and enrichment status.
   * @returns {Promise<Object>} Stats object with countries, cities, pois, hotels, regions counts, pois_by_type, pois_by_country, recent_imports, and enrichment metrics
   */
  async getStats() {
    const [countries, cities, pois, hotels, regions, poisByType, poisByCountry, recentImports, enrichmentStats, mappingStats] = await Promise.all([
      this.pool.query('SELECT COUNT(*) FROM geonames_countries'),
      this.pool.query('SELECT COUNT(*) FROM geonames_cities'),
      this.pool.query('SELECT COUNT(*) FROM osm_pois'),
      this.pool.query("SELECT COUNT(*) FROM osm_pois WHERE poi_type = 'hotel'"),
      this.pool.query('SELECT COUNT(*) FROM regions'),
      this.pool.query(`SELECT poi_type, COUNT(*) as count FROM osm_pois GROUP BY poi_type ORDER BY count DESC`),
      this.pool.query(`SELECT c.country_code, COUNT(*) as count FROM osm_pois p JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id GROUP BY c.country_code ORDER BY count DESC`),
      this.pool.query(`SELECT import_type, region_name, source_file, completed_at, records_imported FROM import_log WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 10`),
      this.pool.query(`SELECT COUNT(*) as total_enriched FROM osm_google_mappings WHERE google_place_id IS NOT NULL AND mapping_status = 'active'`),
      this.pool.query(`SELECT mapping_status, COUNT(*) as count FROM osm_google_mappings GROUP BY mapping_status`),
    ]);

    const stats = {
      countries: parseInt(countries.rows[0].count),
      cities: parseInt(cities.rows[0].count),
      pois: parseInt(pois.rows[0].count),
      hotels: parseInt(hotels.rows[0].count),
      regions: parseInt(regions.rows[0].count),
      pois_by_type: poisByType.rows,
      pois_by_country: poisByCountry.rows,
      recent_imports: recentImports.rows,
      google_places_enriched: parseInt(enrichmentStats.rows[0].total_enriched),
      enrichment_by_status: mappingStats.rows,
    };

    return removeNullFields(stats);
  }

  // =============================================================================
  // Authentication Methods
  // =============================================================================

  /**
   * Get user by API token
   * Returns user with their config if token is valid, null otherwise
   */
  async getUserByToken(token) {
    if (!token) return null;

    const result = await this.pool.query(`
      SELECT
        u.id, u.google_id, u.email, u.name, u.picture_url,
        u.created_at, u.last_login_at,
        t.id as token_id,
        uc.key as config_key, uc.value as config_value
      FROM user_tokens t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN user_config uc ON uc.user_id = u.id
      WHERE t.token = $1
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > NOW())
    `, [token]);

    if (result.rows.length === 0) return null;

    const firstRow = result.rows[0];
    const user = {
      id: firstRow.id,
      google_id: firstRow.google_id,
      email: firstRow.email,
      name: firstRow.name,
      picture_url: firstRow.picture_url,
      created_at: firstRow.created_at,
      last_login_at: firstRow.last_login_at,
      config: {},
    };

    // Aggregate config rows from the LEFT JOIN
    for (const row of result.rows) {
      if (row.config_key) {
        user.config[row.config_key] = row.config_value;
      }
    }

    // Update last_used_at for the token (fire-and-forget)
    this.pool.query(`
      UPDATE user_tokens SET last_used_at = NOW() WHERE id = $1
    `, [firstRow.token_id]).catch(() => {});

    return user;
  }

  /**
   * Get or create user by Google OAuth info
   * Auto-provisions new users and updates existing ones on each login
   * Returns user with their config loaded
   *
   * Handles two conflict scenarios:
   * 1. User exists with same google_id (ON CONFLICT) - updates their info
   * 2. User exists with same email but no google_id (exception) - links google_id
   */
  async upsertGoogleUser(googleId, email, name, pictureUrl) {
    let result;
    try {
      // Try insert with ON CONFLICT for google_id (common case)
      result = await this.pool.query(`
        INSERT INTO users (google_id, email, name, picture_url, last_login_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (google_id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          picture_url = EXCLUDED.picture_url,
          last_login_at = NOW()
        RETURNING id, google_id, email, name, picture_url, created_at, last_login_at
      `, [googleId, email, name, pictureUrl]);
    } catch (err) {
      // Handle email conflict: user exists with same email but different/no google_id
      // This happens when a user was created via API token before using OAuth
      if (err.code === '23505' && err.constraint === 'users_email_key') {
        result = await this.pool.query(`
          UPDATE users SET
            google_id = $1,
            name = $3,
            picture_url = $4,
            last_login_at = NOW()
          WHERE email = $2
          RETURNING id, google_id, email, name, picture_url, created_at, last_login_at
        `, [googleId, email, name, pictureUrl]);
      } else {
        throw err;
      }
    }

    const user = result.rows[0];

    // Load user config
    const configResult = await this.pool.query(
      'SELECT key, value FROM user_config WHERE user_id = $1',
      [user.id]
    );
    user.config = {};
    for (const row of configResult.rows) {
      user.config[row.key] = row.value;
    }

    return user;
  }

  /**
   * Create a new API token for a user
   */
  async createUserToken(userId, tokenName = null) {
    // Generate secure random token
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    const result = await this.pool.query(`
      INSERT INTO user_tokens (user_id, token, name)
      VALUES ($1, $2, $3)
      RETURNING id, token, name, created_at
    `, [userId, token, tokenName]);

    return result.rows[0];
  }

  /**
   * Get user config value
   */
  async getUserConfig(userId, key) {
    const result = await this.pool.query(`
      SELECT value FROM user_config WHERE user_id = $1 AND key = $2
    `, [userId, key]);

    return result.rows.length > 0 ? result.rows[0].value : null;
  }

  /**
   * Set user config value
   */
  async setUserConfig(userId, key, value) {
    await this.pool.query(`
      INSERT INTO user_config (user_id, key, value)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `, [userId, key, value]);
  }

  /**
   * Check if user has a specific permission/config
   */
  async userHasConfig(userId, key, expectedValue = null) {
    const value = await this.getUserConfig(userId, key);
    if (expectedValue === null) {
      return value !== null;
    }
    return value === expectedValue;
  }

  /**
   * List all tokens for a user
   */
  async listUserTokens(userId) {
    const result = await this.pool.query(`
      SELECT id, name, created_at, expires_at, last_used_at,
             CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                  WHEN expires_at IS NOT NULL AND expires_at < NOW() THEN 'expired'
                  ELSE 'active' END as status
      FROM user_tokens
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]);

    return result.rows;
  }

  /**
   * Revoke a token
   */
  async revokeToken(tokenId, userId) {
    await this.pool.query(`
      UPDATE user_tokens SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2
    `, [tokenId, userId]);
  }

  // =========================================================================
  // User Favorites
  // =========================================================================

  /**
   * Add a POI to user's favorites
   * @param {number} userId - User ID
   * @param {number} osmId - OSM ID of the POI
   * @param {string} notes - Optional notes about the favorite
   * @returns {object} - The created favorite record with POI details
   */
  async addFavorite(userId, osmId, notes = null) {
    // Verify POI exists first (don't rely solely on FK constraint)
    const poiCheck = await this.pool.query(
      'SELECT 1 FROM osm_pois WHERE osm_id = $1',
      [osmId]
    );
    if (poiCheck.rows.length === 0) {
      return false; // POI not found
    }

    // Insert the favorite
    await this.pool.query(`
      INSERT INTO user_favorites (user_id, poi_osm_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, poi_osm_id) DO UPDATE SET notes = EXCLUDED.notes
    `, [userId, osmId, notes]);

    return true;
  }

  /**
   * Remove a POI from user's favorites
   * @param {number} userId - User ID
   * @param {number} osmId - OSM ID of the POI
   * @returns {boolean} - True if a favorite was removed
   */
  async removeFavorite(userId, osmId) {
    const result = await this.pool.query(`
      DELETE FROM user_favorites
      WHERE user_id = $1 AND poi_osm_id = $2
    `, [userId, osmId]);

    return result.rowCount > 0;
  }

  /**
   * Check if a POI is in user's favorites
   * @param {number} userId - User ID
   * @param {number} osmId - OSM ID of the POI
   * @returns {boolean}
   */
  async isFavorite(userId, osmId) {
    const result = await this.pool.query(`
      SELECT 1 FROM user_favorites WHERE user_id = $1 AND poi_osm_id = $2
    `, [userId, osmId]);

    return result.rows.length > 0;
  }

  /**
   * List user's favorites with optional filters
   * @param {number} userId - User ID
   * @param {object} options - Filter options
   * @param {string} options.cityName - Filter by city name
   * @param {string} options.countryCode - Filter by country code
   * @param {string} options.state - Filter by state/province
   * @param {number} options.latitude - Center latitude for radius search
   * @param {number} options.longitude - Center longitude for radius search
   * @param {number} options.radiusKm - Radius in km (default 50)
   * @param {string[]} options.poiTypes - Filter by POI types (e.g., ['restaurant', 'hotel'])
   * @param {number} options.limit - Max results (default 100)
   * @returns {Array} - Favorites with full POI details
   */
  async listFavorites(userId, options = {}) {
    const {
      cityName,
      countryCode,
      state,
      latitude,
      longitude,
      radiusKm = 50,
      poiTypes,
      limit = 100,
    } = options;

    // Debug logging
    const typeDesc = poiTypes ? poiTypes.join(',') : 'all';
    console.error(`[listFavorites] userId=${userId}, city=${cityName}, country=${countryCode}, state=${state}, lat=${latitude}, lon=${longitude}, radius=${radiusKm}km, types=${typeDesc}, limit=${limit}`);

    const conditions = ['f.user_id = $1'];
    const params = [userId];
    let paramIndex = 2;

    // Location filters
    if (latitude !== undefined && longitude !== undefined) {
      // Radius search around coordinates
      conditions.push(`ST_DWithin(
        e.osm_location::geography,
        ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
        $${paramIndex + 2}
      )`);
      params.push(longitude, latitude, radiusKm * 1000); // Convert km to meters
      paramIndex += 3;
    } else if (cityName && countryCode) {
      // City-based filter - first find the city, then filter by proximity
      const escapedCity = cityName.replace(/[%_\\]/g, '\\$&');
      conditions.push(`e.city ILIKE $${paramIndex} AND e.country_code = $${paramIndex + 1}`);
      params.push(`%${escapedCity}%`, countryCode);
      paramIndex += 2;

      if (state) {
        // Get admin1_code from the state name or code
        conditions.push(`EXISTS (
          SELECT 1 FROM geonames_cities gc
          JOIN geonames_admin1_codes a1 ON gc.country_code = a1.country_code AND gc.admin1_code = a1.admin1_code
          WHERE gc.geoname_id = e.city_geoname_id
          AND (a1.admin1_code = $${paramIndex} OR a1.name ILIKE $${paramIndex})
        )`);
        params.push(state);
        paramIndex += 1;
      }
    } else if (countryCode) {
      conditions.push(`e.country_code = $${paramIndex}`);
      params.push(countryCode);
      paramIndex += 1;
    }

    // POI type filter
    if (poiTypes && poiTypes.length > 0) {
      conditions.push(`e.poi_type = ANY($${paramIndex})`);
      params.push(poiTypes);
      paramIndex += 1;
    }

    // Build query with distance calculation if using coordinates
    // Use same field names as search results: is_favorite, favorite_since, favorite_notes
    let selectFields = `
      TRUE as is_favorite,
      f.created_at as favorite_since,
      f.notes as favorite_notes,
      e.*
    `;

    if (latitude !== undefined && longitude !== undefined) {
      selectFields += `,
        ROUND(ST_Distance(
          e.osm_location::geography,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
        )::numeric, 0) as distance_meters
      `;
    }

    const orderBy = latitude !== undefined && longitude !== undefined
      ? 'ORDER BY distance_meters ASC'
      : 'ORDER BY f.created_at DESC';

    const query = `
      SELECT ${selectFields}
      FROM user_favorites f
      JOIN enriched_pois e ON f.poi_osm_id = e.osm_id
      WHERE ${conditions.join(' AND ')}
      ${orderBy}
      LIMIT $${paramIndex}
    `;
    params.push(Math.min(limit, SEARCH_LIMIT_MAX));

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  // =========================================================================
  // Web Frontend API Methods
  // =========================================================================

  /**
   * List countries that have both cities AND POIs in the database.
   * Used by the country dropdown on the web frontend.
   * Cached for 1 hour since this data only changes on import.
   * @returns {Array<{code: string, name: string, continent: string}>}
   */
  async listCountriesWithData() {
    const now = Date.now();
    if (this._countriesCache && this._countriesCacheExpiry > now) {
      return this._countriesCache;
    }

    const result = await this.pool.query(`
      SELECT co.iso_alpha2 as code, co.country as name, co.continent
      FROM geonames_countries co
      WHERE EXISTS (
        SELECT 1 FROM geonames_cities c
        WHERE c.country_code = co.iso_alpha2
        AND EXISTS (SELECT 1 FROM osm_pois p WHERE p.nearest_city_id = c.geoname_id)
      )
      ORDER BY co.country
    `);

    this._countriesCache = result.rows;
    this._countriesCacheExpiry = now + COUNTRIES_CACHE_TTL_MS;
    return result.rows;
  }

  /**
   * Get the top cities in a country that have accommodation POIs.
   * Used by the homepage discover feature.
   * @param {string} countryCode - ISO alpha2 country code
   * @param {string[]} poiTypes - POI types to check for (e.g., accommodation types)
   * @param {number} [limit=5] - Max cities to return
   * @returns {Array<{geoname_id: number, name: string, country_code: string, population: number, latitude: number, longitude: number}>}
   */
  async getTopCitiesWithHotels(countryCode, poiTypes, limit = 5) {
    const result = await this.pool.query(`
      SELECT c.geoname_id, c.name, c.country_code, c.population,
             ST_Y(c.location) AS latitude, ST_X(c.location) AS longitude
      FROM geonames_cities c
      WHERE c.country_code = $1
        AND EXISTS (
          SELECT 1 FROM osm_pois p
          WHERE p.nearest_city_id = c.geoname_id
            AND p.poi_type = ANY($2)
        )
      ORDER BY c.population DESC NULLS LAST
      LIMIT $3
    `, [countryCode.toUpperCase(), poiTypes, limit]);
    return result.rows;
  }

  /**
   * Get homepage discover data: random country, top city, 5 hotels.
   * Caches per-country results for 15 minutes (without favorite status).
   * @param {string[]} accommodationTypes - POI types to include
   * @param {number|null} [userId=null] - User ID for favorite status
   * @returns {Promise<{country: object, city: object, hotels: Array}|null>}
   */
  async getHomepageDiscover(accommodationTypes, userId = null) {
    const countries = await this.listCountriesWithData();
    if (!countries || countries.length === 0) return null;

    const country = countries[Math.floor(Math.random() * countries.length)];

    // Check per-country cache
    if (!this._homepageCache) this._homepageCache = new Map();
    const now = Date.now();
    const cached = this._homepageCache.get(country.code);
    if (cached && cached.expiry > now) {
      const hotels = userId
        ? await this.addFavoriteStatus([...cached.data.hotels], userId)
        : cached.data.hotels;
      return { ...cached.data, hotels };
    }

    const cities = await this.getTopCitiesWithHotels(country.code, accommodationTypes, 5);
    if (cities.length === 0) {
      // This country has no cities with hotels — evict and skip
      return null;
    }

    const city = cities[Math.floor(Math.random() * cities.length)];
    const radius = this.getRadiusForPopulation(city.population || 100000);
    // Fetch hotels without userId so cache is user-independent
    const hotels = await this.searchPOIsNearCoordinates(
      city.latitude, city.longitude, radius, accommodationTypes, 5, null
    );

    const payload = {
      country: { code: country.code, name: country.name },
      city: { name: city.name, population: city.population },
      hotels,
    };

    // Evict expired entries and cap cache size
    for (const [key, val] of this._homepageCache) {
      if (val.expiry <= now) this._homepageCache.delete(key);
    }
    if (this._homepageCache.size >= HOMEPAGE_CACHE_MAX_SIZE) {
      const oldest = [...this._homepageCache.entries()].sort((a, b) => a[1].expiry - b[1].expiry)[0];
      if (oldest) this._homepageCache.delete(oldest[0]);
    }
    this._homepageCache.set(country.code, { data: payload, expiry: now + HOMEPAGE_CACHE_TTL_MS });

    if (userId) {
      return { ...payload, hotels: await this.addFavoriteStatus([...hotels], userId) };
    }
    return payload;
  }

  /**
   * List states/provinces for a country.
   * Used by the state dropdown on the web frontend.
   * @param {string} countryCode - ISO alpha2 country code
   * @returns {Array<{code: string, name: string, ascii_name: string}>}
   */
  async listStatesForCountry(countryCode) {
    const result = await this.pool.query(`
      SELECT DISTINCT a.admin1_code as code, a.name, a.ascii_name
      FROM geonames_admin1_codes a
      WHERE a.country_code = $1
      ORDER BY a.name
    `, [countryCode.toUpperCase()]);
    return result.rows;
  }

  /**
   * Fast autocomplete search for POI names (type-ahead).
   * Returns minimal fields for quick display in a dropdown.
   * @param {string} query - Search string (min 2 chars recommended)
   * @param {object} options
   * @param {string} [options.countryCode] - Filter by country
   * @param {number} [options.cityGeonameId] - Filter by city geoname_id
   * @param {string} [options.poiType] - Filter by POI type
   * @param {number} [options.limit=10] - Max results
   * @returns {Array<{osm_id: number, name: string, poi_type: string, google_rating: number, city: string, country_code: string}>}
   */
  async autocompleteSearch(query, options = {}) {
    const { countryCode, cityGeonameId, poiType, poiTypes, limit = 10 } = options;

    const conditions = ['p.name IS NOT NULL'];
    const params = [];

    // Name search condition (escape ILIKE wildcards in user input)
    const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
    params.push(`%${escapedQuery}%`);
    conditions.push(`(p.name ILIKE $${params.length} OR p.name_en ILIKE $${params.length} OR g.name ILIKE $${params.length})`);

    if (countryCode) {
      params.push(countryCode.toUpperCase());
      conditions.push(`c.country_code = $${params.length}`);
    }

    if (cityGeonameId) {
      params.push(cityGeonameId);
      conditions.push(`p.nearest_city_id = $${params.length}`);
    }

    // Support both single type and array of types
    const typeFilter = poiTypes || (poiType ? [poiType] : null);
    if (typeFilter && typeFilter.length > 0) {
      params.push(typeFilter);
      conditions.push(`p.poi_type = ANY($${params.length})`);
    }

    params.push(Math.min(limit, 50));

    const result = await this.pool.query(`
      SELECT
        p.osm_id,
        COALESCE(g.name, p.name) as name,
        p.poi_type,
        p.latitude,
        p.longitude,
        g.rating as google_rating,
        g.user_rating_count as google_review_count,
        g.photos->0->>'url_thumbnail' as photo_url,
        c.name as city,
        c.country_code
      FROM osm_pois p
      LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
      LEFT JOIN osm_google_mappings m ON p.osm_id = m.osm_id AND m.mapping_status = 'active'
      LEFT JOIN google_places g ON m.google_place_id = g.google_place_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY g.rating DESC NULLS LAST, p.name
      LIMIT $${params.length}
    `, params);

    return result.rows;
  }

  async updateFavoriteNotes(userId, osmId, notes = null) {
    const result = await this.pool.query(`
      UPDATE user_favorites
      SET notes = $3
      WHERE user_id = $1 AND poi_osm_id = $2
    `, [userId, osmId, notes]);

    return result.rowCount > 0;
  }
}

export default TravelDatabase;
