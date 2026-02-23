-- Migration: Add name_en column for English transliterations of non-Latin POI names
-- Run with: psql $DATABASE_URL < data/migrations/002_add_name_en.sql

-- Step 1: Add column
ALTER TABLE osm_pois ADD COLUMN IF NOT EXISTS name_en VARCHAR(500);

-- Step 2: Trigram index for fuzzy search on name_en
CREATE INDEX IF NOT EXISTS idx_osm_pois_name_en_trgm
  ON osm_pois USING GIN(name_en gin_trgm_ops);

-- Step 3: Recreate enriched_pois view to include name_en
-- (DROP + CREATE required because new column is inserted between existing columns)
DROP VIEW IF EXISTS enriched_pois;
CREATE VIEW enriched_pois AS
SELECT
    -- Core OSM identifiers
    p.osm_id,
    p.osm_type,
    p.poi_type,

    -- OSM data (prefixed with osm_)
    p.name as osm_name,
    p.name_en as osm_name_en,
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

-- Step 4: Update search_osm_pois function to include name_en
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
        GREATEST(
            similarity(p.name, search_query),
            COALESCE(similarity(p.name_en, search_query), 0)
        ) AS similarity_score
    FROM osm_pois p
    WHERE p.name % search_query OR p.name_en % search_query
    ORDER BY similarity_score DESC, p.name
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;
