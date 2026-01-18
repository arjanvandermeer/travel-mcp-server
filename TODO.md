# TODO - Future Improvements

## High Priority

### CRITICAL: Eliminate Tool Definition Duplication
- [ ] Create `src/tools-config.js` as single source of truth for MCP tool definitions
- [ ] Export `toolsConfig` array with all tool definitions
- [ ] Export `executeToolHandler()` function with all tool handlers
- [ ] Update `src/index.js` (stdio server) to import from tools-config.js
- [ ] Update `src/index-http.js` (HTTP server) to import from tools-config.js
- [ ] Remove duplicated tool definitions from both servers
- [ ] Test both servers work after refactor

**Rationale**: Currently tool definitions (~65 lines each) are completely duplicated between index.js and index-http.js. This creates high maintenance burden and risk of servers getting out of sync. Having a single source of truth prevents bugs and follows DRY principle.

**Impact**: High - architectural improvement that prevents future bugs

### CRITICAL: Fix Unhandled Promise in Background Enrichment
- [ ] Fix `Promise.all()` not being awaited in `batchEnrichPOIs()` at database.js:719
- [ ] Change to `await Promise.allSettled(enrichmentPromises)` to track errors
- [ ] Add error logging for failed enrichments
- [ ] Test that background enrichment errors are properly caught

**Rationale**: Currently creates Promise but doesn't await it, which could mask errors in background enrichment process.

**Impact**: High - correctness issue that could hide bugs

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
  - Simple string comparison at google-places.js:303 is inadequate
- [ ] Proposed improvements:
  - Use normalized name matching (remove special characters, lowercase, transliteration)
  - Implement fuzzy string matching library (e.g., `fuzzball` or `string-similarity`)
  - Use Levenshtein distance with configurable threshold
  - Check address/location first, then verify name similarity
  - Use Google's `findplacefromtext` with better query construction
  - Add confidence score to matching results
  - Store matching metadata (confidence, method used) for debugging
- [ ] Add validation before accepting match:
  - Verify distance is within reasonable threshold (e.g., < 50-100 meters from OSM coordinates)
  - Check if POI types are compatible (hotel vs restaurant)
  - Compare business names with fuzzy matching
  - Reject matches with confidence score below threshold (e.g., < 0.7)
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

**Impact**: High - data quality improvement

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

### Improve OSM Import Workflow
- [ ] Create automatic PBF download and import workflow
- [ ] Add `data/import/` directory for auto-processing PBF files
- [ ] Implement file watcher or npm script that:
  - Monitors `data/import/` directory
  - Automatically imports any `.osm.pbf` files found
  - Moves processed files to `data/processed/` or deletes them
  - Logs import results to `data/import-log.txt`
- [ ] Alternative approach: Create helper script that downloads + imports in one command:
  ```bash
  npm run import:osm -- thailand
  # Downloads thailand-latest.osm.pbf and imports it automatically
  ```
- [ ] Add region name mapping for common countries/regions
- [ ] Add progress indicator for download + import
- [ ] Clean up data directory after successful import (optional)

**Rationale**: Current workflow requires manual curl download + manual node command. This is error-prone and not user-friendly. Users need to know the Geofabrik URL structure and remember the exact import command syntax.

**Proposed workflow:**
```bash
# Simple one-command import
npm run import:osm thailand
# or
npm run import:osm netherlands
# or
npm run import:osm california

# Or auto-import anything dropped in data/import/
cp ~/Downloads/germany-latest.osm.pbf data/import/
# Script auto-detects and imports it
```

**Benefits:**
- Simpler user experience
- Less error-prone
- Automatic cleanup
- Better for CI/CD pipelines
- Reduces documentation complexity

**Impact**: Medium - UX improvement, reduces setup friction

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

### Add Input Validation Layer
- [ ] Create `src/validation.js` module with validator functions
- [ ] Add validators for common parameters:
  - `latitude`: -90 to 90
  - `longitude`: -180 to 180
  - `limit`: positive integer, max 100
  - `poiType`: whitelist of valid types
  - `radius`: positive number, reasonable max
  - `coordinates`: array of valid lat/lon pairs
- [ ] Create validation middleware for tool handlers
- [ ] Add input sanitization for text fields (city names, search queries)
- [ ] Add validation error responses with helpful messages
- [ ] Test with invalid inputs to ensure proper error handling

**Rationale**: Currently parameters are validated ad-hoc in each tool handler. A centralized validation layer improves security, consistency, and maintainability.

**Impact**: Medium - security and code quality improvement

### Add Type Safety with JSDoc
- [ ] Add JSDoc comments to all public methods in database.js
- [ ] Document parameter types, return types, and descriptions
- [ ] Add @param, @returns, @throws tags
- [ ] Configure VS Code to use JSDoc for IntelliSense
- [ ] Consider migrating to TypeScript for full type safety (future)
- [ ] Start with top 10 most-used functions:
  - `searchCities()`, `searchPOIs()`, `getPOIDetails()`
  - `enrichOSMPOI()`, `searchCitiesNearCoordinates()`
  - `getCityByGeonameId()`, `getCityByName()`
  - Google Places methods in google-places.js

**Rationale**: No type documentation makes code harder to understand and maintain. JSDoc provides type hints without migrating to TypeScript.

**Impact**: Medium - developer experience and maintainability

### Extract Configuration Constants
- [ ] Create `src/config.js` for all configuration constants
- [ ] Extract search radii from database.js:280-286:
  - LARGE_CITY: 50000 (>1M population)
  - MEDIUM_CITY: 20000 (100K-1M)
  - SMALL_CITY: 10000 (10K-100K)
  - DEFAULT: 5000
- [ ] Extract Google Places field masks from google-places.js
- [ ] Extract batch sizes for imports
- [ ] Extract API rate limits
- [ ] Make configuration overridable via environment variables
- [ ] Document all configuration options in README

**Rationale**: Hard-coded constants scattered through code make configuration difficult. Centralizing improves maintainability.

**Impact**: Medium - maintainability improvement

### Improve Error Logging in Stdio Server
- [ ] Replace console.error() with file-based logging in index.js
- [ ] Create log stream to mcp-server.log
- [ ] Add structured logging with timestamps and severity levels
- [ ] Ensure no console output interferes with JSON-RPC protocol
- [ ] Keep console.error() in HTTP server (it's safe there)
- [ ] Add log rotation to prevent log files from growing too large

**Rationale**: console.error() in stdio server could interfere with MCP JSON-RPC protocol. File-based logging is safer.

**Impact**: Medium - reliability improvement

### Add Request Rate Limiting for Google Places API
- [ ] Implement token bucket algorithm for API rate limiting
- [ ] Create RateLimiter class in google-places.js
- [ ] Configure max requests per second/minute
- [ ] Add queue for pending requests
- [ ] Log when rate limit is hit
- [ ] Add configuration for rate limits (env variables)
- [ ] Track API usage statistics
- [ ] Consider daily quota tracking to avoid bill shock

**Rationale**: Prevent excessive API costs and quota exhaustion from runaway enrichment jobs.

**Impact**: Medium - cost control and reliability

### Optimize removeNullFields() Function
- [ ] Refactor to use Object.fromEntries for cleaner code
- [ ] Consider adding option to skip null removal for some responses
- [ ] Add performance benchmarking for large result sets
- [ ] Alternative: Configure JSON serializer to skip nulls globally
- [ ] Alternative: Use streaming JSON for very large responses

**Rationale**: Called on every response with recursive iteration. Could be optimized or replaced with serializer configuration.

**Impact**: Low-Medium - performance optimization

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
- [ ] Choose and set up testing framework (Vitest or Jest recommended)
- [ ] Add npm script for running tests (`npm test`)
- [ ] Set up test database (PostgreSQL with PostGIS for integration tests)
- [ ] Add unit tests for database.js methods:
  - [ ] `searchCities()`, `getCitiesNearCoordinates()`, `getCitiesInPolygon()`
  - [ ] `searchPOIs()`, `searchPOIsNearCoordinates()`
  - [ ] `enrichOSMPOI()`, `upsertGooglePlace()`
  - [ ] Validation functions
- [ ] Add unit tests for google-places.js:
  - [ ] Mock Google Places API responses
  - [ ] Test `findMatchingPlace()` logic
  - [ ] Test `enrichPOI()` transformation
- [ ] Add integration tests:
  - [ ] Test MCP tool handlers
  - [ ] Test end-to-end search flows
  - [ ] Test OSM import parsing
  - [ ] Test GeoNames import parsing
- [ ] Add test coverage reporting (c8 or nyc)
- [ ] Add performance benchmarks for spatial queries
- [ ] Set up CI/CD to run tests automatically

**Current State**: Only 3 test files exist, no test framework configured

**Impact**: Low - quality assurance (important but not blocking)

### Documentation
- [ ] Add API documentation for all MCP tools
- [ ] Add OpenAPI/Swagger spec for HTTP server
- [ ] Add MCP tool JSON schemas
- [ ] Add example requests/responses for each tool
- [ ] Add developer guide for adding new data sources
- [ ] Add authentication guide for HTTP server
- [ ] Add example queries and use cases
- [ ] Add troubleshooting guide

**Impact**: Low - developer experience

## Quick Wins (Can Implement Today)

These are small improvements that can be done quickly but provide immediate value:

- [ ] Fix Promise.all() await issue in batchEnrichPOIs() (5 minutes)
- [ ] Extract constants to config.js (15 minutes)
- [ ] Add JSDoc to top 10 most-used functions (30 minutes)
- [ ] Create tools-config.js and eliminate duplication (45 minutes)
- [ ] Add input validation for coordinates and limits (20 minutes)
- [ ] Improve error messages in tool handlers (15 minutes)
- [ ] Add .nvmrc or .node-version file for consistent Node version (2 minutes)

**Impact**: Quick productivity and quality improvements

## Ideas / Future Exploration

- Add support for other accommodation types (hostels, B&Bs, vacation rentals)
- Integrate with real-time availability/pricing APIs (Booking.com, Expedia)
- Add support for events and attractions from Wikidata
- Consider creating a web UI for browsing/managing data
- Add data freshness tracking and automatic updates
- Support for other enrichment sources (Yelp, TripAdvisor, Foursquare)
- Add image management and CDN integration
- Support for user-contributed data and corrections
- Multi-tenancy support for different use cases
- GraphQL API alongside MCP protocol
