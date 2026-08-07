# PostgreSQL Database Schema

Complete reference for the Travel MCP Server database schema using PostgreSQL 17 + PostGIS 3.5.

## Quick Reference

**Connection:**
```
postgresql://<user>:<password>@<host>:5432/<database>
```

## Tables Overview

| Table | Description | Access Pattern |
|-------|-------------|----------------|
| `geonames_countries` | Country reference data from GeoNames | Read-heavy |
| `geonames_cities` | City data from GeoNames (150k+ cities) | Read-heavy |
| `geonames_admin1_codes` | State/province codes from GeoNames | Read-heavy |
| `osm_pois` | Points of Interest from OpenStreetMap | Read-heavy |
| `google_places` | Cached Google Places data | Read-heavy (lazy writes) |
| `osm_google_mappings` | Links OSM POIs to Google Places | Read-heavy (lazy writes) |
| `google_api_usage` | Daily API call tracking for rate limiting | Read-write |
| `app_config` | Application configuration settings | Read-heavy |
| `regions` | Named geographic regions (future use) | Read-heavy |
| `hotel_chains` | Chain, brand, Wikidata ID, and alias reference data | Read-heavy |
| `import_log` | Import tracking and history | Read-heavy |
| `import_sources` | Geofabrik source registry and refresh metadata | Read-heavy |
| `users` | User accounts | Read-write |
| `user_tokens` | API tokens for authentication | Read-heavy |
| `user_config` | Per-user configuration | Read-write |
| `user_favorites` | User's saved POIs | Read-write |

### Read-Heavy Tables (Import Data)

The geographic data tables (`geonames_*`, `osm_pois`, `regions`) are **read-heavy** - they are populated via batch imports and rarely updated during normal operation. This allows for aggressive indexing strategies:

- Multiple indexes per table are acceptable (no write penalty)
- Partial indexes for common query patterns (e.g., accommodations, restaurants)
- Trigram indexes for fuzzy text search
- Spatial indexes (GIST) for geographic queries

**Current index counts:**
- `osm_pois`: 13 indexes (104 MB)
- `geonames_cities`: 9 indexes (74 MB)
- `geonames_admin1_codes`: 4 indexes

Data is refreshed via periodic imports (see `scripts/import-*.js`), not real-time updates.

## Core Tables

### geonames_countries

Country reference data from GeoNames.

```sql
CREATE TABLE geonames_countries (
    iso_alpha2 VARCHAR(2) PRIMARY KEY,      -- e.g., "TH", "US"
    iso_alpha3 VARCHAR(3) NOT NULL,         -- e.g., "THA", "USA"
    iso_numeric INTEGER,
    country VARCHAR(200) NOT NULL,          -- Country name
    capital VARCHAR(200),
    population INTEGER,
    continent VARCHAR(2),                   -- e.g., "AS", "EU"
    area_sq_km DOUBLE PRECISION,
    currency_code VARCHAR(3),               -- e.g., "THB", "USD"
    phone VARCHAR(20),                      -- Country phone prefix
    timezone VARCHAR(40),
    geoname_id INTEGER
);
```

### geonames_cities

City data from GeoNames (150k+ cities with population > 1000).

```sql
CREATE TABLE geonames_cities (
    geoname_id INTEGER PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    ascii_name VARCHAR(200),
    location geometry(Point, 4326) NOT NULL,    -- PostGIS point
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    population BIGINT,
    timezone VARCHAR(40),
    feature_class VARCHAR(1),
    feature_code VARCHAR(10),
    admin1_code VARCHAR(20),
    admin2_code VARCHAR(80),

    FOREIGN KEY (country_code) REFERENCES geonames_countries(iso_alpha2)
);
```

**Indexes:**
- GIST spatial index on `location`
- Index on `name`, `country_code`, `population`

### osm_pois

Points of Interest from OpenStreetMap (hotels, restaurants, attractions, etc.).

```sql
CREATE TABLE osm_pois (
    osm_id BIGINT PRIMARY KEY,
    osm_type VARCHAR(10) NOT NULL,              -- 'node', 'way', 'relation'
    poi_type VARCHAR(50) NOT NULL,              -- 'hotel', 'restaurant', 'attraction', etc.
    name VARCHAR(500),
    name_en VARCHAR(500),                       -- English transliteration where available
    location geometry(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Common details
    address VARCHAR(500),
    phone VARCHAR(100),
    email VARCHAR(200),
    website VARCHAR(500),
    opening_hours VARCHAR(500),

    -- Type-specific details
    cuisine VARCHAR(200),                       -- For restaurants
    stars VARCHAR(10),                          -- For hotels (star rating)
    rooms INTEGER,                              -- For hotels
    beds INTEGER,                               -- For hotels
    rating VARCHAR(10),
    wheelchair VARCHAR(20),

    -- Metadata
    tags JSONB,                                 -- All OSM tags as JSON
    source_region VARCHAR(100),                 -- e.g., 'thailand-latest'
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nearest_city_id INTEGER,

    FOREIGN KEY (nearest_city_id) REFERENCES geonames_cities(geoname_id)
);
```

**Indexes:**
- GIST spatial index on `location`
- GIN index on `tags` (JSONB queries)
- GIN trigram index on `name` (fuzzy search)
- Index on `poi_type`, `stars`, `source_region`

### google_places

Cached Google Places API data.

```sql
CREATE TABLE google_places (
    google_place_id VARCHAR(200) PRIMARY KEY,

    -- Basic info
    name VARCHAR(500),
    display_name VARCHAR(500),
    formatted_address TEXT,

    -- Location
    location geometry(Point, 4326),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Classification
    types TEXT[],
    primary_type VARCHAR(100),

    -- Contact
    international_phone VARCHAR(100),
    national_phone VARCHAR(100),
    website_uri VARCHAR(500),
    google_maps_uri VARCHAR(500),

    -- Ratings & Reviews
    rating DECIMAL(2,1),
    user_rating_count INTEGER,
    price_level TEXT,

    -- Status & Details
    business_status VARCHAR(50),
    editorial_summary TEXT,
    opening_hours JSONB,
    photos JSONB,
    service_options JSONB,
    accessibility JSONB,
    amenities JSONB,

    -- Metadata
    enriched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cache_expires_at TIMESTAMP,
    raw_response JSONB
);
```

### osm_google_mappings

Links OSM POIs to Google Places entries.

```sql
CREATE TABLE osm_google_mappings (
    osm_id BIGINT PRIMARY KEY,
    google_place_id VARCHAR(200),

    -- Match quality
    match_confidence DECIMAL(3,2),              -- 0.00 to 1.00
    match_method VARCHAR(50),                   -- 'nearby_search', 'text_search', 'manual'
    match_distance_meters INTEGER,

    -- Status
    mapping_status VARCHAR(20) NOT NULL,        -- 'active', 'pending', 'not_found', 'error'
    mapping_notes TEXT,

    -- Timestamps
    mapped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    next_enrichment_at TIMESTAMP,
    last_verified_at TIMESTAMP,

    FOREIGN KEY (google_place_id) REFERENCES google_places(google_place_id) ON DELETE SET NULL
);
```

### regions

Named geographic regions for "hotels in the Alps" style queries (future use).

```sql
CREATE TABLE regions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    region_type VARCHAR(50),                    -- 'mountain_range', 'administrative', etc.
    boundary geometry(Polygon, 4326),
    osm_id BIGINT,
    osm_type VARCHAR(10),
    tags JSONB,
    source VARCHAR(100),
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### hotel_chains

Reference data for hotel chain and brand filtering.

```sql
CREATE TABLE hotel_chains (
    id SERIAL PRIMARY KEY,
    chain_name VARCHAR(200) NOT NULL,
    brand_name VARCHAR(200) NOT NULL,
    parent_chain VARCHAR(200),
    wikidata_id VARCHAR(50),
    aliases TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_name, brand_name)
);
```

### import_log

Tracks import operations for data provenance.

```sql
CREATE TABLE import_log (
    id SERIAL PRIMARY KEY,
    import_type VARCHAR(50) NOT NULL,           -- 'geonames_countries', 'osm_pois', etc.
    source_file VARCHAR(500),
    source_url VARCHAR(1000),
    source_date DATE,
    region_name VARCHAR(200),
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    records_imported INTEGER,
    error_message TEXT,
    metadata JSONB
);
```

### import_sources

Tracks keyword-to-source mappings for scheduled OSM refreshes.

```sql
CREATE TABLE import_sources (
    id SERIAL PRIMARY KEY,
    keyword VARCHAR(100) UNIQUE NOT NULL,
    source_url VARCHAR(500) NOT NULL,
    display_name VARCHAR(200),
    min_pois INTEGER DEFAULT 100,
    refresh_interval_days INTEGER DEFAULT 30,
    enabled BOOLEAN DEFAULT TRUE,
    last_imported_at TIMESTAMP,
    last_import_id INTEGER REFERENCES import_log(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### app_config

Application configuration settings (API keys, feature flags, etc.).

```sql
CREATE TABLE app_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    encrypted BOOLEAN DEFAULT FALSE,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Default configuration keys:**
- `google_places_api_key` - Google Places API key
- `google_places_enabled` - Enable/disable enrichment (default: true)
- `google_places_cache_hours` - Cache duration (default: 168 = 7 days)
- `google_api_daily_limit` - Daily API call limit (default: 100)
- `server_base_url` - Public base URL used to construct MCP widget resource URIs
- `oauth_issuer` - OAuth provider URL for token introspection

### google_api_usage

Tracks daily Google API call counts for rate limiting.

```sql
CREATE TABLE google_api_usage (
    date_key VARCHAR(10) PRIMARY KEY,    -- YYYY-MM-DD format
    call_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Rate Limiting:**
- Default daily limit: 100 API calls
- Override via `app_config` key `google_api_daily_limit`
- Each POI enrichment uses 2 API calls (search + details)
- Limit resets at midnight UTC

## User Tables

### users

User accounts for authentication.

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    picture_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### user_tokens

API tokens for Phase 1 authentication.

```sql
CREATE TABLE user_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP
);
```

### user_config

Per-user configuration settings.

```sql
CREATE TABLE user_config (
    user_id INTEGER NOT NULL REFERENCES users(id),
    key VARCHAR(100) NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
);
```

### user_favorites

User's saved POIs.

```sql
CREATE TABLE user_favorites (
    user_id INTEGER NOT NULL REFERENCES users(id),
    poi_osm_id BIGINT NOT NULL REFERENCES osm_pois(osm_id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, poi_osm_id)
);
```

## Views

### enriched_pois

Combines OSM and Google Places data with "best" fields.

```sql
CREATE OR REPLACE VIEW enriched_pois AS
SELECT
    -- OSM identifiers
    p.osm_id, p.osm_type, p.poi_type,

    -- OSM data (prefixed)
    p.name as osm_name,
    p.latitude as osm_latitude,
    p.longitude as osm_longitude,
    p.address as osm_address,
    p.phone as osm_phone,
    p.website as osm_website,
    p.stars as osm_stars,
    p.cuisine,

    -- City/Country
    c.name as city,
    c.country_code,

    -- Google Places data
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
    g.business_status,
    m.mapping_status,
    m.mapped_at,

    -- "Best" fields - prefer Google, fall back to OSM
    COALESCE(g.name, p.name) as best_name,
    COALESCE(g.latitude, p.latitude) as best_latitude,
    COALESCE(g.longitude, p.longitude) as best_longitude,
    COALESCE(g.national_phone, p.phone) as best_phone,
    COALESCE(g.website_uri, p.website) as best_website

FROM osm_pois p
LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
LEFT JOIN osm_google_mappings m ON p.osm_id = m.osm_id
LEFT JOIN google_places g ON m.google_place_id = g.google_place_id
    AND m.mapping_status = 'active';
```

## Helper Functions

### find_hotels_near_point

Find hotels within a radius of a point.

```sql
SELECT * FROM find_hotels_near_point(
    13.7563,    -- latitude
    100.5018,   -- longitude
    5000,       -- radius in meters
    50          -- limit
);
```

### find_osm_pois_near_point

Find any POI type near a point.

```sql
SELECT * FROM find_osm_pois_near_point(
    13.7563,        -- latitude
    100.5018,       -- longitude
    5000,           -- radius in meters
    'restaurant',   -- poi_type (or NULL for all)
    20              -- limit
);
```

### search_osm_pois

Fuzzy search POIs by name.

```sql
SELECT * FROM search_osm_pois('democracy monument', 10);
```

### find_hotels_in_region

Find hotels within a named region (when region data is available).

```sql
SELECT * FROM find_hotels_in_region('Alps', 100);
```

## Common Queries

### Search for a city

```sql
SELECT name, country_code, population,
       ST_Y(location) as lat, ST_X(location) as lon
FROM geonames_cities
WHERE name ILIKE '%Bangkok%'
ORDER BY population DESC
LIMIT 10;
```

### Hotels near coordinates

```sql
SELECT name, stars,
       ST_Distance(
           location::geography,
           ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography
       ) / 1000 as distance_km
FROM osm_pois
WHERE poi_type = 'hotel'
  AND ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography,
    10000
)
ORDER BY distance_km
LIMIT 50;
```

### POI type statistics

```sql
SELECT poi_type, COUNT(*) as count
FROM osm_pois
GROUP BY poi_type
ORDER BY count DESC;
```

### Enrichment statistics

```sql
SELECT mapping_status, COUNT(*) as count
FROM osm_google_mappings
GROUP BY mapping_status;
```

### Hotels with amenities (using JSONB)

`search_hotels` and `search_hotels_ui` accept an `amenities` array. Multiple amenities use AND logic and are backed by the `idx_osm_pois_tags_gin` JSONB index on `osm_pois.tags`.

Supported amenity keys map to OSM tags as follows:

| Amenity key | OSM tag key |
|-------------|-------------|
| `wifi` | `internet_access` |
| `pool` | `swimming_pool` |
| `parking` | `parking` |
| `breakfast` | `breakfast` |
| `air_conditioning` | `air_conditioning` |
| `pet_friendly` | `pets` |
| `restaurant` | `restaurant` |
| `spa` | `spa` |
| `gym` | `fitness_centre` |
| `bar` | `bar` |
| `elevator` | `elevator` |

```sql
-- Hotels with WiFi
SELECT name, tags->>'internet_access' as wifi
FROM osm_pois
WHERE poi_type = 'hotel'
  AND tags->>'internet_access' = 'wlan';

-- Hotels with parking
SELECT name
FROM osm_pois
WHERE poi_type = 'hotel'
  AND tags->>'parking' IS NOT NULL;
```

### Hotel chains and brands

The `hotel_chains` reference table stores chain names, sub-brands, optional Wikidata IDs, and aliases used by `search_hotels` / `search_hotels_ui`.

`brand` filters match OSM `brand`, `operator`, and `brand:wikidata` tags directly, plus known aliases in `hotel_chains`.

`chain` filters expand to known sub-brands. For example, `chain="Hilton"` can match Hilton, Conrad, Waldorf Astoria, DoubleTree, Hampton by Hilton, Hilton Garden Inn, Embassy Suites, and Homewood Suites where those names appear in OSM brand/operator tags.

```sql
SELECT chain_name, brand_name, aliases
FROM hotel_chains
WHERE LOWER(chain_name) = LOWER('Hilton')
ORDER BY brand_name;
```

### Hotel intents

`search_hotels` and `search_hotels_ui` accept an `intent` value that expands into explainable OSM filters. Matching results include `hotel_intent` and `hotel_intent_explanation` so callers can show why the result set was shaped that way.

| Intent | Filter signals |
|--------|----------------|
| `remote_work` | `internet_access` present and not `no` |
| `family` | `family_rooms`, `kids_area`, `playground`, or `baby_feeding` present and not `no` |
| `romantic` | `spa`, `swimming_pool`, `garden`, `balcony`, or 4+ OSM stars |
| `budget` | Hostel, guest house, motel, bed and breakfast, camp site, or 2 or fewer OSM stars |
| `accessible` | `wheelchair=yes`, `wheelchair=limited`, or matching wheelchair tag |
| `pet_friendly` | `pets` present and not `no` |

### Stay quality scores

Hotel search results and hotel POI details include `stay_quality_score`, `stay_quality_confidence`, and a `stay_quality` breakdown when the POI type is an accommodation. The score is a 0-100 composite computed at response time from available OSM and Google Places fields:

| Component | Weight | Data source |
|-----------|--------|-------------|
| Google rating | 35 | `google_places.rating` |
| Review volume | 15 | `google_places.user_rating_count`, log-scaled and capped at 1,000 reviews |
| Star classification | 20 | `osm_pois.stars`, capped at 5 |
| Amenity richness | 15 | Positive OSM hotel amenity tags and Google Places amenity flags, capped at 8 signals |
| Nearby restaurant density | 10 | Count of restaurant/cafe/bar/pub/fast-food/food-court POIs within 1.5 km |
| Walkability proxy | 5 | Nearby restaurant count, capped at 10 venues |

Missing rating, review, or star fields are omitted from the denominator instead of treated as zero, so sparse records can still receive a low-confidence score. Amenity and nearby-dining components are treated as zero when no matching data is present because those signals come from local POI data rather than optional Google enrichment.

### Restaurant occasions

`search_restaurants` and `search_restaurants_ui` accept an `occasion` value that expands into explainable restaurant filters. Matching results include `restaurant_occasion` and `restaurant_occasion_explanation`. Rating and price checks use Google Places enrichment when present; results without those Google fields are not excluded solely because the enrichment data is missing.

| Occasion | Filter signals |
|----------|----------------|
| `business_dinner` | Full-service restaurants, reservation/table-service/card-payment tags, 4+ Google rating when known, moderate-or-higher price when known |
| `casual_lunch` | Restaurants, cafes, fast food, or food courts with takeaway, outdoor-seating, cuisine, or moderate/lower price signals |
| `date_night` | Restaurants, bars, or pubs with reservation, outdoor-seating, live-music, cuisine, 4+ Google rating when known, moderate-or-higher price when known |
| `family_meal` | Restaurants, cafes, or fast food with highchair, kids-area, child-friendly, changing-table, or playground tags |
| `quick_bite` | Fast food, cafes, or food courts with takeaway, drive-through, self-service, or inexpensive/free price signals |
| `late_night` | Restaurants, bars, pubs, or fast food with `24/7` or late-hour opening-hours patterns |

## PostGIS Reference

All coordinates use **WGS84 (SRID 4326)**.

**Creating a point:**
```sql
ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
```

**Distance (meters):**
```sql
ST_Distance(point1::geography, point2::geography)
```

**Within radius:**
```sql
ST_DWithin(point::geography, center::geography, radius_meters)
```

**Point in polygon:**
```sql
ST_Contains(polygon, point)
```

## Database Operations

### Initialize Schema

```bash
# Safely apply missing schema objects
psql $DATABASE_URL < data/schema.sql

# Destructive local development reset
npm run db:reset
```

### Import Data

```bash
# Import GeoNames
node scripts/import-geonames.js

# Import OSM data
node scripts/import-osm.js data/thailand-latest.osm.pbf all
```

### Backup/Restore

```bash
# Backup
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```
