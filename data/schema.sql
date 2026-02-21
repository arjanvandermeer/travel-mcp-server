-- PostgreSQL + PostGIS Schema for Travel MCP Server
-- Run this after PostgreSQL with PostGIS is running

-- Enable PostGIS extension (should already be enabled, but ensures it)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS osm_google_mappings CASCADE;
DROP TABLE IF EXISTS google_places CASCADE;
DROP TABLE IF EXISTS import_sources CASCADE;
DROP TABLE IF EXISTS import_log CASCADE;
DROP TABLE IF EXISTS imports CASCADE;
DROP TABLE IF EXISTS osm_pois CASCADE;
DROP TABLE IF EXISTS hotels CASCADE;
DROP TABLE IF EXISTS geonames_cities CASCADE;
DROP TABLE IF EXISTS geonames_admin1_codes CASCADE;
DROP TABLE IF EXISTS geonames_countries CASCADE;
DROP TABLE IF EXISTS regions CASCADE;

-- ============================================================================
-- Import Tracking
-- ============================================================================
CREATE TABLE import_log (
    id SERIAL PRIMARY KEY,
    import_type VARCHAR(50) NOT NULL,        -- 'geonames_countries', 'geonames_cities', 'osm_all', 'osm_hotel', etc.
    source_file VARCHAR(500),                -- e.g., 'thailand-latest.osm.pbf', 'allCountries.txt'
    source_url VARCHAR(1000),                -- Original download URL
    source_date DATE,                        -- Date of source file (from filename or metadata)
    region_name VARCHAR(200),                -- For regional imports (e.g., 'thailand-latest', 'bangkok')
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'running', 'completed', 'failed', 'aborted'
    records_imported INTEGER,
    error_message TEXT,
    metadata JSONB                           -- Additional import details
);

-- ============================================================================
-- Import Sources (Region Registry)
-- Pre-seeded with 65 regions for automatic Geofabrik downloads
-- ============================================================================
CREATE TABLE import_sources (
    id SERIAL PRIMARY KEY,
    keyword VARCHAR(100) UNIQUE NOT NULL,           -- Short name (e.g., 'france', 'thailand')
    source_url VARCHAR(500) NOT NULL,               -- Geofabrik download URL
    display_name VARCHAR(200),                      -- Human-readable name
    min_pois INTEGER DEFAULT 100,                   -- Minimum POIs expected (fail if fewer)
    refresh_interval_days INTEGER DEFAULT 30,       -- How often to re-import
    enabled BOOLEAN DEFAULT TRUE,                   -- Can disable without deleting
    last_imported_at TIMESTAMP,                     -- When last successfully imported
    last_import_id INTEGER,                         -- FK to import_log
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (last_import_id) REFERENCES import_log(id)
);

CREATE UNIQUE INDEX import_sources_keyword_key ON import_sources(keyword);
CREATE INDEX idx_import_sources_enabled ON import_sources(enabled);

-- ============================================================================
-- Application Configuration
-- Stores API keys and settings that can be managed via database
-- ============================================================================
DROP TABLE IF EXISTS app_config CASCADE;
CREATE TABLE app_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    encrypted BOOLEAN DEFAULT FALSE,  -- Flag if value is encrypted
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration entries
INSERT INTO app_config (key, value, encrypted, description) VALUES
    ('google_places_api_key', NULL, TRUE, 'Google Places API key'),
    ('google_places_enabled', 'true', FALSE, 'Enable/disable Google Places enrichment'),
    ('google_places_cache_hours', '168', FALSE, 'Hours to cache Google Places data (default: 7 days)'),
    ('google_api_daily_limit', '100', FALSE, 'Daily limit for Google Places API calls (default: 100)'),
    ('sentry_dsn', NULL, TRUE, 'Sentry DSN for error tracking and performance monitoring'),
    ('telemetry_enabled', 'true', FALSE, 'Enable/disable telemetry (errors + performance)'),
    ('telemetry_sample_rate', '1.0', FALSE, 'Trace sample rate 0.0-1.0'),
    ('telemetry_environment', 'development', FALSE, 'Environment name for telemetry'),
    ('sentry_send_dev', 'true', FALSE, 'Send telemetry events in development mode')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Google API Usage Tracking
-- Tracks daily API call counts for rate limiting
-- ============================================================================
DROP TABLE IF EXISTS google_api_usage CASCADE;
CREATE TABLE google_api_usage (
    date_key VARCHAR(10) PRIMARY KEY,    -- YYYY-MM-DD format
    call_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GeoNames Countries
-- ============================================================================
CREATE TABLE geonames_countries (
    iso_alpha2 VARCHAR(2) PRIMARY KEY,
    iso_alpha3 VARCHAR(3) NOT NULL,
    iso_numeric INTEGER,
    fips VARCHAR(2),
    country VARCHAR(200) NOT NULL,
    capital VARCHAR(200),
    area_sq_km DOUBLE PRECISION,
    population INTEGER,
    continent VARCHAR(2),
    tld VARCHAR(10),
    currency_code VARCHAR(3),
    currency_name VARCHAR(50),
    phone VARCHAR(20),
    postal_code_format VARCHAR(100),
    postal_code_regex VARCHAR(200),
    languages VARCHAR(200),
    geoname_id INTEGER,
    neighbours VARCHAR(100),
    equivalent_fips_code VARCHAR(10)
);

CREATE INDEX idx_countries_name ON geonames_countries(country);

-- ============================================================================
-- GeoNames Admin1 Codes (States/Provinces)
-- ============================================================================
CREATE TABLE geonames_admin1_codes (
    code VARCHAR(20) PRIMARY KEY,           -- e.g., 'US.NY', 'GB.ENG'
    country_code VARCHAR(2) NOT NULL,       -- ISO country code
    admin1_code VARCHAR(20) NOT NULL,       -- Admin1 code (e.g., 'NY', 'ENG')
    name VARCHAR(200) NOT NULL,             -- Full name (e.g., 'New York')
    ascii_name VARCHAR(200),                -- ASCII version of name
    geoname_id INTEGER,                     -- GeoNames ID for this admin1
    FOREIGN KEY (country_code) REFERENCES geonames_countries(iso_alpha2)
);

CREATE INDEX idx_admin1_country ON geonames_admin1_codes(country_code);
CREATE INDEX idx_admin1_code ON geonames_admin1_codes(admin1_code);
CREATE INDEX idx_admin1_name ON geonames_admin1_codes(name);

-- ============================================================================
-- GeoNames Cities
-- ============================================================================
CREATE TABLE geonames_cities (
    geoname_id INTEGER PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    ascii_name VARCHAR(200),
    alternate_names TEXT,
    location geometry(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    feature_class VARCHAR(1),
    feature_code VARCHAR(10),
    country_code VARCHAR(2) NOT NULL,
    cc2 VARCHAR(200),
    admin1_code VARCHAR(20),
    admin2_code VARCHAR(80),
    admin3_code VARCHAR(20),
    admin4_code VARCHAR(20),
    population BIGINT,
    elevation INTEGER,
    dem INTEGER,
    timezone VARCHAR(40),
    modification_date DATE,
    FOREIGN KEY (country_code) REFERENCES geonames_countries(iso_alpha2)
);

-- Geography index for fast ST_DWithin distance queries
CREATE INDEX idx_geonames_cities_location_geog ON geonames_cities USING GIST((location::geography));

-- Other useful indexes
CREATE INDEX idx_cities_country ON geonames_cities(country_code);
CREATE INDEX idx_cities_country_admin1 ON geonames_cities(country_code, admin1_code);
CREATE INDEX idx_cities_country_population ON geonames_cities(country_code, population DESC);

-- Trigram indexes for fuzzy name search
CREATE INDEX idx_cities_name_trgm ON geonames_cities USING GIN(name gin_trgm_ops);
CREATE INDEX idx_cities_ascii_name_trgm ON geonames_cities USING GIN(ascii_name gin_trgm_ops);

-- Note: Hotels are now stored in the POIs table with poi_type='hotel'
-- This better reflects OSM's data model where hotels are just tourism POIs

-- ============================================================================
-- Regions (for "hotels in the Alps" style queries)
-- ============================================================================
CREATE TABLE regions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    region_type VARCHAR(50), -- 'mountain_range', 'administrative', 'natural', etc.
    boundary geometry(Polygon, 4326),

    -- OSM tags
    osm_id BIGINT,
    osm_type VARCHAR(10),
    tags JSONB,

    -- Metadata
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(100) -- 'osm', 'manual', etc.
);

-- Spatial index for polygon queries
CREATE INDEX idx_regions_boundary ON regions USING GIST(boundary);
CREATE INDEX idx_regions_name ON regions(name);
CREATE INDEX idx_regions_type ON regions(region_type);

-- ============================================================================
-- Google Places Data Storage
-- ============================================================================
CREATE TABLE google_places (
    google_place_id VARCHAR(200) PRIMARY KEY,

    -- Basic info
    name VARCHAR(500),
    display_name VARCHAR(500),
    formatted_address TEXT,
    short_formatted_address TEXT,

    -- Location
    location geometry(Point, 4326),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Classification
    types TEXT[],
    primary_type VARCHAR(100),
    primary_type_display VARCHAR(200),

    -- Contact
    international_phone VARCHAR(100),
    national_phone VARCHAR(100),
    website_uri VARCHAR(500),
    google_maps_uri VARCHAR(500),

    -- Ratings & Reviews
    rating DECIMAL(2,1),
    user_rating_count INTEGER,
    reviews JSONB,  -- Top reviews with author, rating, text, time
    price_level TEXT,  -- PRICE_LEVEL_FREE, PRICE_LEVEL_INEXPENSIVE, etc.

    -- Status & Time
    business_status VARCHAR(50),  -- OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY
    utc_offset_minutes INTEGER,

    -- Additional details
    editorial_summary TEXT,
    opening_hours JSONB,
    current_opening_hours JSONB,
    photos JSONB,
    service_options JSONB,
    accessibility JSONB,
    amenities JSONB,
    plus_code JSONB,
    viewport JSONB,
    address_components JSONB,

    -- Metadata
    enriched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cache_expires_at TIMESTAMP,
    raw_response JSONB
);

CREATE INDEX idx_google_places_location ON google_places USING GIST(location);
CREATE INDEX idx_google_places_name ON google_places(name);
CREATE INDEX idx_google_places_rating ON google_places(rating DESC) WHERE rating IS NOT NULL;
CREATE INDEX idx_google_places_types ON google_places USING GIN(types);

-- ============================================================================
-- OSM to Google Places Mapping
-- ============================================================================
CREATE TABLE osm_google_mappings (
    osm_id BIGINT PRIMARY KEY,
    google_place_id VARCHAR(200),

    -- Match quality
    match_confidence DECIMAL(3,2),  -- 0.00 to 1.00
    match_method VARCHAR(50),  -- 'nearby_search', 'text_search', 'manual'
    match_distance_meters INTEGER,  -- Distance between OSM and Google coordinates

    -- Status
    mapping_status VARCHAR(20) NOT NULL,  -- 'active', 'not_found', 'error', 'outdated'
    mapping_notes TEXT,

    -- Timestamps
    mapped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_verified_at TIMESTAMP,

    FOREIGN KEY (google_place_id) REFERENCES google_places(google_place_id) ON DELETE SET NULL
);

CREATE INDEX idx_osm_google_mappings_google_id ON osm_google_mappings(google_place_id);
CREATE INDEX idx_osm_google_mappings_status ON osm_google_mappings(mapping_status);
CREATE INDEX idx_osm_google_mappings_mapped_at ON osm_google_mappings(mapped_at DESC);

-- ============================================================================
-- POIs (Points of Interest)
-- All types: hotels, restaurants, attractions, monuments, museums, etc.
-- Unified table matching OSM's data model
-- ============================================================================
CREATE TABLE osm_pois (
    osm_id BIGINT PRIMARY KEY,
    osm_type VARCHAR(10) NOT NULL,              -- 'node', 'way', 'relation'
    poi_type VARCHAR(50) NOT NULL,              -- 'hotel', 'restaurant', 'attraction', 'monument', etc.
    name VARCHAR(500),
    location geometry(Point, 4326) NOT NULL,    -- PostGIS point
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Common POI details
    address VARCHAR(500),
    phone VARCHAR(100),
    email VARCHAR(200),
    website VARCHAR(500),
    opening_hours VARCHAR(500),

    -- Type-specific details
    cuisine VARCHAR(200),                       -- For restaurants
    rating VARCHAR(10),                         -- Star rating or review score
    wheelchair VARCHAR(20),                     -- Accessibility
    stars VARCHAR(10),                          -- For hotels (star rating)
    rooms INTEGER,                              -- For hotels
    beds INTEGER,                               -- For hotels

    -- Metadata
    tags JSONB,                                 -- All OSM tags as JSON
    source_region VARCHAR(100),                 -- e.g., 'thailand-latest'
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nearest_city_id INTEGER,

    FOREIGN KEY (nearest_city_id) REFERENCES geonames_cities(geoname_id)
);

-- Geography index for fast ST_DWithin distance queries
CREATE INDEX idx_osm_pois_location_geog ON osm_pois USING GIST((location::geography));

-- Type and lookup indexes
CREATE INDEX idx_osm_pois_type ON osm_pois(poi_type);
CREATE INDEX idx_osm_pois_type_city ON osm_pois(poi_type, nearest_city_id);
CREATE INDEX idx_osm_pois_source_region ON osm_pois(source_region);
CREATE INDEX idx_osm_pois_nearest_city_id ON osm_pois(nearest_city_id) WHERE nearest_city_id IS NOT NULL;

-- Trigram index for fuzzy name search
CREATE INDEX idx_osm_pois_name_trgm ON osm_pois USING GIN(name gin_trgm_ops);

-- Enable trigram extension for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Enriched POIs View
-- Combines OSM POI data with Google Places enrichment data
-- All OSM fields prefixed with osm_, all Google fields prefixed with google_
-- ============================================================================
CREATE OR REPLACE VIEW enriched_pois AS
SELECT
    -- Core OSM identifiers
    p.osm_id,
    p.osm_type,
    p.poi_type,

    -- OSM data (prefixed with osm_)
    p.name as osm_name,
    p.latitude as osm_latitude,
    p.longitude as osm_longitude,
    p.location as osm_location,
    p.address as osm_address,
    p.phone as osm_phone,
    p.email as osm_email,
    p.website as osm_website,
    p.opening_hours as osm_opening_hours,
    p.stars as osm_stars,
    p.rooms as osm_rooms,
    p.beds as osm_beds,
    p.cuisine as osm_cuisine,
    p.wheelchair as osm_wheelchair,
    p.tags->>'brand' as osm_brand,
    p.tags->>'operator' as osm_operator,
    p.tags as osm_tags,
    p.source_region,
    p.imported_at as osm_imported_at,

    -- City/Country from nearest city relationship
    c.name as city,
    c.country_code,
    c.geoname_id as city_geoname_id,

    -- Google Places data (ALL fields, prefixed with google_)
    g.google_place_id,
    g.name as google_name,
    g.display_name as google_display_name,
    g.formatted_address as google_address,
    g.short_formatted_address as google_short_address,
    g.latitude as google_latitude,
    g.longitude as google_longitude,
    g.types as google_types,
    g.primary_type as google_primary_type,
    g.primary_type_display as google_primary_type_display,
    g.international_phone as google_international_phone,
    g.national_phone as google_phone,
    g.website_uri as google_website,
    g.google_maps_uri as google_maps_url,
    g.rating as google_rating,
    g.user_rating_count as google_review_count,
    g.reviews as google_reviews,
    g.price_level as google_price_level,
    g.business_status as google_business_status,
    g.utc_offset_minutes as google_utc_offset_minutes,
    g.editorial_summary as google_editorial_summary,
    g.opening_hours as google_opening_hours,
    g.current_opening_hours as google_current_opening_hours,
    g.photos as google_photos,
    g.service_options as google_service_options,
    g.accessibility as google_accessibility,
    g.amenities as google_amenities,
    g.plus_code as google_plus_code,
    g.address_components as google_address_components,
    g.enriched_at as google_enriched_at,
    g.cache_expires_at as google_cache_expires_at,

    -- Mapping metadata
    m.mapping_status,
    m.match_confidence,
    m.match_method,
    m.match_distance_meters,
    m.mapping_notes,
    m.mapped_at,
    m.last_verified_at

FROM osm_pois p
LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
LEFT JOIN osm_google_mappings m ON p.osm_id = m.osm_id
LEFT JOIN google_places g ON m.google_place_id = g.google_place_id AND m.mapping_status = 'active';

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to find hotels within radius of a point
-- Usage: SELECT * FROM find_hotels_near_point(13.7563, 100.5018, 5000, 50);
CREATE OR REPLACE FUNCTION find_hotels_near_point(
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    radius_meters DOUBLE PRECISION,
    result_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    osm_id BIGINT,
    osm_type VARCHAR(10),
    name VARCHAR(500),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    stars VARCHAR(10),
    distance_meters DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.osm_id,
        p.osm_type,
        p.name,
        p.latitude,
        p.longitude,
        p.stars,
        ST_Distance(
            p.location::geography,
            ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
        ) AS distance_meters
    FROM osm_pois p
    WHERE p.poi_type = 'hotel'
      AND ST_DWithin(
        p.location::geography,
        ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
        radius_meters
    )
    ORDER BY distance_meters
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to find hotels within a named region
-- Usage: SELECT * FROM find_hotels_in_region('Alps', 100);
CREATE OR REPLACE FUNCTION find_hotels_in_region(
    region_name VARCHAR(200),
    result_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    osm_id BIGINT,
    osm_type VARCHAR(10),
    name VARCHAR(500),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    stars VARCHAR(10)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.osm_id,
        p.osm_type,
        p.name,
        p.latitude,
        p.longitude,
        p.stars
    FROM osm_pois p
    JOIN regions r ON ST_Contains(r.boundary, p.location)
    WHERE p.poi_type = 'hotel'
      AND (r.name ILIKE region_name OR r.name_en ILIKE region_name)
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to search POIs by name (fuzzy search)
-- Usage: SELECT * FROM search_osm_pois('democracy monument', 10);
CREATE OR REPLACE FUNCTION search_osm_pois(
    search_query TEXT,
    result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    osm_id BIGINT,
    osm_type VARCHAR(10),
    poi_type VARCHAR(50),
    name VARCHAR(500),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    similarity_score REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.osm_id,
        p.osm_type,
        p.poi_type,
        p.name,
        p.latitude,
        p.longitude,
        similarity(p.name, search_query) AS similarity_score
    FROM osm_pois p
    WHERE p.name % search_query  -- Fuzzy match using trigrams
    ORDER BY similarity_score DESC, p.name
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to find POIs near a point
-- Usage: SELECT * FROM find_osm_pois_near_point(13.7563, 100.5018, 5000, 'attraction', 20);
CREATE OR REPLACE FUNCTION find_osm_pois_near_point(
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    radius_meters DOUBLE PRECISION,
    poi_type_filter VARCHAR(50) DEFAULT NULL,
    result_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    osm_id BIGINT,
    osm_type VARCHAR(10),
    poi_type VARCHAR(50),
    name VARCHAR(500),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    cuisine VARCHAR(200),
    distance_meters DOUBLE PRECISION
) AS $$
BEGIN
    IF poi_type_filter IS NULL THEN
        RETURN QUERY
        SELECT
            p.osm_id,
            p.osm_type,
            p.poi_type,
            p.name,
            p.latitude,
            p.longitude,
            p.cuisine,
            ST_Distance(
                p.location::geography,
                ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
            ) AS distance_meters
        FROM osm_pois p
        WHERE ST_DWithin(
            p.location::geography,
            ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
            radius_meters
        )
        ORDER BY distance_meters
        LIMIT result_limit;
    ELSE
        RETURN QUERY
        SELECT
            p.osm_id,
            p.osm_type,
            p.poi_type,
            p.name,
            p.latitude,
            p.longitude,
            p.cuisine,
            ST_Distance(
                p.location::geography,
                ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
            ) AS distance_meters
        FROM osm_pois p
        WHERE p.poi_type = poi_type_filter
          AND ST_DWithin(
              p.location::geography,
              ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
              radius_meters
          )
        ORDER BY distance_meters
        LIMIT result_limit;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- User Authentication (Optional)
-- Enables per-user features like API limit bypass, favorites, preferences
-- ============================================================================
DROP TABLE IF EXISTS user_favorites CASCADE;
DROP TABLE IF EXISTS user_config CASCADE;
DROP TABLE IF EXISTS user_tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE,           -- Google OAuth subject ID
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    picture_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Note: email already has UNIQUE constraint index (users_email_key), no separate index needed
CREATE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

-- API tokens for authentication
CREATE TABLE user_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,       -- Secure random token
    name VARCHAR(100),                       -- Optional token name (e.g., "Claude Desktop")
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,                    -- NULL = never expires
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP                     -- NULL = active, set to revoke
);

CREATE INDEX idx_user_tokens_token ON user_tokens(token) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_tokens_user ON user_tokens(user_id);

-- Per-user configuration (API limits, preferences, etc.)
CREATE TABLE user_config (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
);

-- Example config entries:
-- INSERT INTO user_config (user_id, key, value) VALUES (1, 'google_places_limit', 'unlimited');
-- INSERT INTO user_config (user_id, key, value) VALUES (1, 'role', 'admin');

-- User favorites
CREATE TABLE user_favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    poi_osm_id BIGINT NOT NULL REFERENCES osm_pois(osm_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    PRIMARY KEY (user_id, poi_osm_id)
);

CREATE INDEX idx_user_favorites_user ON user_favorites(user_id);
CREATE INDEX idx_user_favorites_poi ON user_favorites(poi_osm_id);

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Run these after import to verify data:
-- SELECT COUNT(*) FROM geonames_countries;
-- SELECT COUNT(*) FROM geonames_cities;
-- SELECT COUNT(*) FROM osm_pois;
-- SELECT COUNT(*) FROM osm_pois WHERE poi_type = 'hotel';
-- SELECT COUNT(*) FROM osm_pois WHERE poi_type = 'restaurant';
-- SELECT COUNT(*) FROM import_log WHERE status = 'completed';
-- SELECT COUNT(*) FROM import_sources WHERE enabled = TRUE;
-- SELECT COUNT(*) FROM regions;
-- SELECT PostGIS_Version();
--
-- Test queries:
-- SELECT * FROM find_hotels_near_point(13.7563, 100.5018, 5000, 10);
-- SELECT * FROM search_osm_pois('democracy monument', 10);
-- SELECT * FROM find_osm_pois_near_point(13.7563, 100.5018, 5000, 'restaurant', 20);
--
-- Get POI type statistics:
-- SELECT poi_type, COUNT(*) as count FROM osm_pois GROUP BY poi_type ORDER BY count DESC;
