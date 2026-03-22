# TODO - Future Improvements

## High Priority

### ~~PostgreSQL Performance Optimizations (AWS RDS)~~ COMPLETED 2026-01-30
All optimizations applied. Results:
- Spatial POI search: 106ms → 0.27ms (**417x faster**)
- City ILIKE search: 85ms → 0.67ms (**127x faster**)
- Dropped 9 unused indexes, added 3 new optimized indexes
- Applied SSD-optimized settings (random_page_cost=1.1, effective_io_concurrency=200, work_mem=16MB)

### ~~Add ChatGPT Support (StreamableHTTP Transport)~~ COMPLETED
StreamableHTTP transport implemented at `/mcp`. Live at https://travel.arjanvandermeer.com/mcp

### ~~CRITICAL: Eliminate Tool Definition Duplication~~ COMPLETED
Tools now defined in `src/tools-config.js` as single source of truth. Both `index.js` and `index-http.js` import from this file.

### ~~RDS Database Maintenance~~ COMPLETED 2026-01-31
- [x] Import admin1 codes to RDS (3862 records imported)
- [ ] Clean up stale import records (5 "running" status entries from abandoned imports)
- [ ] Clean up failed imports (6 "completed" entries with 0 records)

**Result**: State filtering in search_cities now works on production.

### ~~Feature: MCP Sample Prompts / Quick Actions~~ COMPLETED 2026-02-01
Implemented all three approaches:
1. **MCP Prompts capability** - 4 prompts (find_hotels_in_city, find_restaurants_nearby, find_attractions, explore_area)
2. **samples:// resource** - Returns JSON with example queries for all tools
3. **Enhanced tool descriptions** - Added examples to search_cities, search_hotels, search_restaurants, search_pois

All examples use NYC landmarks: Conrad New York Downtown (hotel), The Rainbow Room (restaurant), Statue of Liberty (attraction).

### Feature: OAuth2 Authentication (Optional)
Add optional authentication to enable per-user features (API limit bypass, favorites, preferences).

**Phase 1: Simple Token Auth** ✅ COMPLETED 2026-02-01
- [x] Database schema for users and tokens (deployed to local + RDS)
- [x] Token validation middleware in index-http.js
- [x] User context passed to MCP sessions
- [x] Completely transparent - anonymous access still works
- [x] User arjanvdm@gmail.com set up with unlimited Google Places access

**Phase 2: OAuth 2.1 via Cloudflare Worker** 🚧 IN PROGRESS
- [x] Cloudflare Worker OAuth server created (`cloudflare-oauth-worker/`)
- [x] OAuth 2.1 with PKCE (S256) implementation
- [x] Google OAuth integration for user identity
- [x] Dynamic Client Registration (RFC 7591)
- [x] Token introspection endpoint for MCP server
- [x] Documentation: [doc/authentication.md](doc/authentication.md)
- [x] Deploy Worker to Cloudflare
- [x] Add `/.well-known/oauth-protected-resource` to MCP server
- [x] Update MCP server to validate OAuth tokens via introspection
- [x] oauth_issuer config stored in database (not env var)
- [ ] Cache OAuth introspection results (5 min TTL) to reduce Worker calls
- [ ] Test with MCP Inspector `--oauth` flag
- [ ] Test with ChatGPT MCP connector (Developer Mode: Settings → Connectors → Advanced)
- [ ] Verify all tools work correctly in ChatGPT (tool discovery, execution, error handling)

**Phase 3: User Features**
- [x] Favorites system (save POIs, add notes) ✅ COMPLETED 2026-02-02
- [ ] User preferences (currency, language, home location)
- [ ] Trip planning (itineraries, day-by-day plans)
- [ ] Usage analytics per user

**Full documentation**: See [doc/authentication.md](doc/authentication.md)

### ~~BUG: radius_km Doesn't Accept Decimal Values~~ FIXED 2026-02-21
Fixed by adding `::float8` cast to ST_DWithin radius parameters in database.js.

### CRITICAL: Fix Unhandled Promise in Background Enrichment
- [ ] Fix `Promise.all()` not being awaited in `batchEnrichPOIs()` at database.js:719
- [ ] Change to `await Promise.allSettled(enrichmentPromises)` to track errors
- [ ] Add error logging for failed enrichments
- [ ] Test that background enrichment errors are properly caught

**Rationale**: Currently creates Promise but doesn't await it, which could mask errors in background enrichment process.

**Impact**: High - correctness issue that could hide bugs

### ~~Refactor: Separate Data Sources into Dedicated Tables~~ COMPLETED
Already implemented in schema.sql:
- `osm_pois` table for OSM data
- `google_places` table for Google Places data
- `osm_google_mappings` table with confidence_score, match_method, mapping_status
- `enriched_pois` VIEW that JOINs all tables

### ~~Fix Empty Timestamp Fields (google_enriched_at, osm_imported_at)~~ COMPLETED
Already implemented in schema.sql:
- `imported_at` column in `osm_pois` with DEFAULT CURRENT_TIMESTAMP
- `enriched_at` column in `google_places` with DEFAULT CURRENT_TIMESTAMP
- Both exposed in `enriched_pois` view as `osm_imported_at` and `google_enriched_at`

### Fix Google Places Matching Algorithm
Schema is ready (`osm_google_mappings` table has `match_confidence`, `match_method`, `mapping_status`).
Algorithm improvements still needed:

- [ ] Improve matching algorithm between OSM POIs and Google Places entries
- [ ] Current issues:
  - Thai/non-Latin character names often mismatch
  - Name variations not handled well (abbreviations, different word order)
  - Distance-based matching is too broad
- [ ] Proposed improvements:
  - Use normalized name matching (lowercase, transliteration)
  - Implement fuzzy string matching library
  - Add validation: distance < 100m, POI type compatibility
  - Reject matches with confidence < 0.7

**Impact**: High - data quality improvement

### Security: Pre-commit Hook for Credential Detection
- [ ] Add a git pre-commit hook that greps for credential patterns in staged files
- [ ] Patterns to detect:
  - `postgresql://.*:.*@` — connection strings with passwords
  - `key=` in Google Places API URLs
  - `apiKey`, `api_key`, `secret`, `password` assignments with string literals
  - AWS account IDs (`\d{12}`)
  - Base64-encoded secrets
- [ ] Block the commit if any match is found (with clear error message)
- [ ] Allow exceptions via `.credential-check-ignore` file for false positives
- [ ] Add to CI pipeline as well (`.github/workflows/deploy.yml`)

**Rationale**: The codebase had hardcoded DB credentials and Google API keys embedded in photo URLs that made it to production. A pre-commit hook prevents this from happening again.

**Implementation**: Use a simple shell script in `.git/hooks/pre-commit` or integrate with `husky` for team-wide enforcement.

**Impact**: High — prevents credential leaks at the source

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
- [ ] Create `src/init-osm.js` script for one-command country import
- [ ] Script should:
  - Accept country/region name as argument (e.g., `thailand`, `netherlands`, `california`)
  - Map region names to Geofabrik download URLs
  - Download the PBF file to `data/` directory
  - Run the import with `import-osm-pbf.js`
  - Record the import in the `imports` table with metadata (region, timestamp, POI counts)
  - Clean up the PBF file after successful import (optional flag)
- [ ] Add npm script: `npm run init:osm <region>` (e.g., `npm run init:osm thailand`)
- [ ] Populate the `imports` table on each import:
  - `region_name` (e.g., 'thailand', 'california')
  - `geofabrik_url` (download source)
  - `pbf_file_size` (bytes)
  - `imported_at` (timestamp)
  - `poi_counts` (JSON: {hotel: 1234, restaurant: 5678, ...})
  - `duration_seconds` (how long import took)
- [ ] Add region name mapping for common countries/regions (geofabrik URL patterns)
- [ ] Add progress indicator for download + import
- [ ] Handle errors gracefully (network failures, disk space, etc.)

**Rationale**: Current workflow requires manual curl download + manual node command. This is error-prone and not user-friendly. Users need to know the Geofabrik URL structure and remember the exact import command syntax.

**Proposed workflow:**
```bash
# Simple one-command import
npm run init:osm thailand
# or
npm run init:osm netherlands
# or
npm run init:osm california

# Script automatically:
# 1. Downloads https://download.geofabrik.de/asia/thailand-latest.osm.pbf
# 2. Imports all POI types
# 3. Records import in imports table
# 4. Reports summary stats
```

**Benefits:**
- Simpler user experience
- Less error-prone
- Tracks import history in database
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

### MCP Apps: Rich Interactive UI for Hotels & Restaurants
- [ ] Build interactive HTML/JS webpage for browsing hotels and restaurants
- [ ] Implement using MCP Apps Extension (SEP-1865) specification
- [ ] Return `text/html+skybridge` resources for ChatGPT compatibility
- [ ] Features to include:
  - Interactive map with hotel/restaurant markers
  - Filterable list view (by rating, price, distance)
  - Photo galleries from Google Places
  - Click-to-book or click-for-details actions
- [ ] Use `ui://` URI scheme for resources as per MCP Apps spec
- [ ] Implement `window.openai` bridge for bidirectional communication
- [ ] Test with MCPJam Inspector or MCP-UI `ui-inspector`
- [ ] Wait for Claude support or target ChatGPT initially

**Rationale**: MCP Apps (joint Anthropic/OpenAI spec from Nov 2025) enables rich interactive UIs rendered in iframes within chat interfaces. This would provide a much better UX for browsing hotels than text-only responses.

**References**:
- MCP Apps spec: https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
- OpenAI Apps SDK: https://developers.openai.com/apps-sdk/
- MCP-UI: https://mcpui.dev/

**Status**: ChatGPT supports it now; Claude support coming (Q1-Q2 2026 estimated)

**Impact**: Medium - significant UX improvement for browsing results

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

### ~~Improve Error Logging in Stdio Server~~ COMPLETED
Already implemented in index.js:
- File-based logging to `mcp-debug.log`
- Structured logging with timestamps and severity levels (`[INFO]`, `[ERROR]`)
- Uses `fs.appendFileSync()` for file writes
- console.error() also used for immediate visibility

Remaining:
- [ ] Add log rotation to prevent log files from growing too large

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

### ~~Add generic POI/amenities system (restaurants, attractions, etc.)~~ COMPLETED
Already implemented:
- `osm_pois` table with `poi_type` field (hotel, restaurant, attraction, etc.)
- `search_pois` tool with poi_type filtering
- `search_hotels` and `search_restaurants` specialized tools
- All have `_ui` variants for interactive cards
- Project renamed to `travel-mcp-server`
- Import scripts support multiple POI types

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

### ~~Testing Infrastructure~~ COMPLETED 2026-02-22

**Current State** (2026-02-22): 483 tests passing (97 suites), **84.24% line coverage** (c8)

| File | Lines | Branches | Functions |
|------|-------|----------|-----------|
| src/lib/arg-parsers.js | 100% | 100% | 100% |
| src/lib/osm-mappings.js | 100% | 96.72% | 100% |
| src/api-router.js | 99.23% | 97.05% | 100% |
| src/api/*.js | 88-100% | 77-100% | 100% |
| src/tools-config.js | 96.34% | 84.25% | 100% |
| src/templates/index.js | 92.35% | 77.14% | 100% |
| src/version.js | 85.71% | 58.33% | 80% |
| src/google-places.js | 83.87% | 85.71% | 88.23% |
| src/database.js | 72.81% | 82.14% | 78.18% |
| src/telemetry.js | 60.41% | 69.56% | 79.31% |

Completed:
- [x] Node.js built-in test runner (`node --test`) - no external framework needed
- [x] Test scripts: `npm test`, `npm run test:unit`, `npm run test:integration`
- [x] Mock database with dependency injection for testing without PostgreSQL
- [x] Pure function extraction (`src/lib/arg-parsers.js`, `src/lib/osm-mappings.js`)
- [x] Integration tests for TravelDatabase with mock pool injection
- [x] Test coverage reporting (`npm run test:coverage`)
- [x] CI/CD integration - tests run before deployment in GitHub Actions
- [x] **80% line coverage target reached** (84.24% via c8)
- [x] Pure function tests: getPromptMessages, getToolsConfig, getResourcesConfig, buildSearchResponse
- [x] Telemetry tests: all guard clauses, getConfig, flush, timeAsync, metrics wrappers
- [x] Tool handler tests: all executeToolHandler cases + handleReadResource with mocked DB
- [x] Google Places tests: levenshteinDistance, calculateNameSimilarity, findBestNameMatch, searchNearby, searchText, getPlaceDetails, findMatchingPlace, enrichPOI

Remaining (stretch goals for 90%+):
- [ ] Test `initTelemetry()` / `initSentry()` with enabled telemetry (~86 lines)
- [ ] Test `startTransaction()` / `withTransaction()` with active Sentry spans (~66 lines)
- [ ] Expand `renderPOIPreview()` branch coverage (many conditional paths)
- [ ] Add database.js coverage for search/enrichment functions (~550 uncovered lines)
- [ ] Add coverage threshold enforcement to CI (fail if < 80%)

**Note**: Use `npx c8 node --test` for reliable coverage measurement. Node's built-in `--experimental-test-coverage` is non-deterministic and gives inconsistent results.

**Documentation**: See [doc/unit-testing.md](doc/unit-testing.md)

**Impact**: Completed - quality assurance, prevents regressions

### Documentation
- [ ] Add API documentation for all MCP tools
- [ ] Add OpenAPI/Swagger spec for HTTP server
- [ ] Add MCP tool JSON schemas
- [ ] Add example requests/responses for each tool
- [ ] Add developer guide for adding new data sources
- [x] ~~Add authentication guide for HTTP server~~ (DONE - see doc/authentication.md)
- [ ] Add example queries and use cases
- [ ] Add troubleshooting guide

**Impact**: Low - developer experience

## Quick Wins (Can Implement Today)

These are small improvements that can be done quickly but provide immediate value:

- [ ] Fix Promise.all() await issue in batchEnrichPOIs() (5 minutes)
- [ ] Extract constants to config.js (15 minutes)
- [ ] Add JSDoc to top 10 most-used functions (30 minutes)
- [x] ~~Create tools-config.js and eliminate duplication~~ (DONE - see "Eliminate Tool Definition Duplication")
- [ ] Add input validation for coordinates and limits (20 minutes)
- [ ] Improve error messages in tool handlers (15 minutes)
- [ ] Replace deprecated `url.parse()` with WHATWG `URL` API (Node.js DEP0169 warning in tests)
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
