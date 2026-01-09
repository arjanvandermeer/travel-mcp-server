-- PostgreSQL + PostGIS Schema for Travel MCP Server
-- Run this after PostgreSQL with PostGIS is running

-- Enable PostGIS extension (should already be enabled, but ensures it)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS imports CASCADE;
DROP TABLE IF EXISTS pois CASCADE;
DROP TABLE IF EXISTS hotels CASCADE;
DROP TABLE IF EXISTS geonames_cities CASCADE;
DROP TABLE IF EXISTS geonames_countries CASCADE;
DROP TABLE IF EXISTS regions CASCADE;

-- ============================================================================
-- Import Tracking
-- ============================================================================
CREATE TABLE imports (
    id SERIAL PRIMARY KEY,
    import_type VARCHAR(50) NOT NULL,        -- 'geonames_countries', 'geonames_cities', 'pois', 'regions'
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
-- POIs (Points of Interest)
-- All types: hotels, restaurants, attractions, monuments, museums, etc.
-- Unified table matching OSM's data model
-- ============================================================================
CREATE TABLE pois (
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

    -- Google Places enrichment data
    google_place_id VARCHAR(200),               -- Google Places ID
    google_rating DECIMAL(2,1),                 -- Google rating (0.0 - 5.0)
    google_user_ratings_total INTEGER,          -- Number of Google reviews
    google_price_level INTEGER,                 -- Price level (0-4: free to very expensive)
    google_types TEXT[],                        -- Google place types array
    google_formatted_address TEXT,              -- Google's formatted address
    google_phone VARCHAR(100),                  -- Verified phone from Google
    google_website VARCHAR(500),                -- Verified website from Google
    google_opening_hours JSONB,                 -- Detailed opening hours from Google
    google_photos JSONB,                        -- Photo references from Google
    google_enriched_at TIMESTAMP,               -- When Google data was fetched
    google_enrichment_status VARCHAR(20),       -- 'pending', 'enriched', 'not_found', 'error'

    -- Metadata
    tags JSONB,                                 -- All OSM tags as JSON
    source_region VARCHAR(100),                 -- e.g., 'thailand-latest'
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nearest_city_id INTEGER,

    FOREIGN KEY (nearest_city_id) REFERENCES geonames_cities(geoname_id)
);

-- Indexes
CREATE INDEX idx_pois_location ON pois USING GIST(location);
CREATE INDEX idx_pois_name ON pois(name);
CREATE INDEX idx_pois_type ON pois(poi_type);
CREATE INDEX idx_pois_type_name ON pois(poi_type, name);  -- For type-specific searches
CREATE INDEX idx_pois_source_region ON pois(source_region);
CREATE INDEX idx_pois_nearest_city ON pois(nearest_city_id);
CREATE INDEX idx_pois_tags ON pois USING GIN(tags);
CREATE INDEX idx_pois_name_trgm ON pois USING GIN(name gin_trgm_ops);  -- For fuzzy search
CREATE INDEX idx_pois_stars ON pois(stars) WHERE stars IS NOT NULL;  -- For hotel filtering
CREATE INDEX idx_pois_google_place_id ON pois(google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX idx_pois_google_enrichment_status ON pois(google_enrichment_status);

-- Enable trigram extension for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
    FROM pois p
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
    FROM pois p
    JOIN regions r ON ST_Contains(r.boundary, p.location)
    WHERE p.poi_type = 'hotel'
      AND (r.name ILIKE region_name OR r.name_en ILIKE region_name)
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to search POIs by name (fuzzy search)
-- Usage: SELECT * FROM search_pois('democracy monument', 10);
CREATE OR REPLACE FUNCTION search_pois(
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
    FROM pois p
    WHERE p.name % search_query  -- Fuzzy match using trigrams
    ORDER BY similarity_score DESC, p.name
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to find POIs near a point
-- Usage: SELECT * FROM find_pois_near_point(13.7563, 100.5018, 5000, 'attraction', 20);
CREATE OR REPLACE FUNCTION find_pois_near_point(
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
        FROM pois p
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
        FROM pois p
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
-- SELECT COUNT(*) FROM pois;
-- SELECT COUNT(*) FROM pois WHERE poi_type = 'hotel';
-- SELECT COUNT(*) FROM pois WHERE poi_type = 'restaurant';
-- SELECT COUNT(*) FROM regions;
-- SELECT PostGIS_Version();
--
-- Test queries:
-- SELECT * FROM find_hotels_near_point(13.7563, 100.5018, 5000, 10);
-- SELECT * FROM search_pois('democracy monument', 10);
-- SELECT * FROM find_pois_near_point(13.7563, 100.5018, 5000, 'restaurant', 20);
--
-- Get POI type statistics:
-- SELECT poi_type, COUNT(*) as count FROM pois GROUP BY poi_type ORDER BY count DESC;
