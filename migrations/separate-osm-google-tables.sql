-- Migration: Separate OSM and Google Places data into distinct tables
--
-- This migration:
-- 1. Renames 'pois' to 'osm_pois' (OpenStreetMap source data)
-- 2. Creates 'google_places' table (Google Places enrichment data)
-- 3. Creates 'osm_google_mappings' table (links OSM POIs to Google Places)
--
-- Benefits:
-- - Clear separation of concerns (OSM vs Google data)
-- - OSM data can be refreshed independently
-- - Google Places data has its own lifecycle and caching
-- - One Google Place can match multiple OSM POIs (e.g., chain locations)
-- - Cleaner schema, easier to maintain

-- ============================================================================
-- Step 1: Drop existing pois table (we'll reimport OSM data)
-- ============================================================================

DROP TABLE IF EXISTS pois CASCADE;

-- ============================================================================
-- Step 2: Create osm_pois table (OSM source data only)
-- ============================================================================

CREATE TABLE osm_pois (
    osm_id BIGINT PRIMARY KEY,
    osm_type VARCHAR(10) NOT NULL,          -- 'node', 'way', 'relation'
    poi_type VARCHAR(50) NOT NULL,          -- hotel, restaurant, cafe, museum, etc.

    -- Basic info from OSM
    name TEXT,
    name_en TEXT,                           -- English name
    name_local TEXT,                        -- Local language name

    -- Location (PostGIS)
    location GEOGRAPHY(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Address info from OSM
    street TEXT,
    housenumber TEXT,
    postcode TEXT,
    city TEXT,
    country TEXT,
    country_code VARCHAR(2),

    -- Contact info from OSM
    phone TEXT,
    email TEXT,
    website TEXT,

    -- Details from OSM
    description TEXT,
    wikipedia TEXT,
    wikidata TEXT,
    brand TEXT,
    operator TEXT,

    -- Type-specific attributes (stored as JSONB for flexibility)
    osm_tags JSONB,                         -- All OSM tags

    -- Hotel-specific (if poi_type = hotel/hostel/etc)
    stars INTEGER,                          -- Star rating from OSM
    rooms INTEGER,
    beds INTEGER,

    -- Metadata
    import_id INTEGER REFERENCES imports(id),
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT osm_pois_type_check CHECK (osm_type IN ('node', 'way', 'relation'))
);

-- Spatial index for location-based queries
CREATE INDEX idx_osm_pois_location ON osm_pois USING GIST(location);
CREATE INDEX idx_osm_pois_poi_type ON osm_pois(poi_type);
CREATE INDEX idx_osm_pois_name ON osm_pois USING GIN(to_tsvector('english', COALESCE(name, '')));
CREATE INDEX idx_osm_pois_country ON osm_pois(country_code);
CREATE INDEX idx_osm_pois_city ON osm_pois(city);

COMMENT ON TABLE osm_pois IS 'OpenStreetMap POI data (hotels, restaurants, attractions, etc.)';

-- ============================================================================
-- Step 3: Create google_places table (Google Places enrichment data)
-- ============================================================================

CREATE TABLE google_places (
    google_place_id VARCHAR(200) PRIMARY KEY,

    -- Basic info from Google Places
    name TEXT NOT NULL,
    display_name JSONB,                     -- {text: "name", languageCode: "en"}

    -- Location from Google (may differ slightly from OSM)
    location GEOGRAPHY(Point, 4326),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,

    -- Google-specific identifiers
    types TEXT[],                           -- Google place types
    primary_type TEXT,
    primary_type_display TEXT,

    -- Contact & Address
    formatted_address TEXT,
    short_formatted_address TEXT,
    international_phone TEXT,
    national_phone TEXT,
    website_uri TEXT,
    google_maps_uri TEXT,

    -- Ratings & Reviews
    rating DECIMAL(2,1),
    user_rating_count INTEGER,
    price_level TEXT,                       -- PRICE_LEVEL_FREE, PRICE_LEVEL_INEXPENSIVE, etc.

    -- Business info
    business_status TEXT,                   -- OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY
    editorial_summary TEXT,                 -- Curated description

    -- Opening hours
    opening_hours JSONB,                    -- regularOpeningHours structure
    current_opening_hours JSONB,            -- Real-time hours

    -- Photos
    photos JSONB,                           -- Array of photo objects

    -- Service options (especially for restaurants)
    service_options JSONB,                  -- {delivery, dineIn, takeout, reservable, etc.}

    -- Accessibility & amenities (especially for hotels)
    accessibility JSONB,                    -- Wheelchair access, parking, etc.
    amenities JSONB,                        -- EV charging, parking options, pets, etc.

    -- Additional data
    plus_code JSONB,
    viewport JSONB,
    address_components JSONB,

    -- Enrichment metadata
    enriched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cache_expires_at TIMESTAMP,             -- When to refresh

    -- Full API response (for fields we don't explicitly store)
    raw_response JSONB,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_google_places_location ON google_places USING GIST(location);
CREATE INDEX idx_google_places_types ON google_places USING GIN(types);
CREATE INDEX idx_google_places_rating ON google_places(rating DESC) WHERE rating IS NOT NULL;
CREATE INDEX idx_google_places_business_status ON google_places(business_status);
CREATE INDEX idx_google_places_cache_expires ON google_places(cache_expires_at);

COMMENT ON TABLE google_places IS 'Google Places enrichment data';

-- ============================================================================
-- Step 4: Create osm_google_mappings table (links OSM to Google Places)
-- ============================================================================

CREATE TABLE osm_google_mappings (
    osm_id BIGINT REFERENCES osm_pois(osm_id) ON DELETE CASCADE,
    google_place_id VARCHAR(200) REFERENCES google_places(google_place_id) ON DELETE CASCADE,

    -- Match metadata
    match_confidence DECIMAL(3,2),          -- 0.00 to 1.00 (name similarity score)
    match_method VARCHAR(50),               -- 'nearby_search', 'text_search', 'manual'
    match_distance_meters INTEGER,          -- Distance between OSM and Google coordinates

    -- Status tracking
    mapping_status VARCHAR(20) DEFAULT 'active', -- 'active', 'not_found', 'error'
    mapping_notes TEXT,                     -- Why mapping failed, manual notes, etc.

    -- Metadata
    mapped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP,                  -- If manually verified
    verified_by TEXT,                       -- Who verified (username, system, etc.)

    PRIMARY KEY (osm_id, google_place_id),
    CONSTRAINT mapping_status_check CHECK (mapping_status IN ('active', 'not_found', 'error', 'duplicate', 'manual'))
);

CREATE INDEX idx_osm_google_mappings_osm ON osm_google_mappings(osm_id);
CREATE INDEX idx_osm_google_mappings_google ON osm_google_mappings(google_place_id);
CREATE INDEX idx_osm_google_mappings_status ON osm_google_mappings(mapping_status);
CREATE INDEX idx_osm_google_mappings_confidence ON osm_google_mappings(match_confidence DESC);

COMMENT ON TABLE osm_google_mappings IS 'Maps OSM POIs to Google Places for enrichment';

-- ============================================================================
-- Step 5: Create helper views for common queries
-- ============================================================================

-- View: Enriched POIs (OSM + Google Places data joined)
CREATE OR REPLACE VIEW enriched_pois AS
SELECT
    o.osm_id,
    o.osm_type,
    o.poi_type,
    o.name AS osm_name,
    o.latitude AS osm_latitude,
    o.longitude AS osm_longitude,
    o.location AS osm_location,
    o.street,
    o.city,
    o.country_code,
    o.website AS osm_website,
    o.phone AS osm_phone,
    o.stars AS osm_stars,

    -- Google Places data (may be NULL if not mapped)
    g.google_place_id,
    g.name AS google_name,
    g.rating AS google_rating,
    g.user_rating_count AS google_reviews,
    g.price_level AS google_price_level,
    g.business_status,
    g.formatted_address AS google_address,
    g.national_phone AS google_phone,
    g.website_uri AS google_website,
    g.editorial_summary,
    g.opening_hours,
    g.photos,
    g.service_options,
    g.accessibility,
    g.amenities,

    -- Mapping metadata
    m.match_confidence,
    m.match_method,
    m.mapping_status,
    m.mapped_at AS google_enriched_at,

    -- Determine best values (prefer Google when available)
    COALESCE(g.name, o.name) AS best_name,
    COALESCE(g.latitude, o.latitude) AS best_latitude,
    COALESCE(g.longitude, o.longitude) AS best_longitude,
    COALESCE(g.national_phone, o.phone) AS best_phone,
    COALESCE(g.website_uri, o.website) AS best_website

FROM osm_pois o
LEFT JOIN osm_google_mappings m ON o.osm_id = m.osm_id AND m.mapping_status = 'active'
LEFT JOIN google_places g ON m.google_place_id = g.google_place_id;

COMMENT ON VIEW enriched_pois IS 'Combined view of OSM POIs with Google Places enrichment';

-- View: POIs needing Google enrichment
CREATE OR REPLACE VIEW pois_needing_enrichment AS
SELECT
    o.osm_id,
    o.poi_type,
    o.name,
    o.latitude,
    o.longitude,
    o.city,
    o.country_code
FROM osm_pois o
LEFT JOIN osm_google_mappings m ON o.osm_id = m.osm_id
WHERE m.osm_id IS NULL  -- No mapping exists
   OR (m.mapping_status = 'not_found'
       AND m.mapped_at < NOW() - INTERVAL '7 days')  -- Retry not_found after 7 days
ORDER BY o.imported_at DESC;

COMMENT ON VIEW pois_needing_enrichment IS 'OSM POIs that need Google Places enrichment';

-- ============================================================================
-- Step 6: Update imports table to support new structure
-- ============================================================================

ALTER TABLE imports ADD COLUMN IF NOT EXISTS source_type VARCHAR(50);
UPDATE imports SET source_type = 'osm' WHERE source_type IS NULL;

COMMENT ON COLUMN imports.source_type IS 'Data source: osm, google_places, geonames, etc.';

-- ============================================================================
-- Migration complete!
-- ============================================================================

-- Summary
DO $$
BEGIN
    RAISE NOTICE '=== Migration Complete ===';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  - osm_pois (OpenStreetMap POI data)';
    RAISE NOTICE '  - google_places (Google Places enrichment data)';
    RAISE NOTICE '  - osm_google_mappings (links between OSM and Google)';
    RAISE NOTICE '';
    RAISE NOTICE 'Created views:';
    RAISE NOTICE '  - enriched_pois (combined OSM + Google data)';
    RAISE NOTICE '  - pois_needing_enrichment (POIs to enrich)';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Import OSM data: npm run import:osm';
    RAISE NOTICE '  2. Update code to use new tables';
    RAISE NOTICE '  3. Re-enrich POIs with Google Places';
END $$;
