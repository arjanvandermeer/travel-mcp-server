-- Migration: Add Google Places tables to existing database
-- This script adds the google_places and osm_google_mappings tables
-- without dropping existing data

-- Drop view first (will be recreated)
DROP VIEW IF EXISTS enriched_pois CASCADE;

-- ============================================================================
-- Google Places Data Storage
-- ============================================================================
CREATE TABLE IF NOT EXISTS google_places (
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

CREATE INDEX IF NOT EXISTS idx_google_places_location ON google_places USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_google_places_name ON google_places(name);
CREATE INDEX IF NOT EXISTS idx_google_places_rating ON google_places(rating DESC) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_google_places_types ON google_places USING GIN(types);

-- ============================================================================
-- OSM to Google Places Mapping
-- ============================================================================
CREATE TABLE IF NOT EXISTS osm_google_mappings (
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

CREATE INDEX IF NOT EXISTS idx_osm_google_mappings_google_id ON osm_google_mappings(google_place_id);
CREATE INDEX IF NOT EXISTS idx_osm_google_mappings_status ON osm_google_mappings(mapping_status);
CREATE INDEX IF NOT EXISTS idx_osm_google_mappings_mapped_at ON osm_google_mappings(mapped_at DESC);

-- ============================================================================
-- Recreate Enriched POIs View with new Google tables
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
