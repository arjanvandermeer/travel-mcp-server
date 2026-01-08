# PostgreSQL Database Schema

Complete reference for the Travel MCP Server database schema using PostgreSQL 17 + PostGIS 3.5.

## Quick Reference

**Connection:**
```
postgresql://traveluser:travelpass@localhost:5432/travel
```

**Current Data:**
- Countries: 252
- Cities: 33,103
- Hotels: 6,640 (Thailand)
- Regions: 0 (reserved for future use)

## Tables

### geonames_countries

Country reference data from GeoNames.

```sql
CREATE TABLE geonames_countries (
    iso_alpha2 VARCHAR(2) PRIMARY KEY,      -- e.g., "TH", "US"
    iso_alpha3 VARCHAR(3),                  -- e.g., "THA", "USA"
    country VARCHAR(200) NOT NULL,          -- Country name
    population INTEGER,                     -- Country population
    continent VARCHAR(2),                   -- e.g., "AS", "EU"
    capital VARCHAR(200),
    area_sq_km DOUBLE PRECISION,
    currency_code VARCHAR(3),               -- e.g., "THB", "USD"
    phone VARCHAR(20),                      -- Country phone prefix
    timezone VARCHAR(40),
    geoname_id INTEGER,
    ...
);
```

**Key Indexes:**
- Primary key on `iso_alpha2`
- Index on `country` (name search)
- Index on `geoname_id`

### geonames_cities

City data from GeoNames (150k+ cities with population > 1000).

```sql
CREATE TABLE geonames_cities (
    geoname_id INTEGER PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    location geometry(Point, 4326) NOT NULL,    -- PostGIS point
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    population BIGINT,
    timezone VARCHAR(40),
    ...
    FOREIGN KEY (country_code) REFERENCES geonames_countries(iso_alpha2)
);
```

**Key Indexes:**
- Primary key on `geoname_id`
- **GIST spatial index** on `location` (fast geographic queries)
- Index on `name`
- Index on `country_code`
- Index on `population` (descending)
- Composite index on `(name, country_code)`

**Example Query:**
```sql
-- Find Bangkok
SELECT geoname_id, name, country_code, population,
       ST_Y(location) as lat, ST_X(location) as lon
FROM geonames_cities
WHERE name = 'Bangkok' AND country_code = 'TH';
```

### hotels

Hotel POI data from OpenStreetMap.

```sql
CREATE TABLE hotels (
    osm_id BIGINT PRIMARY KEY,
    osm_type VARCHAR(10) NOT NULL,              -- 'node', 'way', 'relation'
    name VARCHAR(500),
    location geometry(Point, 4326) NOT NULL,    -- PostGIS point
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Hotel details
    stars VARCHAR(10),                          -- Star rating (1-5)
    rooms INTEGER,                              -- Number of rooms
    beds INTEGER,                               -- Number of beds
    address VARCHAR(500),
    phone VARCHAR(100),
    email VARCHAR(200),
    website VARCHAR(500),

    -- Metadata
    tags JSONB,                                 -- All OSM tags as JSON
    source_region VARCHAR(100),                 -- e.g., 'thailand-latest'
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nearest_city_id INTEGER,

    FOREIGN KEY (nearest_city_id) REFERENCES geonames_cities(geoname_id)
);
```

**Key Indexes:**
- Primary key on `osm_id`
- **GIST spatial index** on `location` (fast geographic queries)
- Index on `name`
- Index on `stars` (partial, WHERE stars IS NOT NULL)
- Index on `source_region`
- **GIN index** on `tags` (JSONB queries)

**Example Query:**
```sql
-- Find hotels near Bangkok center (within 5km)
SELECT osm_id, name, stars,
       ST_Y(location) as lat, ST_X(location) as lon,
       ST_Distance(
           location::geography,
           ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography
       ) / 1000 as distance_km
FROM hotels
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography,
    5000
)
ORDER BY distance_km
LIMIT 10;
```

### regions

Named geographic regions for advanced queries (future use).

```sql
CREATE TABLE regions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    region_type VARCHAR(50),                    -- 'mountain_range', 'administrative', etc.
    boundary geometry(Polygon, 4326),           -- PostGIS polygon
    osm_id BIGINT,
    tags JSONB,
    source VARCHAR(100),                        -- 'osm', 'manual', etc.
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Indexes:**
- **GIST spatial index** on `boundary` (polygon queries)
- Index on `name`
- Index on `region_type`

**Future Use:**
```sql
-- Find hotels in the Alps (once region data is imported)
SELECT h.osm_id, h.name
FROM hotels h
JOIN regions r ON r.name = 'Alps'
WHERE ST_Contains(r.boundary, h.location);
```

## Helper Functions

### find_hotels_near_point()

Find hotels within a radius of a point.

```sql
SELECT * FROM find_hotels_near_point(
    13.7563,    -- latitude
    100.5018,   -- longitude
    5000,       -- radius in meters
    50          -- limit
);
```

**Returns:**
- osm_id, osm_type, name
- latitude, longitude, stars
- distance_meters

### find_hotels_in_region()

Find hotels within a named region (when region data is available).

```sql
SELECT * FROM find_hotels_in_region(
    'Alps',     -- region name
    100         -- limit
);
```

**Returns:**
- osm_id, osm_type, name
- latitude, longitude, stars

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
-- Within 10km of a point
SELECT name, stars,
       ST_Distance(
           location::geography,
           ST_SetSRID(ST_MakePoint($lon, $lat), 4326)::geography
       ) as distance_meters
FROM hotels
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint($lon, $lat), 4326)::geography,
    10000
)
ORDER BY distance_meters
LIMIT 50;
```

### Hotels in a city with auto-radius

```sql
-- 1. Find city
SELECT geoname_id, population,
       ST_Y(location) as lat, ST_X(location) as lon
FROM geonames_cities
WHERE name = 'Bangkok' AND country_code = 'TH';

-- 2. Determine radius based on population
--    > 5M: 25km, 1-5M: 15km, 500k-1M: 10km, 100k-500k: 5km, < 100k: 3km

-- 3. Search with calculated radius
SELECT * FROM find_hotels_near_point(lat, lon, radius_meters, 50);
```

### Count hotels by region

```sql
SELECT source_region, COUNT(*) as hotel_count
FROM hotels
GROUP BY source_region
ORDER BY hotel_count DESC;
```

### Hotels with specific amenities (using JSONB)

```sql
-- Hotels with WiFi
SELECT name, tags->>'internet_access' as wifi
FROM hotels
WHERE tags->>'internet_access' = 'wlan'
LIMIT 10;

-- Hotels with parking
SELECT name
FROM hotels
WHERE tags->>'parking' IS NOT NULL;
```

## Database Operations

### Initialize Schema

```bash
npm run db:init
```

Creates all tables, indexes, and functions.

### Import GeoNames Data

```bash
npm run db:migrate
```

Migrates countries and cities from SQLite to PostgreSQL.

### Import OSM Hotel Data

```bash
# Download PBF file
curl -L -o thailand-latest.osm.pbf https://download.geofabrik.de/asia/thailand-latest.osm.pbf

# Import hotels
npm run db:import-pbf thailand-latest.osm.pbf
```

### Backup Database

```bash
docker-compose exec -T postgres pg_dump -U traveluser travel > backup.sql
```

### Restore Database

```bash
docker-compose exec -T postgres psql -U traveluser -d travel < backup.sql
```

## Performance Notes

- **Spatial queries are fast**: GIST indexes make geographic lookups near-instant
- **No caching needed**: Direct queries on full dataset are fast enough
- **JSONB is indexed**: GIN index allows fast queries on OSM tags
- **Connection pooling**: Use pg.Pool for concurrent requests

## PostGIS Geometry Types

All coordinates use **WGS84 (SRID 4326)**:
- `geometry(Point, 4326)` for cities and hotels
- `geometry(Polygon, 4326)` for regions

**Creating a point:**
```sql
ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
```

**Distance calculation:**
```sql
-- Returns meters
ST_Distance(
    point1::geography,
    point2::geography
)
```

**Within radius:**
```sql
ST_DWithin(
    point::geography,
    center::geography,
    radius_meters
)
```

**Point in polygon:**
```sql
ST_Contains(polygon, point)
```

## Adding More Data

### Import additional regions

```bash
# Europe (large, ~2M POIs)
curl -L -o europe-latest.osm.pbf https://download.geofabrik.de/europe-latest.osm.pbf
npm run db:import-pbf europe-latest.osm.pbf

# Specific country (faster)
curl -L -o germany-latest.osm.pbf https://download.geofabrik.de/europe/germany-latest.osm.pbf
npm run db:import-pbf germany-latest.osm.pbf
```

Available regions: https://download.geofabrik.de/

### Import region boundaries

To enable "hotels in the Alps" queries, import OSM administrative boundaries:

```sql
-- Import natural=mountain_range polygons
INSERT INTO regions (name, region_type, boundary, osm_id, tags)
SELECT
    tags->>'name',
    'mountain_range',
    ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326),
    osm_id,
    tags
FROM osm_boundaries
WHERE tags->>'natural' = 'mountain_range';
```

## Migration to Production

To move to hosted PostgreSQL (AWS RDS, Digital Ocean, etc.):

```bash
# 1. Export
docker-compose exec -T postgres pg_dump -U traveluser travel > production.sql

# 2. Import to hosted database
psql -h your-host.amazonaws.com -U user -d travel < production.sql

# 3. Update connection
export DATABASE_URL="postgresql://user:pass@your-host:5432/travel"
npm start
```

No code changes needed - just update the connection string!
