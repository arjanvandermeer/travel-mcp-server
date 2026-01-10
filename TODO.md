# TODO - Future Improvements

## High Priority

### Refactor: Separate Data Sources into Dedicated Tables
- [ ] Create separate tables for each data source to maintain clean data model
- [ ] New table structure:
  - Keep `pois` table for core OSM data only (osm_id, name, location, poi_type, etc.)
  - Create `google_places` table for Google Places enrichment data
  - Create `pois_google_mapping` table (many-to-many) to link OSM IDs with Google Place IDs
- [ ] Update database schema and migration script
- [ ] Refactor `database.js` to JOIN tables when returning enriched data
- [ ] Consider renaming tables to reflect source:
  - `pois` → `osm_pois` or keep as is (since OSM is primary source)
  - `geonames_cities` → already prefixed correctly
  - `google_places` → new table for Google data
- [ ] Update all queries to use JOINs for enriched data
- [ ] Migration strategy: Extract Google columns from `pois` into new `google_places` table

**Rationale**: Currently Google Places data is stored directly in the `pois` table, mixing data sources. This makes it harder to:
- Update Google data independently from OSM data
- Handle cases where multiple OSM POIs map to the same Google Place
- Support other enrichment sources in the future (Yelp, TripAdvisor, etc.)
- Keep data models clean and maintainable

**Benefits of separate tables**:
- Clean separation of concerns (OSM vs Google vs GeoNames)
- Better data integrity (each source has its own schema)
- Easier to update/refresh data from specific sources
- Supports many-to-many relationships (multiple OSM entries for one Google Place)
- Future-proof for additional enrichment sources

**Current schema (mixed)**:
```
pois: osm_id, name, latitude, longitude, google_place_id, google_rating, ...
```

**Proposed schema (separated)**:
```
osm_pois: osm_id, name, latitude, longitude, poi_type, ...
google_places: google_place_id, name, rating, user_ratings_total, ...
pois_google_mapping: osm_id, google_place_id, confidence_score, mapped_at
```

### Fix Google Places Matching Algorithm
- [ ] Improve matching algorithm between OSM POIs and Google Places entries
- [ ] Current issues:
  - Thai/non-Latin character names often mismatch (e.g., 'โรงแรมสิริน')
  - Name variations not handled well (abbreviations, different word order)
  - Distance-based matching is too broad (matches wrong nearby places)
- [ ] Proposed improvements:
  - Use normalized name matching (remove special characters, lowercase, transliteration)
  - Implement fuzzy string matching with configurable threshold (Levenshtein distance)
  - Check address/location first, then verify name similarity
  - Use Google's `findplacefromtext` with better query construction
  - Add confidence score to matching results
  - Store matching metadata (confidence, method used) for debugging
- [ ] Add validation before accepting match:
  - Verify distance is within reasonable threshold (e.g., < 50 meters)
  - Check if POI types are compatible (hotel vs restaurant)
  - Compare business names with fuzzy matching
  - Log low-confidence matches for manual review
- [ ] Add `pois_google_mapping` table with fields:
  - `osm_id`, `google_place_id`
  - `confidence_score` (0.0 to 1.0)
  - `matching_method` ('name_exact', 'name_fuzzy', 'location_only')
  - `verified` (boolean for manual verification)
  - `created_at`, `updated_at`

**Rationale**: Current matching algorithm has high false-positive rate, especially for non-Latin names. Poor matches reduce data quality and user trust. Need better matching logic with confidence scoring and manual verification capability.

**Test cases to validate**:
- Thai hotel names (โรงแรมสิริน, etc.)
- Hotels with similar names in same area
- Chain hotels (Marriott, Hilton) - should match correct branch
- POIs with transliterated names vs native scripts

### Security: SQL Injection Audit
- [ ] Audit all database queries in `src/database.js` for SQL injection vulnerabilities
- [ ] Verify all user inputs are properly parameterized (using `$1`, `$2` placeholders)
- [ ] Check dynamic query building for potential injection vectors
- [ ] Review Google Places integration for proper input sanitization
- [ ] Add input validation for all MCP tool parameters

**Rationale**: Security is critical. Need to ensure all database queries use parameterized statements and that no user input is directly interpolated into SQL strings. This is especially important for the MCP server which accepts external input from Claude Desktop.

**Focus areas**:
- `unifiedSearchPOIs()` - city names, POI types, coordinates
- `searchCities()` - search terms
- `enrichPOIWithGooglePlaces()` - OSM IDs
- Any dynamic ORDER BY, LIMIT, or WHERE clauses

### Data caching and automatic refresh system
- [ ] Add `data_cache_metadata` table to track when regions/data were last updated
  - Fields: `region_type` (city/hotel), `region_identifier` (bbox/polygon hash), `last_updated`, `refresh_interval_days`
- [ ] Modify database methods to check data freshness before returning results
  - If data is missing or stale (older than X days), trigger background fetch from OSM/GeoNames API
  - Return cached data immediately while refresh happens in background
- [ ] Add automatic refresh mechanism
  - Cities: Refresh every 90 days (GeoNames updates monthly but cities don't change often)
  - Hotels: Refresh every 30 days (businesses change more frequently)
  - On-demand refresh: If specific hotel/city not found, fetch from API immediately
- [ ] Add refresh commands/tools
  - `npm run refresh:cities` - Refresh stale city data
  - `npm run refresh:hotels` - Refresh stale hotel data for known regions
  - MCP tool to manually trigger refresh for specific regions
- [ ] Update import scripts to record metadata on import
  - Track which bounding boxes were imported and when
  - Store in metadata table for future refresh scheduling

**Rationale**: Currently many cities have missing hotel data, and data can become stale over time. Using the database as a cache with automatic refresh ensures we always have up-to-date information without requiring manual re-imports.

**Architecture considerations**:
- Background refresh should be non-blocking
- Failed API calls should be logged but not break queries
- Implement rate limiting to respect OSM Overpass API limits
- Consider batch refresh during off-peak hours

### Rename npm scripts for consistency
- [ ] Rename `import` → `import:geonames` (for consistency with other import scripts)
- [ ] Rename `import:extended` → `import:geonames-extended`
- [ ] Update documentation (README.md) to reflect new script names

**Rationale**: Having `import:geonames`, `import:geonames-extended`, and `import:osm` follows a consistent naming pattern.

**Current:**
```json
"import": "node src/import-geonames.js",
"import:extended": "node src/import-geonames-extended.js",
"import:osm": "node src/import-osm.js"
```

**Proposed:**
```json
"import:geonames": "node src/import-geonames.js",
"import:geonames-extended": "node src/import-geonames-extended.js",
"import:osm": "node src/import-osm.js"
```

## Medium Priority

### Add generic POI/amenities system (restaurants, attractions, etc.)
- [ ] Design generic `pois` or `amenities` table structure
  - Fields: `osm_id`, `poi_type` (restaurant/attraction/transport), `name`, `latitude`, `longitude`, `address`, `city`, `country_code`, `tags` (JSON)
  - Type-specific fields stored in JSON `tags` column (e.g., cuisine for restaurants, museum type for attractions)
- [ ] Create unified import script for all OSM amenity types
  - `import:osm-pois` - Import restaurants, attractions, transport, parks, etc.
  - Configurable amenity types via command line args
- [ ] Add POI search methods to database.js
  - `searchPOIs(query, types, limit)` - Search by name, optionally filter by type
  - `getPOIsNearCoordinates(lat, lon, types, radiusKm, limit)` - Spatial search with type filter
  - `getPOIsInPolygon(polygon, types, limit)` - Polygon search with type filter
  - `getPOIByOsmId(osmId)` - Get specific POI
- [ ] Add MCP tools for POI queries
  - `search_pois` - Search for any type of POI
  - `find_pois_near_coordinates` - Find POIs near a location
  - `find_pois_in_polygon` - Find POIs within area
  - `get_poi_by_id` - Get specific POI details
- [ ] Consider project rename
  - Current: `hotel-mcp-server`
  - Proposed: `travel-mcp-server`, `location-mcp-server`, or `places-mcp-server`
  - Update package.json, README.md, repository name, etc.

**Rationale**: Adding restaurants and other POIs enables powerful cross-category queries like "which hotel is closest to Joe's Pizzeria?" or "which restaurant is closest to the Ritz Carlton?". A generic POI system is more flexible than separate tables for each amenity type.

**Use cases enabled**:
- "Find hotels near good Italian restaurants"
- "Which hotel is closest to the Louvre museum?"
- "Show me restaurants within 500m of my hotel"
- "Find a hotel near both a train station and a shopping center"

### Configurable OSM import regions

### Multi-language city search improvement
- [ ] Improve `searchCities()` to automatically check alternate names table
- [ ] Add language preference parameter to search tools

## Low Priority

### Performance optimizations
- [ ] Consider adding R-tree spatial index for faster geographic queries
- [ ] Optimize polygon search for very large polygons
- [ ] Add caching layer for frequently accessed data

### Additional features
- [ ] Add hotel rating/review aggregation (requires external API)
- [ ] Add distance calculations between cities/hotels
- [ ] Add route planning capabilities
- [ ] Wikidata enrichment (images, descriptions, etc.)

### Testing Infrastructure
- [ ] Choose and set up testing framework (Node.js built-in test runner, Vitest, or Jest)
- [ ] Add npm script for running tests (`npm test`)
- [ ] Set up test database (in-memory or separate test.db)
- [ ] Add basic unit tests for database methods
  - [ ] Test `searchCities()`, `getCitiesNearCoordinates()`, `getCitiesInPolygon()`
  - [ ] Test `isPointInPolygon()` with known geometries
  - [ ] Test hotel search methods
- [ ] Add integration tests
  - [ ] Test tool handlers in `executeToolHandler()`
  - [ ] Test OSM import parsing
  - [ ] Test GeoNames import parsing
- [ ] Add test coverage reporting
- [ ] Add performance benchmarks for spatial queries

### Documentation
- [ ] Add API documentation for all MCP tools
- [ ] Add developer guide for adding new data sources
- [ ] Add example queries and use cases

## Ideas / Future Exploration

- Add support for other accommodation types (hostels, B&Bs, vacation rentals)
- Integrate with real-time availability/pricing APIs
- Add support for events and attractions from Wikidata
- Consider creating a web UI for browsing/managing data
- Add data freshness tracking and automatic updates
