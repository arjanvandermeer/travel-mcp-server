import pg from 'pg';
import crypto from 'crypto';
import { GooglePlacesClient } from './google-places.js';
import * as telemetry from './telemetry.js';
import dotenv from 'dotenv';
import { CONFIG_CACHE_TTL_MS, DB_STATEMENT_TIMEOUT_MS, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, SEARCH_RADIUS_DEFAULT_KM, SEARCH_RADIUS_MAX_KM, EARTH_RADIUS_METERS, GOOGLE_PLACES_DAILY_LIMIT_DEFAULT } from './config.js';
import { addResourceUris, removeNullFields } from './response-utils.js';
import { databaseUserMethods } from './database-user-methods.js';
import { databaseImportMethods } from './database-import-methods.js';
import { coerceOpenAt, isPoiOpenAt } from './lib/opening-hours.js';
import { sanitizeHttpUrl, sanitizePoiExternalUrls, sanitizePoiExternalUrlsArray } from './url-utils.js';
import { createOpenRouterPlaceSummarizer, fetchHomepageHarvest } from './openrouter-place-summaries.js';

// Load environment variables (using dotenv 16.x to avoid verbose output that breaks MCP)
dotenv.config();

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL environment variable is required in production');
}
const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://<user>:<password>@localhost:5432/travel';
const HOMEPAGE_HARVEST_REFRESH_DAYS_DEFAULT = 180;
const HOMEPAGE_HARVEST_ERROR_RETRY_DAYS = 1;

function clampPositiveInteger(value, defaultValue, maxValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.min(Math.floor(parsed), maxValue);
}

function clampNonNegativeInteger(value, defaultValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultValue;
  return Math.floor(parsed);
}

function getEnrichmentLockKey(osmId) {
  return String(osmId);
}

async function recordGoogleEnrichmentSkipSpan(osmId, reason, attributes = {}) {
  try {
    await telemetry.withSpan(
      'Google Places enrichment skipped',
      'app.google_places.enrichment',
      {
        provider: 'google_places',
        source: 'enrichment',
        outcome: 'skipped',
        status: 'skipped',
        skip_reason: reason,
        osm_id: osmId === undefined || osmId === null ? null : String(osmId),
        ...attributes,
      },
      async (span) => {
        telemetry.setSpanAttributes(span, {
          'enrichment.skipped': true,
          'enrichment.skip_reason': reason,
        });
      },
      { forceTransaction: true },
    );
  } catch (error) {
    console.error(`[Telemetry] Failed to record Google enrichment skip span: ${error.message}`);
  }
}

function clampSearchRadiusKm(value, defaultValue = SEARCH_RADIUS_DEFAULT_KM) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(Math.max(parsed, 0.1), SEARCH_RADIUS_MAX_KM);
}

const GOOGLE_PRICE_LEVELS = {
  free: 'PRICE_LEVEL_FREE',
  0: 'PRICE_LEVEL_FREE',
  inexpensive: 'PRICE_LEVEL_INEXPENSIVE',
  cheap: 'PRICE_LEVEL_INEXPENSIVE',
  1: 'PRICE_LEVEL_INEXPENSIVE',
  moderate: 'PRICE_LEVEL_MODERATE',
  midrange: 'PRICE_LEVEL_MODERATE',
  2: 'PRICE_LEVEL_MODERATE',
  expensive: 'PRICE_LEVEL_EXPENSIVE',
  3: 'PRICE_LEVEL_EXPENSIVE',
  very_expensive: 'PRICE_LEVEL_VERY_EXPENSIVE',
  luxury: 'PRICE_LEVEL_VERY_EXPENSIVE',
  4: 'PRICE_LEVEL_VERY_EXPENSIVE',
};

const DINING_POI_TYPES = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'];
const ACCOMMODATION_POI_TYPES = ['hotel', 'hostel', 'guest_house', 'motel', 'resort', 'apartment', 'camp_site', 'bed_and_breakfast', 'chalet'];
const HOTEL_QUALITY_RESTAURANT_RADIUS_METERS = 1500;
const HOTEL_QUALITY_AMENITY_KEYS = {
  wifi: ['internet_access'],
  pool: ['swimming_pool'],
  parking: ['parking'],
  breakfast: ['breakfast'],
  air_conditioning: ['air_conditioning'],
  pet_friendly: ['pets'],
  restaurant: ['restaurant'],
  spa: ['spa'],
  gym: ['fitness_centre'],
  bar: ['bar'],
  elevator: ['elevator'],
  wheelchair_access: ['wheelchair'],
};

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

const PENDING_ENRICHMENT_STALE_MS = 5 * 60 * 1000;
const PENDING_ENRICHMENT_RESTART_COOLDOWN_MS = 5 * 60 * 1000;
const GOOGLE_QUOTA_RETRY_BUFFER_MS = 5 * 60 * 1000;
const GOOGLE_ERROR_RETRY_MS = 60 * 60 * 1000;
const GOOGLE_NOT_FOUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_ACTIVE_REFRESH_MS = 180 * 24 * 60 * 60 * 1000;

function getGoogleQuotaExceededMessage(quota) {
  return `Google Places enrichment is paused because the daily API limit has been reached (${quota.current}/${quota.limit}). Try again after the quota resets.`;
}

function nextUtcDayWithBuffer(from = new Date()) {
  return new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate() + 1,
    0,
    0,
    0,
    0
  ) + GOOGLE_QUOTA_RETRY_BUFFER_MS);
}

function retryAtFromNow(delayMs, from = new Date()) {
  return new Date(from.getTime() + delayMs);
}

function isFutureDate(value, now = new Date()) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime();
}

function homepageHarvestRefreshAt(status, refreshDays = HOMEPAGE_HARVEST_REFRESH_DAYS_DEFAULT) {
  const days = status === 'error' || status === 'empty'
    ? HOMEPAGE_HARVEST_ERROR_RETRY_DAYS
    : refreshDays;
  return retryAtFromNow(Math.max(1, days) * 24 * 60 * 60 * 1000);
}

function homepageHarvestContentHash(harvest = {}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      finalUrl: harvest.finalUrl || null,
      title: harvest.title || '',
      metaDescription: harvest.metaDescription || '',
      textContent: harvest.textContent || '',
      imageUrls: harvest.imageUrls || [],
    }))
    .digest('hex');
}

function isPositiveTagValue(value) {
  return value !== undefined && value !== null && value !== false && String(value).toLowerCase() !== 'no';
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
    this.googlePlaces = null; // Initialized explicitly during startup/bootstrap.
    this.googlePlacesReady = null;

    // Config cache: Map<key, { value, expiresAt }>
    this._configCache = new Map();

    // Enrichment dedup lock: Map<osmId, Promise> - prevents duplicate API calls for same POI
    this._enrichmentLock = new Map();
    this._enrichmentLockInfo = new Map();

    // Restart cooldown: Map<osmId, timestamp> - prevents polling from repeatedly
    // re-triggering stale pending enrichments when a background attempt exits quickly.
    this._enrichmentRestartedAt = new Map();
    this._googleMappingScheduleColumnReady = false;
    this._aiSummaryColumnsReady = false;
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
    if (!this.googlePlacesReady || !this.googlePlaces) {
      await this.initializeGooglePlaces();
      return;
    }
    await this.googlePlacesReady;
  }

  async ensureGoogleMappingScheduleColumn() {
    if (this._googleMappingScheduleColumnReady) return;
    await this.pool.query(`
      ALTER TABLE IF EXISTS osm_google_mappings
      ADD COLUMN IF NOT EXISTS next_enrichment_at TIMESTAMP
    `);
    await this.pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'osm_google_mappings'
            AND column_name = 'next_retry_at'
        ) THEN
          UPDATE osm_google_mappings
          SET next_enrichment_at = COALESCE(next_enrichment_at, next_retry_at)
          WHERE next_retry_at IS NOT NULL;
        END IF;
      END $$
    `);
    await this.pool.query(`
      DROP INDEX IF EXISTS idx_osm_google_mappings_next_retry
    `);
    await this.pool.query(`
      ALTER TABLE IF EXISTS osm_google_mappings
      DROP COLUMN IF EXISTS next_retry_at
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_osm_google_mappings_next_enrichment
      ON osm_google_mappings(next_enrichment_at)
      WHERE next_enrichment_at IS NOT NULL
    `);
    this._googleMappingScheduleColumnReady = true;
  }

  async ensureAiSummaryColumns() {
    if (this._aiSummaryColumnsReady) return;
    await this.pool.query(`
      ALTER TABLE IF EXISTS google_places
      ADD COLUMN IF NOT EXISTS ai_review_summary TEXT,
      ADD COLUMN IF NOT EXISTS ai_review_summary_model VARCHAR(100),
      ADD COLUMN IF NOT EXISTS ai_review_summary_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS ai_review_summary_error TEXT,
      ADD COLUMN IF NOT EXISTS ai_review_summarized_at TIMESTAMP
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS poi_homepage_summaries (
        id BIGSERIAL PRIMARY KEY,
        osm_id BIGINT NOT NULL REFERENCES osm_pois(osm_id) ON DELETE CASCADE,
        original_url VARCHAR(500) NOT NULL,
        summary TEXT,
        summary_model VARCHAR(100),
        summary_status VARCHAR(20),
        summary_error TEXT,
        summarized_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (osm_id, original_url)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_poi_homepage_summaries_osm_id
      ON poi_homepage_summaries(osm_id)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS poi_homepage_harvests (
        id BIGSERIAL PRIMARY KEY,
        osm_id BIGINT NOT NULL REFERENCES osm_pois(osm_id) ON DELETE CASCADE,
        original_url VARCHAR(500) NOT NULL,
        final_url VARCHAR(1000),
        fetch_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        http_status INTEGER,
        content_type VARCHAR(200),
        title TEXT,
        meta_description TEXT,
        text_content TEXT,
        image_urls JSONB DEFAULT '[]'::jsonb,
        content_hash VARCHAR(64),
        fetch_error TEXT,
        fetched_at TIMESTAMP,
        next_fetch_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (osm_id, original_url)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_poi_homepage_harvests_osm_id
      ON poi_homepage_harvests(osm_id)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_poi_homepage_harvests_next_fetch
      ON poi_homepage_harvests(next_fetch_at)
      WHERE next_fetch_at IS NOT NULL
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS enrichment_tasks (
        task_id VARCHAR(120) PRIMARY KEY,
        kind VARCHAR(80) NOT NULL,
        status VARCHAR(30) NOT NULL,
        status_message TEXT,
        current_item VARCHAR(200),
        processed INTEGER DEFAULT 0,
        succeeded INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        total INTEGER DEFAULT 0,
        requested_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        payload JSONB,
        result JSONB
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_enrichment_tasks_kind_status
      ON enrichment_tasks(kind, status, updated_at DESC)
    `);
    this._aiSummaryColumnsReady = true;
  }

  async markGoogleQuotaExceeded(osmId, quota, detail = null) {
    const message = getGoogleQuotaExceededMessage(quota);
    await this.createMapping(osmId, null, {
      mapping_status: 'pending',
      mapping_notes: detail ? `${message} ${detail}` : message,
      next_enrichment_at: nextUtcDayWithBuffer(),
      preserve_mapped_at: true,
    });
    this._enrichmentRestartedAt.delete(getEnrichmentLockKey(osmId));
    return message;
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
        photo_url = sanitizeHttpUrl(firstPhoto.url_thumbnail || firstPhoto.url);
      }
      if (!photo_url && Array.isArray(poi.homepage_image_urls) && poi.homepage_image_urls.length > 0) {
        photo_url = sanitizeHttpUrl(poi.homepage_image_urls[0]);
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
    };

    // Try to get database config (single query instead of separate lookups)
    try {
      const result = await this.pool.query(
        `SELECT key, value FROM app_config WHERE key IN ('sentry_dsn', 'telemetry_enabled', 'telemetry_sample_rate', 'telemetry_environment')`
      );
      const dbConfig = new Map(result.rows.map(r => [r.key, r.value]));

      // Override with database values if present
      const dbSentryDsn = dbConfig.get('sentry_dsn');
      const dbEnabled = dbConfig.get('telemetry_enabled');
      const dbSampleRate = dbConfig.get('telemetry_sample_rate');
      const dbEnvironment = dbConfig.get('telemetry_environment');

      if (dbSentryDsn) config.sentryDsn = dbSentryDsn;
      if (dbEnabled !== undefined) config.enabled = dbEnabled !== 'false';
      if (dbSampleRate) config.sampleRate = parseFloat(dbSampleRate);
      if (dbEnvironment) config.environment = dbEnvironment;
    } catch (_error) {
      // Database config is optional, continue with env vars
    }

    return config;
  }

  async initializeGooglePlaces({ force = false } = {}) {
    if (this.googlePlacesReady && !force) {
      await this.googlePlacesReady;
      return this.googlePlaces;
    }

    if (this.googlePlaces && !force) {
      return this.googlePlaces;
    }

    this.googlePlacesReady = this.initGooglePlaces();
    await this.googlePlacesReady;
    return this.googlePlaces;
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
    const normalizedQuery = hasQuery ? query.trim() : null;
    const effectiveLimit = Math.min(limit, SEARCH_LIMIT_MAX);

    const buildQuery = ({ includeAlternateNames = false } = {}) => {
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

      let queryRankSql = '';

      // Add query filter if provided. Primary names are searched first; alternate
      // names are only used by the caller as a fallback when primary matches are scarce.
      if (hasQuery) {
        const escapedQuery = normalizedQuery.replace(/[%_\\]/g, '\\$&');
        const exactIndex = params.length + 1;
        const prefixIndex = params.length + 2;
        const wordPrefixIndex = params.length + 3;
        const containsIndex = params.length + 4;
        params.push(normalizedQuery, `${escapedQuery}%`, `% ${escapedQuery}%`, `%${escapedQuery}%`);

        const primaryMatch = `(c.name ILIKE $${containsIndex} OR c.ascii_name ILIKE $${containsIndex})`;
        const alternateMatch = `c.alternate_names ILIKE $${containsIndex}`;
        queryText += includeAlternateNames
          ? ` AND (${primaryMatch} OR ${alternateMatch})`
          : ` AND ${primaryMatch}`;

        queryRankSql = `
          CASE
            WHEN lower(c.name) = lower($${exactIndex}) OR lower(c.ascii_name) = lower($${exactIndex}) THEN 0
            WHEN c.name ILIKE $${prefixIndex} OR c.ascii_name ILIKE $${prefixIndex} THEN 1
            WHEN c.name ILIKE $${wordPrefixIndex} OR c.ascii_name ILIKE $${wordPrefixIndex} THEN 2
            ${includeAlternateNames ? `WHEN ${alternateMatch} THEN 3` : ''}
            ELSE 4
          END ASC,`;
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

      // Order by query relevance first, then distance/population.
      if (hasCoords) {
        queryText += ` ORDER BY ${queryRankSql} distance_km ASC, c.population DESC NULLS LAST LIMIT $${params.length + 1}`;
      } else {
        queryText += ` ORDER BY ${queryRankSql} c.population DESC NULLS LAST LIMIT $${params.length + 1}`;
      }
      params.push(effectiveLimit);

      return { queryText, params };
    };

    const primaryQuery = buildQuery({ includeAlternateNames: false });
    let result = await this.pool.query(primaryQuery.queryText, primaryQuery.params);

    if (!hasQuery || result.rows.length >= effectiveLimit) {
      return removeNullFields(result.rows);
    }

    const fallbackQuery = buildQuery({ includeAlternateNames: true });
    result = await this.pool.query(fallbackQuery.queryText, fallbackQuery.params);
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
        g.utc_offset_minutes as google_utc_offset_minutes,
        g.amenities as google_amenities, g.accessibility as google_accessibility,
        g.ai_review_summary,
        h.summary as ai_homepage_summary,
        h.original_url as ai_homepage_url,
        hh.image_urls as homepage_image_urls,
        hh.final_url as homepage_final_url,
        hh.fetch_status as homepage_fetch_status,
        hh.fetched_at as homepage_fetched_at,
        hh.next_fetch_at as homepage_next_fetch_at
      FROM osm_google_mappings m
      JOIN google_places g ON m.google_place_id = g.google_place_id
      LEFT JOIN LATERAL (
        SELECT summary, original_url
        FROM poi_homepage_summaries
        WHERE osm_id = m.osm_id
          AND summary_status IN ('completed', 'complete')
        ORDER BY summarized_at DESC NULLS LAST, updated_at DESC
        LIMIT 1
      ) h ON true
      LEFT JOIN LATERAL (
        SELECT image_urls, final_url, fetch_status, fetched_at, next_fetch_at
        FROM poi_homepage_harvests
        WHERE osm_id = m.osm_id
        ORDER BY fetched_at DESC NULLS LAST, updated_at DESC
        LIMIT 1
      ) hh ON true
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
        google_amenities: g.google_amenities,
        google_accessibility: g.google_accessibility,
        homepage_image_urls: g.homepage_image_urls,
        homepage_final_url: g.homepage_final_url,
        homepage_fetch_status: g.homepage_fetch_status,
        homepage_fetched_at: g.homepage_fetched_at,
        homepage_next_fetch_at: g.homepage_next_fetch_at,
        ai_homepage_summary: g.ai_homepage_summary,
        ai_homepage_url: g.ai_homepage_url,
        ai_review_summary: g.ai_review_summary,
      };
    });
  }

  static extractHotelQualityAmenityKeys(poi) {
    const tags = poi.osm_tags || {};
    const amenities = new Set();

    for (const [label, keys] of Object.entries(HOTEL_QUALITY_AMENITY_KEYS)) {
      if (keys.some(key => isPositiveTagValue(tags[key]))) {
        amenities.add(label);
      }
    }

    for (const [key, value] of Object.entries(poi.google_amenities || {})) {
      if (isPositiveTagValue(value)) amenities.add(key);
    }

    if (isPositiveTagValue(poi.osm_wheelchair) || isPositiveTagValue(poi.google_accessibility?.wheelchairAccessibleEntrance)) {
      amenities.add('wheelchair_access');
    }

    return [...amenities].sort();
  }

  static walkabilityProxyFromRestaurantCount(count) {
    if (count >= 10) return 'excellent';
    if (count >= 5) return 'good';
    if (count >= 2) return 'fair';
    return 'limited';
  }

  static computeStayQualityScore(poi, nearbyRestaurantCount = 0) {
    const rating = Number(poi.google_rating);
    const reviewCount = Number(poi.google_review_count ?? poi.google_reviews);
    const stars = Number(poi.osm_stars ?? poi.stars);
    const amenityKeys = TravelDatabase.extractHotelQualityAmenityKeys(poi);
    const restaurantCount = Number.isFinite(Number(nearbyRestaurantCount)) ? Number(nearbyRestaurantCount) : 0;

    const ratingScore = Number.isFinite(rating) && rating > 0 ? Math.min(rating, 5) / 5 : null;
    const reviewScore = Number.isFinite(reviewCount) && reviewCount > 0 ? Math.min(Math.log10(reviewCount + 1) / Math.log10(1001), 1) : null;
    const starScore = Number.isFinite(stars) && stars > 0 ? Math.min(stars, 5) / 5 : null;
    const amenityScore = Math.min(amenityKeys.length / 8, 1);
    const restaurantScore = Math.min(restaurantCount / 12, 1);
    const walkabilityScore = Math.min(restaurantCount / 10, 1);

    const components = [
      { key: 'google_rating', score: ratingScore, weight: 35 },
      { key: 'review_volume', score: reviewScore, weight: 15 },
      { key: 'star_classification', score: starScore, weight: 20 },
      { key: 'amenity_richness', score: amenityScore, weight: 15 },
      { key: 'nearby_restaurant_density', score: restaurantScore, weight: 10 },
      { key: 'walkability_proxy', score: walkabilityScore, weight: 5 },
    ];

    const available = components.filter(component => component.score !== null);
    const availableWeight = available.reduce((sum, component) => sum + component.weight, 0);
    const score = availableWeight > 0
      ? Math.round(available.reduce((sum, component) => sum + component.score * component.weight, 0) / availableWeight * 100)
      : null;

    return {
      score,
      confidence: availableWeight >= 75 ? 'high' : availableWeight >= 45 ? 'medium' : 'low',
      components: Object.fromEntries(components.map(component => [
        component.key,
        component.score === null ? null : Math.round(component.score * 100),
      ])),
      available_weight: availableWeight,
      nearby_restaurant_count: restaurantCount,
      walkability_proxy: TravelDatabase.walkabilityProxyFromRestaurantCount(restaurantCount),
      amenity_count: amenityKeys.length,
      amenity_keys: amenityKeys,
    };
  }

  async addStayQualityScores(pois) {
    if (!pois || pois.length === 0) return pois;

    const hotels = pois.filter(poi => ACCOMMODATION_POI_TYPES.includes(poi.poi_type));
    if (hotels.length === 0) return pois;

    const hotelIds = hotels.map(poi => poi.osm_id).filter(Boolean);
    const counts = new Map(hotelIds.map(id => [id, 0]));

    if (hotelIds.length > 0) {
      const countResult = await this.pool.query(`
        SELECT h.osm_id, COUNT(r.osm_id)::int as nearby_restaurant_count
        FROM osm_pois h
        LEFT JOIN osm_pois r ON r.poi_type = ANY($2)
          AND r.osm_id != h.osm_id
          AND ST_DWithin(
            h.location::geography,
            r.location::geography,
            $3::float8
          )
        WHERE h.osm_id = ANY($1)
        GROUP BY h.osm_id
      `, [hotelIds, DINING_POI_TYPES, HOTEL_QUALITY_RESTAURANT_RADIUS_METERS]);

      for (const row of countResult.rows) {
        counts.set(row.osm_id, Number(row.nearby_restaurant_count) || 0);
      }
    }

    return pois.map(poi => {
      if (!ACCOMMODATION_POI_TYPES.includes(poi.poi_type)) return poi;
      const nearbyRestaurantCount = counts.get(poi.osm_id) || 0;
      const stayQuality = TravelDatabase.computeStayQualityScore(poi, nearbyRestaurantCount);
      return {
        ...poi,
        stay_quality_score: stayQuality.score,
        stay_quality_confidence: stayQuality.confidence,
        stay_quality: stayQuality,
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
    pescatarian: 'diet:pescetarian',
    pescetarian: 'diet:pescetarian',
    organic: 'diet:organic',
    lactose_free: 'diet:lactose_free',
  };

  static HOTEL_INTENT_MAP = {
    remote_work: {
      explanation: 'Prioritizes hotels with WiFi or internet access tags.',
      clauses: ["(p.tags ? 'internet_access' AND p.tags->>'internet_access' != 'no')"],
    },
    family: {
      explanation: 'Prioritizes hotels with family-friendly room, child, or play-area tags.',
      clauses: [
        "(p.tags ? 'family_rooms' AND p.tags->>'family_rooms' != 'no')",
        "(p.tags ? 'kids_area' AND p.tags->>'kids_area' != 'no')",
        "(p.tags ? 'playground' AND p.tags->>'playground' != 'no')",
        "(p.tags ? 'baby_feeding' AND p.tags->>'baby_feeding' != 'no')",
      ],
    },
    romantic: {
      explanation: 'Prioritizes hotels with spa, pool, garden, balcony, or higher-star signals.',
      clauses: [
        "(p.tags ? 'spa' AND p.tags->>'spa' != 'no')",
        "(p.tags ? 'swimming_pool' AND p.tags->>'swimming_pool' != 'no')",
        "(p.tags ? 'garden' AND p.tags->>'garden' != 'no')",
        "(p.tags ? 'balcony' AND p.tags->>'balcony' != 'no')",
        'p.stars >= 4',
      ],
    },
    budget: {
      explanation: 'Prioritizes lower-cost accommodation types or hotels with lower star ratings.',
      clauses: [
        "p.poi_type = ANY(ARRAY['hostel','guest_house','motel','bed_and_breakfast','camp_site'])",
        'p.stars <= 2',
      ],
    },
    accessible: {
      explanation: 'Prioritizes hotels with wheelchair accessibility tags.',
      clauses: [
        "p.wheelchair IN ('yes', 'limited')",
        "(p.tags ? 'wheelchair' AND p.tags->>'wheelchair' IN ('yes', 'limited'))",
      ],
    },
    pet_friendly: {
      explanation: 'Prioritizes hotels with pet-friendly OSM tags.',
      clauses: ["(p.tags ? 'pets' AND p.tags->>'pets' != 'no')"],
    },
  };

  static RESTAURANT_OCCASION_MAP = {
    business_dinner: {
      explanation: 'Prioritizes full-service restaurants with reservation, table-service, card-payment, rating, and moderate-or-higher price signals.',
      typeClauses: ["p.poi_type = 'restaurant'"],
      clauses: [
        "(p.tags ? 'reservation' AND p.tags->>'reservation' != 'no')",
        "(p.tags ? 'table_service' AND p.tags->>'table_service' != 'no')",
        "(p.tags ? 'payment:credit_cards' AND p.tags->>'payment:credit_cards' != 'no')",
      ],
      minGoogleRating: 4,
      priceLevels: ['PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'],
    },
    casual_lunch: {
      explanation: 'Prioritizes accessible lunch spots such as restaurants, cafes, fast food, and food courts with takeaway or outdoor-seating signals.',
      typeClauses: ["p.poi_type = ANY(ARRAY['restaurant','cafe','fast_food','food_court'])"],
      clauses: [
        "(p.tags ? 'takeaway' AND p.tags->>'takeaway' != 'no')",
        "(p.tags ? 'outdoor_seating' AND p.tags->>'outdoor_seating' != 'no')",
        'p.cuisine IS NOT NULL',
      ],
      priceLevels: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE'],
    },
    date_night: {
      explanation: 'Prioritizes restaurants, bars, and pubs with reservation, outdoor-seating, live-music, cuisine, rating, and moderate-or-higher price signals.',
      typeClauses: ["p.poi_type = ANY(ARRAY['restaurant','bar','pub'])"],
      clauses: [
        "(p.tags ? 'reservation' AND p.tags->>'reservation' != 'no')",
        "(p.tags ? 'outdoor_seating' AND p.tags->>'outdoor_seating' != 'no')",
        "(p.tags ? 'live_music' AND p.tags->>'live_music' != 'no')",
        'p.cuisine IS NOT NULL',
      ],
      minGoogleRating: 4,
      priceLevels: ['PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'],
    },
    family_meal: {
      explanation: 'Prioritizes restaurants, cafes, and quick-service places with child-friendly OSM tags.',
      typeClauses: ["p.poi_type = ANY(ARRAY['restaurant','cafe','fast_food'])"],
      clauses: [
        "(p.tags ? 'highchair' AND p.tags->>'highchair' != 'no')",
        "(p.tags ? 'kids_area' AND p.tags->>'kids_area' != 'no')",
        "(p.tags ? 'child_friendly' AND p.tags->>'child_friendly' != 'no')",
        "(p.tags ? 'changing_table' AND p.tags->>'changing_table' != 'no')",
        "(p.tags ? 'playground' AND p.tags->>'playground' != 'no')",
      ],
      priceLevels: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE'],
    },
    quick_bite: {
      explanation: 'Prioritizes fast, informal venues with takeaway, drive-through, or self-service signals and lower price levels where known.',
      typeClauses: ["p.poi_type = ANY(ARRAY['fast_food','cafe','food_court'])"],
      clauses: [
        "(p.tags ? 'takeaway' AND p.tags->>'takeaway' != 'no')",
        "(p.tags ? 'drive_through' AND p.tags->>'drive_through' != 'no')",
        "(p.tags ? 'self_service' AND p.tags->>'self_service' != 'no')",
      ],
      priceLevels: ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE'],
    },
    late_night: {
      explanation: 'Prioritizes restaurants, bars, pubs, and quick-service places with late or 24/7 opening-hours signals.',
      typeClauses: ["p.poi_type = ANY(ARRAY['restaurant','bar','pub','fast_food'])"],
      clauses: [
        "p.opening_hours ILIKE '%24/7%'",
        "p.opening_hours ~ '(22|23|00|01|02):'",
      ],
    },
  };

  static normalizeExtraFilterList(value) {
    if (!value) return [];
    const values = Array.isArray(value) ? value : [value];
    return values
      .map(v => String(v).trim())
      .filter(Boolean);
  }

  static normalizePriceLevel(value) {
    if (value === null || value === undefined || value === '') return null;
    const key = String(value).trim().toLowerCase();
    return GOOGLE_PRICE_LEVELS[key] || null;
  }

  static priceLevelToNumber(priceLevel) {
    switch (priceLevel) {
      case 'PRICE_LEVEL_FREE': return 0;
      case 'PRICE_LEVEL_INEXPENSIVE': return 1;
      case 'PRICE_LEVEL_MODERATE': return 2;
      case 'PRICE_LEVEL_EXPENSIVE': return 3;
      case 'PRICE_LEVEL_VERY_EXPENSIVE': return 4;
      default: return null;
    }
  }

  static buildHotelChainMatchSql(inputParam, mode) {
    const hotelChainMatch = `
      EXISTS (
        SELECT 1
        FROM hotel_chains hc
        WHERE (
          ${mode === 'chain'
    ? `(LOWER(hc.chain_name) = LOWER(${inputParam}) OR LOWER(hc.parent_chain) = LOWER(${inputParam}) OR LOWER(hc.brand_name) = LOWER(${inputParam}))`
    : `(LOWER(hc.brand_name) = LOWER(${inputParam}) OR hc.wikidata_id = ${inputParam} OR EXISTS (
              SELECT 1 FROM unnest(hc.aliases) alias WHERE LOWER(alias) = LOWER(${inputParam})
            ))`}
        )
        AND (
          LOWER(p.tags->>'brand') = LOWER(hc.brand_name)
          OR LOWER(p.tags->>'operator') = LOWER(hc.brand_name)
          OR (hc.wikidata_id IS NOT NULL AND p.tags->>'brand:wikidata' = hc.wikidata_id)
          OR EXISTS (
            SELECT 1
            FROM unnest(hc.aliases) alias
            WHERE LOWER(p.tags->>'brand') = LOWER(alias)
              OR LOWER(p.tags->>'operator') = LOWER(alias)
          )
        )
      )
    `;

    return `
      (
        p.tags->>'brand:wikidata' = ${inputParam}
        OR LOWER(p.tags->>'brand') = LOWER(${inputParam})
        OR LOWER(p.tags->>'operator') = LOWER(${inputParam})
        OR ${hotelChainMatch}
      )
    `;
  }

  static buildHotelBrandFilters(brand, chain, queryParams) {
    let sql = '';
    const brandValue = typeof brand === 'string' ? brand.trim() : '';
    const chainValue = typeof chain === 'string' ? chain.trim() : '';

    if (brandValue) {
      queryParams.push(brandValue);
      sql += ` AND ${TravelDatabase.buildHotelChainMatchSql(`$${queryParams.length}`, 'brand')}`;
    }

    if (chainValue) {
      queryParams.push(chainValue);
      sql += ` AND ${TravelDatabase.buildHotelChainMatchSql(`$${queryParams.length}`, 'chain')}`;
    }

    return sql;
  }

  static buildHotelIntentFilter(intent) {
    if (!intent) return '';
    const intentConfig = TravelDatabase.HOTEL_INTENT_MAP[intent];
    if (!intentConfig) return '';
    return ` AND (${intentConfig.clauses.join(' OR ')})`;
  }

  static annotateHotelIntent(pois, intent) {
    const intentConfig = TravelDatabase.HOTEL_INTENT_MAP[intent];
    if (!intentConfig) return pois;

    return pois.map(poi => ({
      ...poi,
      hotel_intent: intent,
      hotel_intent_explanation: intentConfig.explanation,
    }));
  }

  static buildRestaurantOccasionFilter(occasion) {
    const occasionConfig = TravelDatabase.RESTAURANT_OCCASION_MAP[occasion];
    if (!occasionConfig) return '';

    const parts = [];
    if (occasionConfig.typeClauses?.length > 0) {
      parts.push(`(${occasionConfig.typeClauses.join(' OR ')})`);
    }
    if (occasionConfig.clauses?.length > 0) {
      parts.push(`(${occasionConfig.clauses.join(' OR ')})`);
    }
    return parts.length > 0 ? ` AND (${parts.join(' AND ')})` : '';
  }

  filterByRestaurantOccasion(pois, occasion) {
    const occasionConfig = TravelDatabase.RESTAURANT_OCCASION_MAP[occasion];
    if (!occasionConfig) return pois;

    return pois.filter(poi => {
      const rating = Number(poi.google_rating);
      if (occasionConfig.minGoogleRating && Number.isFinite(rating) && rating < occasionConfig.minGoogleRating) {
        return false;
      }
      if (occasionConfig.priceLevels?.length > 0 && poi.google_price_level && !occasionConfig.priceLevels.includes(poi.google_price_level)) {
        return false;
      }
      return true;
    });
  }

  static annotateRestaurantOccasion(pois, occasion) {
    const occasionConfig = TravelDatabase.RESTAURANT_OCCASION_MAP[occasion];
    if (!occasionConfig) return pois;

    return pois.map(poi => ({
      ...poi,
      restaurant_occasion: occasion,
      restaurant_occasion_explanation: occasionConfig.explanation,
    }));
  }

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
    const cuisineList = TravelDatabase.normalizeExtraFilterList(cuisine);
    const amenityList = TravelDatabase.normalizeExtraFilterList(amenities);
    const dietaryList = TravelDatabase.normalizeExtraFilterList(dietary);

    // Cuisine filter: match any of the provided cuisines (OR)
    if (cuisineList.length > 0) {
      const cuisineClauses = cuisineList.map(c => {
        const escaped = c.replace(/[%_\\]/g, '\\$&');
        queryParams.push(`%${escaped}%`);
        return `p.cuisine ILIKE $${queryParams.length}`;
      });
      sql += ` AND (${cuisineClauses.join(' OR ')})`;
    }

    // Amenity filter: require all amenities (AND)
    if (amenityList.length > 0) {
      for (const amenity of amenityList) {
        const tagKey = TravelDatabase.AMENITY_TAG_MAP[amenity] || amenity;
        queryParams.push(tagKey);
        const idx = queryParams.length;
        sql += ` AND p.tags ? $${idx} AND p.tags->>$${idx} != 'no'`;
      }
    }

    // Dietary filter: require all dietary options (AND)
    if (dietaryList.length > 0) {
      for (const diet of dietaryList) {
        const tagKey = TravelDatabase.DIETARY_TAG_MAP[diet] || diet;
        queryParams.push(tagKey);
        const idx = queryParams.length;
        sql += ` AND p.tags ? $${idx} AND p.tags->>$${idx} != 'no'`;
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
   * @param {string|null} params.brand - Hotel brand filter
   * @param {string|null} params.chain - Hotel chain filter including known sub-brands
   * @param {string|null} params.intent - Hotel intent filter
   * @param {string|null} params.occasion - Restaurant occasion filter
   * @param {number|string|null} params.priceLevel - Google Places price level filter
   * @param {boolean} params.openNow - Filter to only currently open POIs
   * @param {Date|string|null} params.openAt - Filter to only POIs open at this time
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
      brand = null,       // Hotel brand filter
      chain = null,       // Hotel chain filter
      intent = null,      // Hotel intent filter
      occasion = null,    // Restaurant occasion filter
      priceLevel = null,  // Google Places price level filter
      openNow = false,    // Filter to only currently open POIs
      openAt = null,      // Filter to POIs open at a specific time
      limit: rawLimit = SEARCH_LIMIT_DEFAULT,
      offset = 0,
      userId = null,    // For including favorite status in results
    } = params;
    const limit = clampPositiveInteger(rawLimit, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX);
    const safeOffset = clampNonNegativeInteger(offset, 0);
    const requestedRadius = radius === null || radius === undefined ? null : clampSearchRadiusKm(radius);

    // Debug logging
    const typeDesc = poiTypes ? poiTypes.join(',') : poiType || 'all';
    const cuisineList = TravelDatabase.normalizeExtraFilterList(cuisine);
    const amenityList = TravelDatabase.normalizeExtraFilterList(amenities);
    const dietaryList = TravelDatabase.normalizeExtraFilterList(dietary);
    const normalizedPriceLevel = TravelDatabase.normalizePriceLevel(priceLevel);
    const extraDesc = [
      cuisineList.length > 0 && `cuisine=${cuisineList.join(',')}`,
      amenityList.length > 0 && `amenities=${amenityList.join(',')}`,
      dietaryList.length > 0 && `dietary=${dietaryList.join(',')}`,
      brand && `brand=${brand}`,
      chain && `chain=${chain}`,
      intent && `intent=${intent}`,
      occasion && `occasion=${occasion}`,
      normalizedPriceLevel && `priceLevel=${normalizedPriceLevel}`,
      openNow && 'openNow',
      openAt && `openAt=${openAt}`,
    ].filter(Boolean).join(', ');
    console.error(`[searchPOIs] query=${name}, city=${cityName}, country=${countryCode}, state=${state}, lat=${latitude}, lon=${longitude}, radius=${requestedRadius ?? 'default'}km, types=${typeDesc}, limit=${limit}${extraDesc ? `, ${extraDesc}` : ''}`);

    let query;
    let queryParams;

    // Normalize POI type filter - support both single type and array of types
    const typeFilter = poiTypes || (poiType ? [poiType] : null);

    // Determine search strategy based on provided parameters
    const hasName = !!name;
    const hasCity = !!cityName;
    const hasBrandSearch = !!brand || !!chain;
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
          p.opening_hours as osm_opening_hours,
          p.tags as osm_tags,
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
      query += TravelDatabase.buildHotelBrandFilters(brand, chain, queryParams);
      query += TravelDatabase.buildHotelIntentFilter(intent);
      query += TravelDatabase.buildRestaurantOccasionFilter(occasion);

      query += ` ORDER BY name_similarity DESC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    // Case 1b: Brand/chain search without city or coordinates.
    else if (!hasName && !hasCity && !hasCoords && hasBrandSearch) {
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
          p.opening_hours as osm_opening_hours,
          p.tags as osm_tags,
          p.tags->>'brand' as osm_brand,
          p.tags->>'operator' as osm_operator
        FROM osm_pois p
        LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
        WHERE p.name IS NOT NULL
      `;
      queryParams = [];

      if (countryCode) {
        query += ` AND c.country_code = $${queryParams.length + 1}`;
        queryParams.push(countryCode.toUpperCase());
      }

      if (typeFilter) {
        query += ` AND p.poi_type = ANY($${queryParams.length + 1})`;
        queryParams.push(typeFilter);
      }

      query += TravelDatabase.buildExtraFilters(cuisine, amenities, dietary, queryParams);
      query += TravelDatabase.buildHotelBrandFilters(brand, chain, queryParams);
      query += TravelDatabase.buildHotelIntentFilter(intent);
      query += TravelDatabase.buildRestaurantOccasionFilter(occasion);

      query += ` ORDER BY p.name ASC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    // Case 2: Location only (city or coordinates)
    else if (!hasName && (hasCity || hasCoords)) {
      const extraFilters = { cuisine, amenities, dietary, brand, chain, intent, occasion, priceLevel: normalizedPriceLevel };
      if (hasCity) {
        const city = await this.getCityByName(cityName, countryCode, state);
        if (!city) {
          return [];
        }

        const searchRadius = clampSearchRadiusKm(requestedRadius, this.getRadiusForPopulation(city.population || 100000));
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
          safeOffset,
          openAt,
        );
      } else {
        const searchRadius = clampSearchRadiusKm(requestedRadius, 10); // Default 10km
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
          safeOffset,
          openAt,
        );
      }
    }
    // Case 3: Name + Location (combined search - filter by name AND location)
    else if (hasName && (hasCity || hasCoords)) {
      // First resolve city to coordinates if needed
      let searchLat = latitude;
      let searchLon = longitude;
      let searchRadius = requestedRadius;

      if (hasCity) {
        const city = await this.getCityByName(cityName, countryCode, state);
        if (!city) {
          return [];
        }
        searchLat = city.latitude;
        searchLon = city.longitude;
        searchRadius = clampSearchRadiusKm(searchRadius, this.getRadiusForPopulation(city.population || 100000));
      } else {
        searchRadius = clampSearchRadiusKm(searchRadius, 10); // Default 10km for coordinates
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
          p.opening_hours as osm_opening_hours,
          p.tags as osm_tags,
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
      query += TravelDatabase.buildHotelBrandFilters(brand, chain, queryParams);
      query += TravelDatabase.buildHotelIntentFilter(intent);
      query += TravelDatabase.buildRestaurantOccasionFilter(occasion);

      query += ` ORDER BY name_similarity DESC, distance_km ASC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    else {
      throw new Error('Must provide either name, cityName, or coordinates (latitude + longitude)');
    }

    const openAtDate = coerceOpenAt(openAt);
    const shouldFilterByHours = openNow || openAtDate;
    const shouldFilterByPrice = !!normalizedPriceLevel;
    const shouldFilterByOccasion = !!TravelDatabase.RESTAURANT_OCCASION_MAP[occasion];

    // For hours filtering, over-fetch and post-filter using Google or OSM opening hours.
    const fetchLimit = (shouldFilterByHours || shouldFilterByPrice || shouldFilterByOccasion) ? limit * 3 : limit;
    // Replace the limit param (always the last one) with the potentially larger fetch limit
    if (shouldFilterByHours || shouldFilterByPrice || shouldFilterByOccasion) {
      queryParams[queryParams.length - 1] = fetchLimit;
    }

    const result = await this.pool.query(query, queryParams);
    const enriched = await this.enrichWithGoogleData(result.rows);

    let filtered = enriched;
    if (shouldFilterByPrice) {
      filtered = this.filterByPriceLevel(filtered, normalizedPriceLevel);
    }
    if (shouldFilterByOccasion) {
      filtered = this.filterByRestaurantOccasion(filtered, occasion);
    }
    if (shouldFilterByHours) {
      filtered = this.filterOpenAt(filtered, openAtDate || new Date());
    }
    filtered = filtered.slice(0, limit);
    filtered = TravelDatabase.annotateHotelIntent(filtered, intent);
    filtered = TravelDatabase.annotateRestaurantOccasion(filtered, occasion);
    filtered = await this.addStayQualityScores(filtered);

    const baseUrl = await this.getServerBaseUrl();
    const withUris = addResourceUris(removeNullFields(filtered), baseUrl);
    const withPhotos = await this.addPhotoUrls(withUris);
    return this.addFavoriteStatus(sanitizePoiExternalUrlsArray(withPhotos), userId);
  }

  /**
   * Filter POIs to only those open at a specific time, using Google Places data
   * when available and OSM opening_hours as a fallback.
   * POIs without opening hours data are excluded (we can't determine if they're open).
   */
  filterOpenAt(pois, openAt = new Date()) {
    return pois.filter(poi => isPoiOpenAt(poi, openAt) === true);
  }

  filterOpenNow(pois) {
    return this.filterOpenAt(pois, new Date());
  }

  filterByPriceLevel(pois, priceLevel) {
    return pois.filter(poi => poi.google_price_level === priceLevel);
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
   * @param {number} offset - Results offset
   * @param {Date|string|null} openAt - Filter to only POIs open at this time
   * @returns {Promise<Array<Object>>} Array of POI objects with distance_km included
   */
  async searchPOIsNearCoordinates(latitude, longitude, radiusKm, typeFilter = null, rawLimit = SEARCH_LIMIT_DEFAULT, userId = null, excludeOsmIds = null, extraFilters = null, openNow = false, offset = 0, openAt = null) {
    const limit = clampPositiveInteger(rawLimit, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX);
    const safeRadiusKm = clampSearchRadiusKm(radiusKm);
    const safeOffset = clampNonNegativeInteger(offset, 0);
    // Debug logging
    const typeDesc = typeFilter ? (Array.isArray(typeFilter) ? typeFilter.join(',') : typeFilter) : 'all';
    console.error(`[searchPOIsNearCoordinates] lat=${latitude}, lon=${longitude}, radius=${safeRadiusKm}km, types=${typeDesc}, limit=${limit}`);

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
        p.opening_hours as osm_opening_hours,
        p.tags as osm_tags,
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

    const params = [latitude, longitude, safeRadiusKm];

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
      query += TravelDatabase.buildHotelBrandFilters(extraFilters.brand, extraFilters.chain, params);
      query += TravelDatabase.buildHotelIntentFilter(extraFilters.intent);
      query += TravelDatabase.buildRestaurantOccasionFilter(extraFilters.occasion);
    }

    const openAtDate = coerceOpenAt(openAt);
    const shouldFilterByHours = openNow || openAtDate;
    const normalizedPriceLevel = TravelDatabase.normalizePriceLevel(extraFilters?.priceLevel);
    const shouldFilterByPrice = !!normalizedPriceLevel;
    const shouldFilterByOccasion = !!TravelDatabase.RESTAURANT_OCCASION_MAP[extraFilters?.occasion];
    // For hours filtering, over-fetch and post-filter (offset not applied since post-filtering changes counts)
    const fetchLimit = (shouldFilterByHours || shouldFilterByPrice || shouldFilterByOccasion) ? limit * 3 : limit;
    const fetchOffset = (shouldFilterByHours || shouldFilterByPrice || shouldFilterByOccasion) ? 0 : safeOffset;
    query += ` ORDER BY distance_km ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(fetchLimit, fetchOffset);

    const result = await this.pool.query(query, params);
    const enriched = await this.enrichWithGoogleData(result.rows);

    let filtered = enriched;
    if (shouldFilterByPrice) {
      filtered = this.filterByPriceLevel(filtered, normalizedPriceLevel);
    }
    if (shouldFilterByOccasion) {
      filtered = this.filterByRestaurantOccasion(filtered, extraFilters?.occasion);
    }
    if (shouldFilterByHours) {
      filtered = this.filterOpenAt(filtered, openAtDate || new Date());
    }
    filtered = filtered.slice(0, limit);
    filtered = TravelDatabase.annotateHotelIntent(filtered, extraFilters?.intent);
    filtered = TravelDatabase.annotateRestaurantOccasion(filtered, extraFilters?.occasion);
    filtered = await this.addStayQualityScores(filtered);

    const baseUrl = await this.getServerBaseUrl();
    const withUris = addResourceUris(removeNullFields(filtered), baseUrl);
    const withPhotos = await this.addPhotoUrls(withUris);
    return this.addFavoriteStatus(sanitizePoiExternalUrlsArray(withPhotos), userId);
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
    const enrichmentKey = getEnrichmentLockKey(osmId);
    if (poi.mapping_status && poi.next_enrichment_at === undefined) {
      try {
        await this.ensureGoogleMappingScheduleColumn();
        const retryResult = await this.pool.query(
          'SELECT next_enrichment_at FROM osm_google_mappings WHERE osm_id = $1',
          [osmId]
        );
        poi.next_enrichment_at = retryResult.rows[0]?.next_enrichment_at || null;
      } catch {
        poi.next_enrichment_at = null;
      }
    }

    // Determine enrichment status and add helpful metadata
    let enrichment_status = 'complete';
    let enrichment_message = null;

    // Check mapping status to determine if enrichment is needed
    if (poi.mapping_status === 'active' && poi.google_place_id) {
      // Already enriched - complete
      this._enrichmentRestartedAt.delete(enrichmentKey);
      enrichment_status = 'complete';
    } else if (poi.mapping_status === 'pending') {
      const startedAt = poi.mapped_at ? new Date(poi.mapped_at) : new Date();
      const ageMs = Date.now() - startedAt.getTime();
      const lastRestartedAt = this._enrichmentRestartedAt.get(enrichmentKey) || 0;
      const restartedRecently = Date.now() - lastRestartedAt < PENDING_ENRICHMENT_RESTART_COOLDOWN_MS;
      const retryDeferred = isFutureDate(poi.next_enrichment_at);
      const isStale = ageMs > PENDING_ENRICHMENT_STALE_MS &&
        !this._enrichmentLock.has(enrichmentKey) &&
        !restartedRecently &&
        !retryDeferred;
      if (isStale) {
        const quota = await this.checkGoogleApiLimit();
        if (!quota.allowed) {
          enrichment_status = 'pending';
          await recordGoogleEnrichmentSkipSpan(osmId, 'quota_exhausted_before_restart', {
            stage: 'poi_details',
            mapping_status: poi.mapping_status,
            quota_current: quota.current,
            quota_limit: quota.limit,
            quota_remaining: quota.remaining,
          });
          enrichment_message = await this.markGoogleQuotaExceeded(osmId, quota);
        } else {
          // Server restart (or crash) left a stale pending row.
          // Reset mapped_at so it looks fresh, then re-trigger enrichment immediately.
          await this.pool.query(
            `UPDATE osm_google_mappings SET mapped_at = CURRENT_TIMESTAMP, next_enrichment_at = NULL WHERE osm_id = $1`, [osmId]
          ).catch(() => {});

          const newStartedAt = new Date();
          this._enrichmentRestartedAt.set(enrichmentKey, newStartedAt.getTime());
          const checkBackAt  = new Date(newStartedAt.getTime() + 60000);
          enrichment_status  = 'pending';
          enrichment_message = `Enrichment restarted at ${newStartedAt.toISOString()}. Check back after ${checkBackAt.toISOString()}.`;

          const enrichmentPromise = withTimeout(
            this.enrichOSMPOI(osmId, { forcePending: true }),
            120000,
            'Enrichment timeout after 2 minutes'
          ).catch(err => {
            this.pool.query(
              `UPDATE osm_google_mappings SET mapping_status = 'error', mapping_notes = $1, next_enrichment_at = $2 WHERE osm_id = $3`,
              [err.message, retryAtFromNow(GOOGLE_ERROR_RETRY_MS), osmId]
            ).catch(() => {});
          }).finally(() => { this._enrichmentLock.delete(enrichmentKey); });
          this._enrichmentLock.set(enrichmentKey, enrichmentPromise);
        }
      } else {
        enrichment_status = 'pending';
        const checkBackAt = new Date(startedAt.getTime() + 60000);
        if (poi.mapping_notes?.includes('daily API limit')) {
          await recordGoogleEnrichmentSkipSpan(osmId, 'quota_retry_deferred', {
            stage: 'poi_details',
            mapping_status: poi.mapping_status,
            next_enrichment_at: poi.next_enrichment_at ? new Date(poi.next_enrichment_at).toISOString() : null,
          });
          enrichment_message = poi.mapping_notes;
        } else if (retryDeferred) {
          await recordGoogleEnrichmentSkipSpan(osmId, 'retry_deferred', {
            stage: 'poi_details',
            mapping_status: poi.mapping_status,
            next_enrichment_at: new Date(poi.next_enrichment_at).toISOString(),
          });
          enrichment_message = `Google Places enrichment is paused until ${new Date(poi.next_enrichment_at).toISOString()}.`;
        } else {
          enrichment_message = `Google Places enrichment in progress (started at ${startedAt.toISOString()}). Check back after ${checkBackAt.toISOString()}.`;
        }
      }
    } else if (poi.mapping_status === 'not_found') {
      this._enrichmentRestartedAt.delete(enrichmentKey);
      enrichment_status = 'failed';
      const attemptedAt = poi.mapped_at ? new Date(poi.mapped_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : null;
      enrichment_message = `Google Places enrichment attempted but no matching location was found. Only OpenStreetMap data is available.${attemptedAt ? ` (last attempted: ${attemptedAt})` : ''}`;
    } else if (poi.mapping_status === 'error') {
      this._enrichmentRestartedAt.delete(enrichmentKey);
      enrichment_status = 'failed';
      const attemptedAt = poi.mapped_at ? new Date(poi.mapped_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : null;
      if (poi.mapping_notes?.includes('daily API limit')) {
        enrichment_status = 'pending';
        await this.createMapping(osmId, null, {
          mapping_status: 'pending',
          mapping_notes: poi.mapping_notes,
          next_enrichment_at: nextUtcDayWithBuffer(),
          preserve_mapped_at: true,
        }).catch(() => {});
        enrichment_message = `${poi.mapping_notes}${attemptedAt ? ` (last attempted: ${attemptedAt})` : ''}`;
      } else {
        enrichment_message = `Google Places enrichment failed due to an error. Only OpenStreetMap data is available.${attemptedAt ? ` (last attempted: ${attemptedAt})` : ''}`;
      }
    } else if (!poi.mapping_status) {
      // No enrichment attempt yet - trigger it
      await this.ensureGooglePlacesReady();
      if (this.googlePlaces && this.googlePlaces.isEnabled()) {
        // Check if enrichment is already in-flight for this POI (dedup concurrent requests)
        if (this._enrichmentLock.has(enrichmentKey)) {
          enrichment_status = 'pending';
          await recordGoogleEnrichmentSkipSpan(osmId, 'already_in_progress', {
            stage: 'poi_details',
          });
          enrichment_message = 'Google Places enrichment already in progress. Check back shortly for complete information.';
        } else {
          const quota = await this.checkGoogleApiLimit();
          if (!quota.allowed) {
            enrichment_status = 'pending';
            await recordGoogleEnrichmentSkipSpan(osmId, 'quota_exhausted_before_start', {
              stage: 'poi_details',
              quota_current: quota.current,
              quota_limit: quota.limit,
              quota_remaining: quota.remaining,
            });
            enrichment_message = await this.markGoogleQuotaExceeded(osmId, quota);
          } else {
            // Mark as pending IMMEDIATELY before starting enrichment
            await this.pool.query(`
              INSERT INTO osm_google_mappings (osm_id, mapping_status, mapping_notes, next_enrichment_at, mapped_at)
              VALUES ($1, 'pending', NULL, NULL, CURRENT_TIMESTAMP)
              ON CONFLICT (osm_id) DO UPDATE SET
                mapping_status = 'pending',
                mapping_notes = NULL,
                next_enrichment_at = NULL,
                mapped_at = CURRENT_TIMESTAMP
            `, [osmId]);

            const startedAt = new Date();
            const checkBackAt = new Date(startedAt.getTime() + 60000); // 1 minute from now

            enrichment_status = 'pending';
            enrichment_message = `Google Places enrichment started at ${startedAt.toISOString()}. Check back after ${checkBackAt.toISOString()} (approximately 1 minute) for complete information including ratings, reviews, photos, and verified opening hours.`;

            // Fire-and-forget background enrichment with 2-minute timeout and dedup lock
            const enrichmentPromise = withTimeout(
              this.enrichOSMPOI(osmId, { forcePending: true }),
              120000,
              'Enrichment timeout after 2 minutes'
            ).catch(err => {
              console.error(`Background enrichment failed for POI ${osmId}:`, err.message);
              telemetry.captureException(err, { context: 'background_enrichment', osmId });
              // Mark as error if enrichment fails
              this.pool.query(`
                UPDATE osm_google_mappings
                SET mapping_status = 'error', mapping_notes = $1, next_enrichment_at = $2
                WHERE osm_id = $3
              `, [err.message, retryAtFromNow(GOOGLE_ERROR_RETRY_MS), osmId]).catch(() => {});
            }).finally(() => {
              this._enrichmentLock.delete(enrichmentKey);
            });
            this._enrichmentLock.set(enrichmentKey, enrichmentPromise);
          }
        }
      } else {
        enrichment_status = 'disabled';
        await recordGoogleEnrichmentSkipSpan(osmId, 'google_places_disabled', {
          stage: 'poi_details',
        });
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

    const [scoredResponse] = await this.addStayQualityScores([response]);
    const sanitizedResponse = sanitizePoiExternalUrls(scoredResponse);

    // Remove null/undefined fields and add resource URIs
    const baseUrl = await this.getServerBaseUrl();
    const withUris = addResourceUris(removeNullFields(sanitizedResponse), baseUrl);

    // Add favorite status for authenticated users (returns array, we extract single item)
    const withFavorites = await this.addFavoriteStatus([withUris], userId);
    return withFavorites[0];
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
  async enrichOSMPOI(osmId, options = {}) {
    const enrichmentKey = getEnrichmentLockKey(osmId);
    const existing = this._enrichmentLock.get(enrichmentKey);
    if (existing) {
      return existing;
    }

    const promise = this.enrichOSMPOIUnlocked(osmId, options).finally(() => {
      this._enrichmentLock.delete(enrichmentKey);
      this._enrichmentLockInfo.delete(enrichmentKey);
    });
    this._enrichmentLock.set(enrichmentKey, promise);
    this._enrichmentLockInfo.set(enrichmentKey, {
      osmId: enrichmentKey,
      taskId: options.taskId || null,
      forcePending: options.forcePending === true,
      startedAt: new Date().toISOString(),
    });
    return promise;
  }

  async enrichOSMPOIUnlocked(osmId, { forcePending = false } = {}) {
    await this.ensureGooglePlacesReady();

    if (!this.googlePlaces || !this.googlePlaces.isEnabled()) {
      await recordGoogleEnrichmentSkipSpan(osmId, 'google_places_disabled', {
        stage: 'enrich_osm_poi',
      });
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
        await recordGoogleEnrichmentSkipSpan(osmId, 'osm_poi_missing', {
          stage: 'enrich_osm_poi',
        });
        return;
      }

      const osmPOI = osmResult.rows[0];

      // Check if already mapped
      await this.ensureGoogleMappingScheduleColumn();
      const existingMapping = await this.pool.query(`
        SELECT
          google_place_id,
          mapping_status,
          mapped_at,
          next_enrichment_at
        FROM osm_google_mappings
        WHERE osm_id = $1
      `, [osmId]);

      // Skip if already mapped and active
      if (existingMapping.rows.length > 0) {
        const mapping = existingMapping.rows[0];
        if (mapping.mapping_status === 'active') {
          if (isFutureDate(mapping.next_enrichment_at)) {
            await recordGoogleEnrichmentSkipSpan(osmId, 'active_cache_deferred', {
              stage: 'enrich_osm_poi',
              mapping_status: mapping.mapping_status,
              next_enrichment_at: new Date(mapping.next_enrichment_at).toISOString(),
            });
            return; // Active enrichment is still fresh.
          }
          if (!mapping.next_enrichment_at) {
            const hoursSinceMapping = (Date.now() - new Date(mapping.mapped_at).getTime()) / (1000 * 60 * 60);
            const refreshHours = GOOGLE_ACTIVE_REFRESH_MS / (60 * 60 * 1000);
            if (hoursSinceMapping < refreshHours) {
              await recordGoogleEnrichmentSkipSpan(osmId, 'active_cache_fresh', {
                stage: 'enrich_osm_poi',
                mapping_status: mapping.mapping_status,
                cache_age_hours: Number(hoursSinceMapping.toFixed(2)),
                refresh_after_hours: Number(refreshHours.toFixed(2)),
              });
              return;
            }
          }
        }
        if (mapping.mapping_status !== 'active' && isFutureDate(mapping.next_enrichment_at)) {
          await recordGoogleEnrichmentSkipSpan(osmId, 'retry_deferred', {
            stage: 'enrich_osm_poi',
            mapping_status: mapping.mapping_status,
            next_enrichment_at: new Date(mapping.next_enrichment_at).toISOString(),
          });
          return; // Retry window has not opened yet.
        }
        if (mapping.mapping_status === 'pending' && !forcePending) {
          const mappedAt = mapping.mapped_at ? new Date(mapping.mapped_at).getTime() : Date.now();
          if (Date.now() - mappedAt < PENDING_ENRICHMENT_STALE_MS) {
            await recordGoogleEnrichmentSkipSpan(osmId, 'pending_in_progress', {
              stage: 'enrich_osm_poi',
              mapping_status: mapping.mapping_status,
            });
            return; // Another request just queued or started this enrichment.
          }
        }
        // Backfill retry throttling for older rows that predate next_enrichment_at.
        if (mapping.mapping_status === 'not_found' && !mapping.next_enrichment_at) {
          const daysSinceCheck = (Date.now() - new Date(mapping.mapped_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceCheck < 7) {
            await recordGoogleEnrichmentSkipSpan(osmId, 'not_found_retry_deferred', {
              stage: 'enrich_osm_poi',
              mapping_status: mapping.mapping_status,
              retry_after_days: 7,
              days_since_check: Number(daysSinceCheck.toFixed(2)),
            });
            return;
          }
        }
      }

      // Atomically consume quota before making API calls
      const quota1 = await this.consumeGoogleApiQuota();
      if (!quota1.allowed) {
        console.error(`Google API daily limit reached (${quota1.current}/${quota1.limit}). Skipping enrichment for OSM ${osmId}`);
        await recordGoogleEnrichmentSkipSpan(osmId, 'quota_exhausted_before_match', {
          stage: 'enrich_osm_poi',
          quota_current: quota1.current,
          quota_limit: quota1.limit,
          quota_remaining: quota1.remaining,
        });
        await this.markGoogleQuotaExceeded(osmId, quota1);
        return;
      }

      // Find matching Google Place
      const matchResult = await this.googlePlaces.findMatchingPlace(osmPOI);

      if (!matchResult) {
        // Mark as not_found
        await this.createMapping(osmId, null, {
          mapping_status: 'not_found',
          mapping_notes: 'No matching Google Place found',
          next_enrichment_at: retryAtFromNow(GOOGLE_NOT_FOUND_RETRY_MS),
        });
        return;
      }

      // Atomically consume quota before details call
      const quota2 = await this.consumeGoogleApiQuota();
      if (!quota2.allowed) {
        console.error(`Google API daily limit reached (${quota2.current}/${quota2.limit}). Skipping details for OSM ${osmId}`);
        await recordGoogleEnrichmentSkipSpan(osmId, 'quota_exhausted_before_details', {
          stage: 'enrich_osm_poi',
          google_place_id: matchResult.place_id,
          quota_current: quota2.current,
          quota_limit: quota2.limit,
          quota_remaining: quota2.remaining,
        });
        await this.markGoogleQuotaExceeded(
          osmId,
          quota2,
          `Details fetch was skipped for place_id: ${matchResult.place_id}.`
        );
        return;
      }

      // Get full place details
      const placeDetails = await this.googlePlaces.getPlaceDetails(matchResult.place_id);

      if (!placeDetails) {
        await this.createMapping(osmId, null, {
          mapping_status: 'error',
          mapping_notes: `Failed to retrieve place details (place_id: ${matchResult.place_id})`,
          next_enrichment_at: retryAtFromNow(GOOGLE_ERROR_RETRY_MS),
        });
        return;
      }

      if (!this.googlePlaces.isPlaceDetailsNameCompatible(osmPOI, placeDetails)) {
        const googleName = placeDetails.displayName?.text || placeDetails.displayName || placeDetails.name || 'unknown';
        await this.createMapping(osmId, null, {
          mapping_status: 'not_found',
          mapping_notes: `Rejected Google Place name mismatch: "${googleName}" (place_id: ${matchResult.place_id})`,
          next_enrichment_at: retryAtFromNow(GOOGLE_NOT_FOUND_RETRY_MS),
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
          mapping_notes: `Candidate too far away (${Math.round(distanceMeters)}m > 500m limit)`,
          next_enrichment_at: retryAtFromNow(GOOGLE_NOT_FOUND_RETRY_MS),
        });
        return;
      }

      await this.createMapping(osmId, placeDetails.id, {
        match_confidence: matchResult.rating ? 0.95 : 0.80, // Higher if has rating
        match_method: 'nearby_search',
        match_distance_meters: Math.round(distanceMeters),
        mapping_status: 'active',
        next_enrichment_at: retryAtFromNow(GOOGLE_ACTIVE_REFRESH_MS),
      });

      console.error(`✓ Enriched OSM POI ${osmId} with Google Place ${placeDetails.id}`);

    } catch (error) {
      console.error(`Error enriching OSM POI ${osmId}:`, error.message);
      telemetry.captureException(error, { context: 'enrich_osm_poi', osmId });
      await this.createMapping(osmId, null, {
        mapping_status: 'error',
        mapping_notes: error.message,
        next_enrichment_at: retryAtFromNow(GOOGLE_ERROR_RETRY_MS),
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
      sanitizeHttpUrl(placeData.websiteUri),
      sanitizeHttpUrl(placeData.googleMapsUri),
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

  async getOpenRouterPlaceSummaryConfig() {
    const apiKey = await this.getConfigCached('openrouter_api_key', process.env.OPENROUTER_API_KEY || null);
    const model = await this.getConfigCached('openrouter_place_summary_model', process.env.OPENROUTER_PLACE_SUMMARY_MODEL || 'openrouter/auto');
    const reviewSummaryEnabled = String(await this.getConfigCached('review_summary_enabled', '1')) !== '0';
    const homepageSummaryEnabled = String(await this.getConfigCached('homepage_summary_enabled', '1')) !== '0';

    return {
      apiKey,
      model: model || 'openrouter/auto',
      reviewSummaryEnabled: !!apiKey && reviewSummaryEnabled,
      homepageSummaryEnabled: !!apiKey && homepageSummaryEnabled,
    };
  }

  async getHomepageHarvestConfig() {
    const refreshDays = clampPositiveInteger(
      await this.getConfigCached('homepage_harvest_refresh_days', String(HOMEPAGE_HARVEST_REFRESH_DAYS_DEFAULT)),
      HOMEPAGE_HARVEST_REFRESH_DAYS_DEFAULT,
      365,
    );
    return { refreshDays };
  }

  async getLatestHomepageHarvest(osmId, originalUrl) {
    await this.ensureAiSummaryColumns();
    const result = await this.pool.query(`
      SELECT
        osm_id,
        original_url,
        final_url,
        fetch_status,
        http_status,
        content_type,
        title,
        meta_description,
        text_content,
        image_urls,
        content_hash,
        fetch_error,
        fetched_at,
        next_fetch_at
      FROM poi_homepage_harvests
      WHERE osm_id = $1 AND original_url = $2
      ORDER BY fetched_at DESC NULLS LAST, updated_at DESC
      LIMIT 1
    `, [osmId, originalUrl]);
    return result.rows[0] || null;
  }

  async savePoiHomepageHarvest(osmId, {
    originalUrl,
    finalUrl = null,
    fetchStatus = 'completed',
    httpStatus = null,
    contentType = null,
    title = null,
    metaDescription = null,
    textContent = null,
    imageUrls = [],
    error = null,
    refreshDays = HOMEPAGE_HARVEST_REFRESH_DAYS_DEFAULT,
  } = {}) {
    await this.ensureAiSummaryColumns();
    const normalizedImages = Array.isArray(imageUrls)
      ? imageUrls.map(sanitizeHttpUrl).filter(Boolean).slice(0, 20)
      : [];
    const harvest = {
      finalUrl,
      title,
      metaDescription,
      textContent,
      imageUrls: normalizedImages,
    };
    const contentHash = homepageHarvestContentHash(harvest);
    const nextFetchAt = homepageHarvestRefreshAt(fetchStatus, refreshDays);

    const result = await this.pool.query(`
      INSERT INTO poi_homepage_harvests (
        osm_id,
        original_url,
        final_url,
        fetch_status,
        http_status,
        content_type,
        title,
        meta_description,
        text_content,
        image_urls,
        content_hash,
        fetch_error,
        fetched_at,
        next_fetch_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, CURRENT_TIMESTAMP, $13, CURRENT_TIMESTAMP
      )
      ON CONFLICT (osm_id, original_url) DO UPDATE SET
        final_url = EXCLUDED.final_url,
        fetch_status = EXCLUDED.fetch_status,
        http_status = EXCLUDED.http_status,
        content_type = EXCLUDED.content_type,
        title = EXCLUDED.title,
        meta_description = EXCLUDED.meta_description,
        text_content = EXCLUDED.text_content,
        image_urls = EXCLUDED.image_urls,
        content_hash = EXCLUDED.content_hash,
        fetch_error = EXCLUDED.fetch_error,
        fetched_at = CURRENT_TIMESTAMP,
        next_fetch_at = EXCLUDED.next_fetch_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        osm_id,
        original_url,
        final_url,
        fetch_status,
        http_status,
        content_type,
        title,
        meta_description,
        text_content,
        image_urls,
        content_hash,
        fetch_error,
        fetched_at,
        next_fetch_at
    `, [
      osmId,
      originalUrl,
      finalUrl,
      fetchStatus,
      httpStatus,
      contentType,
      title,
      metaDescription,
      textContent,
      JSON.stringify(normalizedImages),
      contentHash,
      error,
      nextFetchAt,
    ]);
    return result.rows[0] || null;
  }

  async harvestPoiHomepage(osmId, { force = false, homepageFetcher = fetchHomepageHarvest } = {}) {
    const place = await this.getPlaceForAiSummary(osmId);
    if (!place) return { skipped: true, reason: `No active Google Places enrichment found for OSM ${osmId}` };

    const homepageUrl = sanitizeHttpUrl(place.website_uri) || sanitizeHttpUrl(place.osm_website);
    if (!homepageUrl) return { skipped: true, reason: `No homepage URL found for OSM ${osmId}` };

    const { refreshDays } = await this.getHomepageHarvestConfig();
    const existing = await this.getLatestHomepageHarvest(osmId, homepageUrl);
    if (!force && existing && isFutureDate(existing.next_fetch_at)) {
      return {
        skipped: true,
        reason: `Homepage harvest is fresh until ${new Date(existing.next_fetch_at).toISOString()}`,
        harvest: existing,
        previousHarvest: existing,
        contentChanged: false,
      };
    }

    const harvested = await homepageFetcher(homepageUrl);
    const harvest = typeof harvested === 'string'
      ? {
          originalUrl: homepageUrl,
          finalUrl: homepageUrl,
          fetchStatus: harvested ? 'completed' : 'empty',
          httpStatus: null,
          contentType: '',
          title: '',
          metaDescription: '',
          textContent: harvested,
          imageUrls: [],
          error: null,
        }
      : harvested;

    const saved = await this.savePoiHomepageHarvest(osmId, {
      originalUrl: homepageUrl,
      finalUrl: harvest?.finalUrl || homepageUrl,
      fetchStatus: harvest?.fetchStatus || 'empty',
      httpStatus: harvest?.httpStatus || null,
      contentType: harvest?.contentType || null,
      title: harvest?.title || null,
      metaDescription: harvest?.metaDescription || null,
      textContent: harvest?.textContent || null,
      imageUrls: harvest?.imageUrls || [],
      error: harvest?.error || null,
      refreshDays,
    });

    return {
      skipped: false,
      harvest: saved,
      previousHarvest: existing,
      contentChanged: !existing || existing.content_hash !== saved?.content_hash,
    };
  }

  async getPlaceForAiSummary(osmId) {
    await this.ensureAiSummaryColumns();
    const result = await this.pool.query(`
      SELECT
        p.osm_id,
        p.poi_type,
        p.website AS osm_website,
        c.name AS city,
        g.google_place_id,
        g.name,
        g.primary_type,
        g.formatted_address,
        g.website_uri,
        g.rating,
        g.user_rating_count,
        g.reviews,
        g.ai_review_summary,
        h.summary AS ai_homepage_summary,
        h.original_url AS ai_homepage_url,
        h.summary_status AS ai_homepage_summary_status
      FROM osm_google_mappings m
      JOIN osm_pois p ON p.osm_id = m.osm_id
      LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
      JOIN google_places g ON g.google_place_id = m.google_place_id
      LEFT JOIN LATERAL (
        SELECT summary, original_url, summary_status
        FROM poi_homepage_summaries
        WHERE osm_id = p.osm_id
        ORDER BY summarized_at DESC NULLS LAST, updated_at DESC
        LIMIT 1
      ) h ON true
      WHERE m.osm_id = $1
        AND m.mapping_status = 'active'
        AND m.google_place_id IS NOT NULL
    `, [osmId]);
    return result.rows[0] || null;
  }

  async summarizeEnrichedPOI(osmId, { force = false, summarizer = null } = {}) {
    const config = await this.getOpenRouterPlaceSummaryConfig();
    if (!config.reviewSummaryEnabled && !config.homepageSummaryEnabled) {
      return { skipped: true, reason: 'OpenRouter summaries are disabled or no OpenRouter API key is configured' };
    }

    const place = await this.getPlaceForAiSummary(osmId);
    if (!place) {
      return { skipped: true, reason: `No active Google Places enrichment found for OSM ${osmId}` };
    }

    const reviewDue = config.reviewSummaryEnabled &&
      (force || !place.ai_review_summary) &&
      Array.isArray(place.reviews) &&
      place.reviews.length > 0;
    const homepageUrl = sanitizeHttpUrl(place.website_uri) || sanitizeHttpUrl(place.osm_website);
    const latestHomepageHarvest = homepageUrl
      ? await this.getLatestHomepageHarvest(place.osm_id, homepageUrl)
      : null;
    const homepageHarvestDue = config.homepageSummaryEnabled &&
      homepageUrl &&
      (force || !latestHomepageHarvest || !isFutureDate(latestHomepageHarvest.next_fetch_at));
    const homepageSummaryDue = config.homepageSummaryEnabled &&
      homepageUrl &&
      (force || !place.ai_homepage_summary || place.ai_homepage_url !== homepageUrl);
    const homepageDue = homepageHarvestDue || homepageSummaryDue;

    if (!reviewDue && !homepageDue) {
      return { skipped: true, reason: `No AI summary work due for OSM ${osmId}` };
    }

    const client = summarizer || createOpenRouterPlaceSummarizer({ apiKey: config.apiKey, model: config.model });
    const updates = {
      reviewSummary: null,
      homepageSummary: null,
      homepageUrl: null,
      homepageFinalUrl: null,
      homepageHarvest: null,
      status: 'completed',
      error: null,
    };

    try {
      if (reviewDue) {
        updates.reviewSummary = await client.summarizeReviews(place);
      }
      if (homepageDue) {
        const homepageHarvestResult = homepageHarvestDue
          ? await this.harvestPoiHomepage(place.osm_id, { force })
          : { skipped: true, harvest: latestHomepageHarvest, previousHarvest: latestHomepageHarvest, contentChanged: false };
        const homepageHarvest = homepageHarvestResult?.harvest || null;
        const homepageText = homepageHarvest?.text_content || '';
        const shouldSummarizeHomepage = homepageText && (
          homepageSummaryDue ||
          homepageHarvestResult?.contentChanged
        );
        const homepageResult = shouldSummarizeHomepage
          ? await client.summarizeHomepage({
              ...place,
              homepage_text: homepageText,
              homepage_url: homepageHarvest.final_url || homepageUrl,
            })
          : null;
        updates.homepageHarvest = homepageHarvest;
        updates.homepageSummary = homepageResult?.summary || null;
        updates.homepageUrl = homepageUrl;
        updates.homepageFinalUrl = homepageResult?.url || homepageHarvest?.final_url || homepageUrl;
      }

      if (updates.reviewSummary) {
        await this.saveAiReviewSummary(place.google_place_id, {
          summary: updates.reviewSummary,
          status: updates.status,
          error: updates.error,
          model: client.model || config.model,
        });
      }
      if (updates.homepageSummary) {
        await this.savePoiHomepageSummary(place.osm_id, {
          originalUrl: updates.homepageUrl,
          summary: updates.homepageSummary,
          status: updates.status,
          error: updates.error,
          model: client.model || config.model,
        });
      }
      return {
        skipped: false,
        googlePlaceId: place.google_place_id,
        reviewSummary: updates.reviewSummary,
        homepageSummary: updates.homepageSummary,
        homepageUrl: updates.homepageUrl,
        homepageFinalUrl: updates.homepageFinalUrl,
        homepageHarvest: updates.homepageHarvest,
      };
    } catch (error) {
      if (reviewDue) {
        await this.saveAiReviewSummary(place.google_place_id, {
          status: 'error',
          error: error.message,
          model: client.model || config.model,
        }).catch(() => {});
      }
      if (homepageDue) {
        await this.savePoiHomepageSummary(place.osm_id, {
          originalUrl: homepageUrl,
          status: 'error',
          error: error.message,
          model: client.model || config.model,
        }).catch(() => {});
      }
      throw error;
    }
  }

  async saveAiReviewSummary(googlePlaceId, {
    summary = null,
    status = 'completed',
    error = null,
    model = null,
  } = {}) {
    await this.ensureAiSummaryColumns();
    await this.pool.query(`
      UPDATE google_places
      SET
        ai_review_summary = COALESCE($2, ai_review_summary),
        ai_review_summary_model = COALESCE($3, ai_review_summary_model),
        ai_review_summary_status = $4,
        ai_review_summary_error = $5,
        ai_review_summarized_at = CURRENT_TIMESTAMP
      WHERE google_place_id = $1
    `, [googlePlaceId, summary, model, status, error]);
  }

  async savePoiHomepageSummary(osmId, {
    originalUrl,
    summary = null,
    status = 'completed',
    error = null,
    model = null,
  } = {}) {
    await this.ensureAiSummaryColumns();
    await this.pool.query(`
      INSERT INTO poi_homepage_summaries (
        osm_id,
        original_url,
        summary,
        summary_model,
        summary_status,
        summary_error,
        summarized_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (osm_id, original_url) DO UPDATE SET
        summary = COALESCE(EXCLUDED.summary, poi_homepage_summaries.summary),
        summary_model = COALESCE(EXCLUDED.summary_model, poi_homepage_summaries.summary_model),
        summary_status = EXCLUDED.summary_status,
        summary_error = EXCLUDED.summary_error,
        summarized_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `, [osmId, originalUrl, summary, model, status, error]);
  }

  async getDueAiSummaryEntries(limit = 100) {
    await this.ensureAiSummaryColumns();
    const result = await this.pool.query(`
      SELECT m.osm_id
      FROM osm_google_mappings m
      JOIN osm_pois p ON p.osm_id = m.osm_id
      JOIN google_places g ON g.google_place_id = m.google_place_id
      WHERE m.mapping_status = 'active'
        AND m.google_place_id IS NOT NULL
        AND (
          (
            g.reviews IS NOT NULL
            AND jsonb_typeof(g.reviews) = 'array'
            AND jsonb_array_length(g.reviews) > 0
            AND g.ai_review_summary IS NULL
          )
          OR (
            COALESCE(NULLIF(g.website_uri, ''), NULLIF(p.website, '')) IS NOT NULL
            AND (
              NOT EXISTS (
                SELECT 1
                FROM poi_homepage_harvests hh
                WHERE hh.osm_id = m.osm_id
                  AND hh.original_url = COALESCE(NULLIF(g.website_uri, ''), NULLIF(p.website, ''))
              )
              OR EXISTS (
                SELECT 1
                FROM poi_homepage_harvests hh
                WHERE hh.osm_id = m.osm_id
                  AND hh.original_url = COALESCE(NULLIF(g.website_uri, ''), NULLIF(p.website, ''))
                  AND (
                    hh.next_fetch_at IS NULL
                    OR hh.next_fetch_at <= CURRENT_TIMESTAMP
                  )
              )
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM poi_homepage_summaries h
                  WHERE h.osm_id = m.osm_id
                    AND h.original_url = COALESCE(NULLIF(g.website_uri, ''), NULLIF(p.website, ''))
                    AND h.summary IS NOT NULL
                )
                AND EXISTS (
                  SELECT 1
                  FROM poi_homepage_harvests hh
                  WHERE hh.osm_id = m.osm_id
                    AND hh.original_url = COALESCE(NULLIF(g.website_uri, ''), NULLIF(p.website, ''))
                    AND COALESCE(NULLIF(hh.text_content, ''), NULL) IS NOT NULL
                    AND (
                      hh.next_fetch_at IS NULL
                      OR hh.next_fetch_at > CURRENT_TIMESTAMP
                    )
                )
              )
            )
          )
        )
      ORDER BY g.enriched_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async getDueHomepageHarvestEntries(limit = 100) {
    await this.ensureAiSummaryColumns();
    const result = await this.pool.query(`
      SELECT m.osm_id
      FROM osm_google_mappings m
      JOIN osm_pois p ON p.osm_id = m.osm_id
      JOIN google_places g ON g.google_place_id = m.google_place_id
      LEFT JOIN poi_homepage_harvests h
        ON h.osm_id = m.osm_id
        AND h.original_url = COALESCE(NULLIF(g.website_uri, ''), NULLIF(p.website, ''))
      WHERE m.mapping_status = 'active'
        AND m.google_place_id IS NOT NULL
        AND COALESCE(NULLIF(g.website_uri, ''), NULLIF(p.website, '')) IS NOT NULL
        AND (
          h.osm_id IS NULL
          OR h.next_fetch_at IS NULL
          OR h.next_fetch_at <= CURRENT_TIMESTAMP
        )
      ORDER BY COALESCE(h.next_fetch_at, TIMESTAMP '1970-01-01') ASC, g.enriched_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async recordEnrichmentTask(task) {
    await this.ensureAiSummaryColumns();
    await this.pool.query(`
      INSERT INTO enrichment_tasks (
        task_id,
        kind,
        status,
        status_message,
        current_item,
        processed,
        succeeded,
        failed,
        total,
        requested_by,
        payload,
        result,
        updated_at,
        completed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP,
        CASE WHEN $3 IN ('completed', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END
      )
      ON CONFLICT (task_id) DO UPDATE SET
        status = EXCLUDED.status,
        status_message = EXCLUDED.status_message,
        current_item = EXCLUDED.current_item,
        processed = EXCLUDED.processed,
        succeeded = EXCLUDED.succeeded,
        failed = EXCLUDED.failed,
        total = EXCLUDED.total,
        requested_by = COALESCE(EXCLUDED.requested_by, enrichment_tasks.requested_by),
        payload = EXCLUDED.payload,
        result = EXCLUDED.result,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CASE
          WHEN EXCLUDED.status IN ('completed', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP
          ELSE enrichment_tasks.completed_at
        END
    `, [
      task.taskId,
      task.kind,
      task.status,
      task.statusMessage,
      task.currentItem,
      task.processed,
      task.succeeded,
      task.failed,
      task.total,
      task.requestedBy ? JSON.stringify(task.requestedBy) : null,
      JSON.stringify(task.payload || {}),
      task.result ? JSON.stringify(task.result) : null,
    ]);
  }

  async listEnrichmentTaskRows({ kind = null, limit = 50 } = {}) {
    await this.ensureAiSummaryColumns();
    const boundedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 50, 1), 200);
    const params = [];
    let where = '';
    if (kind) {
      params.push(kind);
      where = 'WHERE kind = $1';
    }
    params.push(boundedLimit);
    const result = await this.pool.query(`
      SELECT *
      FROM enrichment_tasks
      ${where}
      ORDER BY updated_at DESC
      LIMIT $${params.length}
    `, params);
    return result.rows;
  }

  /**
   * Create or update mapping between OSM POI and Google Place
   */
  async createMapping(osmId, googlePlaceId, metadata = {}) {
    await this.ensureGoogleMappingScheduleColumn();

    const {
      match_confidence = null,
      match_method = null,
      match_distance_meters = null,
      mapping_status = 'active',
      mapping_notes = null,
      next_enrichment_at = null,
      preserve_mapped_at = false,
    } = metadata;

    if (!googlePlaceId) {
      // Insert mapping with NULL google_place_id for non-active statuses
      if (['not_found', 'error', 'pending'].includes(mapping_status)) {
        const mappedAtUpdate = preserve_mapped_at
          ? 'mapped_at = COALESCE(osm_google_mappings.mapped_at, CURRENT_TIMESTAMP)'
          : 'mapped_at = CURRENT_TIMESTAMP';
        await this.pool.query(`
          INSERT INTO osm_google_mappings (
            osm_id,
            google_place_id,
            mapping_status,
            mapping_notes,
            next_enrichment_at,
            mapped_at
          ) VALUES ($1, NULL, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (osm_id) DO UPDATE SET
            mapping_status = EXCLUDED.mapping_status,
            mapping_notes = EXCLUDED.mapping_notes,
            next_enrichment_at = EXCLUDED.next_enrichment_at,
            ${mappedAtUpdate}
        `, [osmId, mapping_status, mapping_notes, next_enrichment_at]);
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
        next_enrichment_at,
        mapped_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (osm_id) DO UPDATE SET
        google_place_id = EXCLUDED.google_place_id,
        match_confidence = EXCLUDED.match_confidence,
        match_method = EXCLUDED.match_method,
        match_distance_meters = EXCLUDED.match_distance_meters,
        mapping_status = EXCLUDED.mapping_status,
        mapping_notes = EXCLUDED.mapping_notes,
        next_enrichment_at = EXCLUDED.next_enrichment_at,
        mapped_at = CURRENT_TIMESTAMP
    `, [
      osmId,
      googlePlaceId,
      match_confidence,
      match_method,
      match_distance_meters,
      mapping_status,
      mapping_notes,
      next_enrichment_at
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
  async batchEnrichPOIs(osmIds) {
    if (!Array.isArray(osmIds) || osmIds.length === 0) {
      return;
    }

    await this.ensureGoogleMappingScheduleColumn();

    // Skip any POI already being enriched (lock held by getPOIDetails stale handler or null handler).
    // enrichOSMPOI itself enforces skip-if-active and daily quota limits.
    const uniqueIds = [...new Set(osmIds)].filter(id => !this._enrichmentLock.has(getEnrichmentLockKey(id)));
    if (uniqueIds.length === 0) return;

    const dueResult = await this.pool.query(`
      SELECT candidate.osm_id
      FROM unnest($1::bigint[]) AS candidate(osm_id)
      LEFT JOIN osm_google_mappings m ON m.osm_id = candidate.osm_id
      WHERE m.osm_id IS NULL
        OR m.next_enrichment_at IS NULL
        OR m.next_enrichment_at <= CURRENT_TIMESTAMP
      ORDER BY
        COALESCE(m.next_enrichment_at, m.mapped_at, TIMESTAMP '1970-01-01') ASC,
        candidate.osm_id ASC
    `, [uniqueIds]);

    for (const { osm_id } of dueResult.rows) {
      await this.enrichOSMPOI(osm_id).catch(err => {
        console.error(`Background enrichment error for OSM ${osm_id}:`, err.message);
        telemetry.captureException(err, { context: 'batch_enrichment', osmId: osm_id });
      });
    }
  }

  getActiveEnrichmentOperations() {
    return Array.from(this._enrichmentLockInfo.values()).map(info => ({
      ...info,
      ageMs: Math.max(0, Date.now() - new Date(info.startedAt).getTime()),
    }));
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

}

Object.assign(TravelDatabase.prototype, databaseUserMethods);
Object.assign(TravelDatabase.prototype, databaseImportMethods);

export default TravelDatabase;
