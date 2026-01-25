-- PostgreSQL + PostGIS Schema for Travel MCP Server
-- Run this after PostgreSQL with PostGIS is running

-- Enable PostGIS extension (should already be enabled, but ensures it)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS osm_google_mappings CASCADE;
DROP TABLE IF EXISTS google_places CASCADE;
DROP TABLE IF EXISTS imports CASCADE;
DROP TABLE IF EXISTS osm_pois CASCADE;
DROP TABLE IF EXISTS hotels CASCADE;
DROP TABLE IF EXISTS geonames_cities CASCADE;
DROP TABLE IF EXISTS geonames_countries CASCADE;
DROP TABLE IF EXISTS regions CASCADE;

-- ============================================================================
-- Import Tracking
-- ============================================================================
CREATE TABLE imports (
    id SERIAL PRIMARY KEY,
    import_type VARCHAR(50) NOT NULL,        -- 'geonames_countries', 'geonames_cities', 'osm_pois', 'regions'
    source_file VARCHAR(500),                -- e.g., 'thailand-latest.osm.pbf', 'allCountries.txt'
    source_url VARCHAR(1000),                -- Original download URL
    source_date DATE,                        -- Date of source file (from filename or metadata)
    region_name VARCHAR(200),                -- For regional imports (e.g., 'thailand-latest', 'bangkok')
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'running', 'completed', 'failed'
    records_imported INTEGER,
    error_message TEXT,
    metadata JSONB                           -- Additional import details
);

CREATE INDEX idx_imports_type ON imports(import_type);
CREATE INDEX idx_imports_region ON imports(region_name);
CREATE INDEX idx_imports_status ON imports(status);
CREATE INDEX idx_imports_completed ON imports(completed_at DESC);

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
CREATE INDEX idx_countries_geoname_id ON geonames_countries(geoname_id);

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

-- Spatial index for fast geographic queries
CREATE INDEX idx_cities_location ON geonames_cities USING GIST(location);

-- Other useful indexes
CREATE INDEX idx_cities_name ON geonames_cities(name);
CREATE INDEX idx_cities_country ON geonames_cities(country_code);
CREATE INDEX idx_cities_population ON geonames_cities(population DESC);
CREATE INDEX idx_cities_name_country ON geonames_cities(name, country_code);

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
    price_level TEXT,  -- PRICE_LEVEL_FREE, PRICE_LEVEL_INEXPENSIVE, etc.

    -- Status
    business_status VARCHAR(50),  -- OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY

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

-- Indexes
CREATE INDEX idx_osm_pois_location ON osm_pois USING GIST(location);
CREATE INDEX idx_osm_pois_name ON osm_pois(name);
CREATE INDEX idx_osm_pois_type ON osm_pois(poi_type);
CREATE INDEX idx_osm_pois_type_name ON osm_pois(poi_type, name);  -- For type-specific searches
CREATE INDEX idx_osm_pois_source_region ON osm_pois(source_region);
CREATE INDEX idx_osm_pois_nearest_city ON osm_pois(nearest_city_id);
CREATE INDEX idx_osm_pois_tags ON osm_pois USING GIN(tags);
CREATE INDEX idx_osm_pois_name_trgm ON osm_pois USING GIN(name gin_trgm_ops);  -- For fuzzy search
CREATE INDEX idx_osm_pois_stars ON osm_pois(stars) WHERE stars IS NOT NULL;  -- For hotel filtering

-- Enable trigram extension for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Enriched POIs View
-- Provides computed "best" fields that prefer Google data when available,
-- falling back to OSM data
-- ============================================================================
CREATE OR REPLACE VIEW enriched_pois AS
SELECT
    -- Core OSM identifiers
    p.osm_id,
    p.osm_type,
    p.poi_type,

    -- OSM original data (prefixed with osm_)
    p.name as osm_name,
    p.latitude as osm_latitude,
    p.longitude as osm_longitude,
    p.location as osm_location,
    p.address as osm_address,
    p.phone as osm_phone,
    p.website as osm_website,
    p.stars as osm_stars,
    p.cuisine,

    -- Extract city and country from nearest city relationship
    c.name as city,
    c.country_code,
    p.address as street,

    -- Google Places data (from google_places table via mapping)
    g.google_place_id,
    g.name as google_name,
    g.rating as google_rating,
    g.user_rating_count as google_reviews,
    g.price_level as google_price_level,
    g.formatted_address as google_address,
    g.national_phone as google_phone,
    g.website_uri as google_website,
    g.opening_hours,
    g.photos,
    g.enriched_at as google_enriched_at,
    m.mapping_status,

    -- Business status (from Google Places)
    g.business_status,

    -- Additional metadata from Google
    g.editorial_summary,
    g.service_options,
    g.accessibility,
    g.amenities,
    m.match_confidence,
    m.match_method,
    m.mapped_at,

    -- "Best" fields - prefer Google data when available, fall back to OSM
    COALESCE(g.name, p.name) as best_name,
    COALESCE(g.latitude, p.latitude) as best_latitude,
    COALESCE(g.longitude, p.longitude) as best_longitude,
    COALESCE(g.national_phone, p.phone) as best_phone,
    COALESCE(g.website_uri, p.website) as best_website

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
-- Verification Queries
-- ============================================================================

-- Run these after import to verify data:
-- SELECT COUNT(*) FROM geonames_countries;
-- SELECT COUNT(*) FROM geonames_cities;
-- SELECT COUNT(*) FROM osm_pois;
-- SELECT COUNT(*) FROM osm_pois WHERE poi_type = 'hotel';
-- SELECT COUNT(*) FROM osm_pois WHERE poi_type = 'restaurant';
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
