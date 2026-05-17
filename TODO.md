# TODO

## High Priority

### CRITICAL: Fix Unhandled Promise in Background Enrichment
- [x] Fix `Promise.all()` not being awaited in `batchEnrichPOIs()` — added `await`
- [x] Error logging was already in place via `.catch()` handler

### Bug: Enrichment Can Get Stuck After Long Pending Runs
- [ ] If Google Places enrichment stays `pending` longer than 5 minutes, automatically cancel,
  expire, or restart the job instead of leaving the POI in an indefinite pending state
- [ ] Add stale-pending detection around `osm_google_mappings.mapping_status = 'pending'`
  using `mapped_at`/started timestamp
- [ ] Return a clean user-facing status while logging the raw stale/retry details for operators

### Fix Google Places Matching Algorithm
- [x] Raised MIN_CONFIDENCE from 0.4 to 0.7
- [x] Added distance validation: reject matches >500m
- [x] Added POI type compatibility check (hotel↔lodging, restaurant↔food)
- [ ] Improve name matching (Thai/non-Latin names mismatch, abbreviations, word order)
- [ ] Use normalized name matching with transliteration

### Security: Pre-commit Hook for Credential Detection
- [x] Add git pre-commit hook (husky) to grep for credential patterns in staged files
- [x] Add credential scan step to CI pipeline (`.github/workflows/ci.yml`)

### Security: SQL Injection Audit
- [x] Audit all queries in `database.js` for proper parameterization — all safe
- [x] Fixed SQL injection in `optimize-db.js` — validate table names against allowlist
- [x] Review dynamic query building in `searchPOIs()`, `searchCities()` — all use parameterized queries, safe

### OAuth 2.1 — Remaining Items
- [x] Cache OAuth introspection results (5 min TTL) — in-memory Map in index-http.js
- [ ] Test with MCP Inspector `--oauth` flag
- [ ] Test with ChatGPT MCP connector
- [ ] User preferences (currency, language, home location)

## Medium Priority

### Regular Codebase Review Process
- [x] Add a recurring maintenance review prompt in `doc/regular-codebase-review.md`
- [x] Add a push-triggered CI/CD workflow that runs only when the last review is 7+ days old
- [x] Gate the workflow on meaningful commits so idle periods do not produce review noise
- [x] Open a PR for `TODO.md` updates instead of committing review output directly to `main`
- [ ] Configure `OPENAI_API_KEY` in GitHub Actions secrets and run `Codebase Maintenance Review` once with `workflow_dispatch` + `force=true`

### MCP Apps: Rich Interactive UI
- [ ] Interactive map with hotel/restaurant markers, filterable list, photo galleries
- [ ] `ui://` URI scheme per MCP Apps spec (ChatGPT supports now; Claude TBD)

### Input Validation Layer
- [x] Centralized `src/validation.js` for lat/lon/limit/countryCode validation
- [x] Applied in executeToolHandler and API routes

### Add Type Safety with JSDoc
- [x] JSDoc for top 10 most-used functions in database.js and google-places.js

### Data Caching and Automatic Refresh
- [x] Google Places cache refresh via `npm run db:refresh -- --refresh-google`
- [x] GeoNames refresh via `npm run db:refresh -- --refresh-geonames`
- [ ] Background refresh scheduling (cron/Lambda)

### Google Places Rate Limiting
- [x] Atomic quota consumption (single INSERT...ON CONFLICT with WHERE clause)
- [x] Eliminated TOCTOU race condition between check and increment

### Improve OSM Import Workflow
- [ ] One-command import: `npm run init:osm thailand` (auto-download + import)

## Low Priority

- [x] Multi-language city search (alternate_names ILIKE in searchCities)
- [x] Log rotation for stdio server (10MB size-based rotation)
- [x] Replace deprecated `url.parse()` with WHATWG `URL` API
- [x] Add .nvmrc for consistent Node version (24)
- [ ] Wikidata enrichment (images, descriptions)
- [ ] Route planning capabilities
- [ ] OpenAPI/Swagger spec for HTTP server

## Quick Wins

- [x] Fix Promise.all() await issue
- [x] Extract constants to `src/config.js`
- [x] Add input validation for coordinates and limits
- [x] Replace `url.parse()`

### Frontend Website Redesign
- [ ] Redesign the entire frontend website (web/)

## Hotel & Restaurant Feature Expansion

Based on competitive analysis of 25+ travel MCP servers in the market (March 2026). Our server is
uniquely positioned: 2.5M+ OSM POIs with rich JSONB tags + Google Places enrichment, dual transport
(stdio + HTTP/SSE), and production-deployed with auth. Most of these features leverage data we
already store but don't yet expose through search parameters.

### DO FIRST — Low Effort, High Value (leverage existing data)

#### 1. Cuisine-Based Restaurant Search
- [ ] Add `cuisine` parameter to `search_restaurants` tool
- [ ] Filter on `osm_pois.cuisine` column (already populated from OSM import)
- [ ] Support multi-cuisine queries: `cuisine=["sushi", "japanese"]`
- [ ] Add cuisine to `search_restaurants_ui` tool schema too
- **Why**: OSM cuisine data is already imported into its own column. No competitor does cuisine
  filtering on real global OSM data. This is the simplest win — just a WHERE clause.
- **Example**: `search_restaurants(city_name="Bangkok", cuisine="thai")`

#### 2. Amenity-Aware Hotel Search
- [ ] Add `amenities` array parameter to `search_hotels` tool
- [ ] Filter on `osm_pois.tags` JSONB column (wifi, pool, parking, breakfast, air_conditioning, etc.)
- [ ] Use GIN index on tags for performance: `tags ?& ARRAY['internet_access', 'swimming_pool']`
- [ ] Document available amenity keys from OSM tag vocabulary
- [ ] Add amenities to `search_hotels_ui` tool schema too
- **Why**: We store rich tag data in JSONB (wifi, parking, pool, breakfast, pet policy, etc.) but
  don't expose any of it in search. No MCP server in the market does semantic amenity filtering on
  real OSM data. This is low-hanging fruit — add GIN index queries on existing `tags` column.
- **Example**: `search_hotels(city_name="Bangkok", amenities=["wifi", "pool", "breakfast"])`

#### 3. Dietary Restriction Filter for Restaurants
- [ ] Add `dietary` array parameter to `search_restaurants` tool
- [ ] Filter on OSM tags: `diet:vegetarian`, `diet:vegan`, `diet:gluten_free`, `diet:halal`, `diet:kosher`
- [ ] Map user-friendly names to OSM tag keys (e.g., "vegan" → `diet:vegan`)
- [ ] Add dietary to `search_restaurants_ui` tool schema too
- **Why**: This is the **single biggest gap** across all restaurant MCP servers in the market.
  Only one niche server (Synvya) does basic dietary matching on custom data. No server can answer
  "find me a vegan restaurant near Times Square" using real-world data. OSM has these tags — we
  just need to query them.
- **Example**: `search_restaurants(city_name="Berlin", dietary=["vegan"])`

#### 4. Opening Hours / Open Now Filter
- [ ] Add `open_now` boolean parameter to `search_restaurants` and `search_hotels`
- [ ] Add `open_at` time parameter (e.g., "22:00") for future time queries
- [ ] Parse OSM `opening_hours` format (complex spec, use a parser library or simplified regex)
- [ ] Fall back to Google Places `opening_hours` data when OSM is missing
- [ ] Add to both `_ui` variants
- **Why**: We store `opening_hours` from OSM and get verified hours from Google Places enrichment.
  Especially valuable for late-night dining, breakfast spots, and Sunday openings. No competitor
  offers time-based filtering.
- **Example**: `search_restaurants(city_name="NYC", open_now=true)` or `open_at="22:00"`

### NEXT WAVE — Medium Effort, High Differentiation

#### 5. Hotel Chain/Brand Hierarchy & Search
- [ ] Create `hotel_chains` reference table: `chain_id`, `parent_brand`, `brand_name`, `wikidata_id`
  - Example hierarchy: Hilton (parent) → Conrad, Waldorf Astoria, DoubleTree, Hampton, Hilton Garden Inn, Embassy Suites, Curio, Tapestry, Motto, LXR, Tempo, Spark, Home2 Suites, Homewood Suites, Tru
  - Marriott (parent) → Ritz-Carlton, St. Regis, W Hotels, Westin, Sheraton, Le Méridien, Courtyard, Fairfield, SpringHill Suites, Residence Inn, TownePlace Suites, Aloft, Element, Moxy, AC Hotels, Protea, City Express, Four Points
  - IHG (parent) → InterContinental, Kimpton, Hotel Indigo, Crowne Plaza, Holiday Inn, Holiday Inn Express, Staybridge Suites, Candlewood Suites, Avid, Atwell, Vignette, Garner, Even
  - Hyatt (parent) → Park Hyatt, Andaz, Grand Hyatt, Alila, Thompson, Hyatt Regency, Hyatt Centric, Joie de Vivre, Caption, Hyatt Place, Hyatt House, UrCove
  - Accor (parent) → Raffles, Fairmont, Sofitel, Pullman, Swissôtel, Mövenpick, Novotel, Mercure, ibis, ibis Styles, ibis budget, Adagio, Greet, Tribe, Jo&Joe, Mantis, Rixos, Banyan Tree, SLS, Mondrian, Hyde, Delano
  - Wyndham (parent) → Wyndham Grand, Dolce, Registry, Ramada, Days Inn, Super 8, Howard Johnson, Travelodge, Microtel, La Quinta, Hawthorn, Trademark, TRYP
  - Best Western (parent) → Best Western, Best Western Plus, Best Western Premier, SureStay, Aiden, Sadie, BW Signature, BW Premier Collection, Executive Residency, Vib, Glō
  - Choice Hotels (parent) → Radisson, Radisson Blu, Park Plaza, Park Inn, Country Inn, Comfort Inn, Quality Inn, Sleep Inn, Clarion, Econo Lodge, Cambria, Ascend
- [ ] Link `osm_pois` to `hotel_chains` via `tags->>'brand'` and `tags->>'brand:wikidata'` matching
- [ ] Add `brand` parameter to `search_hotels`: search by brand name
- [ ] Add `chain` parameter to `search_hotels`: search by parent chain (e.g., "Hilton" returns all sub-brands)
- [ ] Seed table with top 10 global chains + all sub-brands (use Wikidata IDs for matching)
- **Why**: OSM tags include `brand`, `operator`, and `brand:wikidata`. No other MCP server supports
  chain-level or brand-level search on global data. Useful for loyalty program travelers who need to
  find any property within their preferred chain. The hierarchy matters — searching "Hilton" should
  also find Conrad, Waldorf Astoria, DoubleTree, etc.
- **Example**: `search_hotels(chain="Hilton", country_code="TH")` → finds all Hilton family brands

#### 6. Accommodation Type Filter
- [ ] Add `accommodation_type` parameter to `search_hotels`
- [ ] Expose OSM types: hostel, guest_house, motel, apartment, camp_site, chalet, resort, bed_and_breakfast
- [ ] Allow multiple types: `accommodation_type=["hostel", "guest_house"]`
- **Why**: OSM has distinct types but we currently search all accommodation types together.
  Backpackers want hostels, families want resorts, budget travelers want guesthouses.
- **Example**: `search_hotels(city_name="Chiang Mai", accommodation_type="guest_house")`

#### 7. Restaurant Price Intelligence
- [ ] Add `price_level` parameter to `search_restaurants` (1-4 scale from Google Places)
- [ ] Create `get_dining_budget` tool: estimate per-person dining costs by city
- [ ] Aggregate Google Places `price_level` data across restaurants in a city
- [ ] Return median, low, high ranges per cuisine type
- **Why**: Google Places provides `price_level` (1-4). No competitor offers per-city dining cost
  estimation or price-filtered restaurant search. Useful for trip budgeting.
- **Example**: `search_restaurants(city_name="Paris", price_level=2)` or
  `get_dining_budget(city_name="Tokyo", meals_per_day=3, price_preference="moderate")`

#### 8. Intent-Based Hotel Search ("Hotels For...")
- [ ] Add `intent` parameter to `search_hotels`
- [ ] Map intents to amenity/tag combinations:
  - "remote_work" → wifi, desk/workspace, cafe nearby, quiet
  - "family" → pool, family rooms, restaurant, parking
  - "romantic" → spa, restaurant, bar, high star rating
  - "budget" → hostel type, low price level
  - "accessible" → wheelchair=yes, elevator, accessible bathroom
  - "pet_friendly" → pets allowed tag
- [ ] Combine with location parameters for powerful queries
- **Why**: No MCP server offers semantic intent-based search. Our tag data makes it feasible.
  Natural-language intents mapped to concrete amenity/tag combinations.
- **Example**: `search_hotels(city_name="Bali", intent="romantic")`

#### 9. Restaurant Occasion Matcher
- [ ] Add `occasion` parameter to `search_restaurants`
- [ ] Map occasions to attribute combinations:
  - "business_dinner" → high price level, high rating, not fast_food, reservations=yes
  - "casual_lunch" → cafe/restaurant, outdoor_seating, moderate price
  - "date_night" → high rating, bar nearby, not fast_food, high price level
  - "family_meal" → family-friendly tags, parking, highchair
  - "quick_bite" → fast_food/cafe, takeaway=yes
  - "late_night" → opening_hours past 23:00
- **Why**: Similar to hotel intent-based search. No competitor offers this. Combines multiple
  filter dimensions into a single, user-friendly parameter.
- **Example**: `search_restaurants(city_name="NYC", occasion="date_night")`

#### 10. Hotel Comparison Tool
- [ ] New `compare_hotels` tool: side-by-side comparison of 2-5 hotels
- [ ] Input: array of `osm_ids`
- [ ] Output: table of star rating, Google rating, price level, amenities, distance to city center,
  nearby restaurant count, walkability proxy
- [ ] Highlight differences and standout features
- **Why**: Decision-making tool. No competitor offers structured hotel comparison.
- **Example**: `compare_hotels(osm_ids=[123, 456, 789])`

#### 11. Food District / Restaurant Cluster Discovery
- [ ] New `find_food_districts` tool
- [ ] Use PostGIS `ST_ClusterDBSCAN` to identify restaurant-dense areas
- [ ] Return cluster centroid, restaurant count, top cuisines, price range
- [ ] Name clusters by nearest landmark or neighborhood
- **Why**: Unique in the market — neighborhood-level dining intelligence. Helps travelers find
  vibrant food streets and dining neighborhoods rather than individual restaurants.
- **Example**: `find_food_districts(city_name="Bangkok")` →
  "Chinatown (Yaowarat)" — 47 restaurants within 300m, top cuisines: thai, chinese, seafood

#### 12. Stay Quality Score
- [ ] Compute composite quality score per hotel from:
  - Google rating + review count (weighted)
  - Star classification
  - Amenity richness (count of useful tags)
  - Nearby restaurant density (via `get_nearby_pois` logic)
  - Walkability proxy (POI density within 500m)
- [ ] Return as part of hotel search results or details
- **Why**: Unique data-driven quality metric beyond simple star ratings. Leverages our existing
  enrichment pipeline and spatial queries.

### LATER — High Effort, High Impact

#### 13. Neighborhood Livability Score
- [ ] New `get_neighborhood_score` tool
- [ ] For any hotel, compute walkability/livability based on nearby POI density:
  - restaurants_within_500m, cafes, bars, supermarkets, pharmacies, transit stops
- [ ] Return a 0-100 score with category breakdown
- **Why**: Helps travelers pick hotels based on what's around them, not just the hotel itself.
  No competitor offers this.
- **Example**: `get_neighborhood_score(osm_id=123)` →
  score: 87/100 ("Excellent for walkable dining and nightlife")

#### 14. Multi-POI Itinerary Builder
- [ ] New `build_itinerary` tool
- [ ] Input: hotel osm_id, interests (museums, food, nightlife), number of days
- [ ] Generate day-by-day plans radiating from the hotel
- [ ] Group nearby attractions and restaurants geographically per day
- [ ] Use PostGIS spatial queries for efficient clustering
- **Why**: Combines our spatial data strength with practical trip utility. No MCP server offers
  this. Uses existing PostGIS capabilities.
- **Example**: `build_itinerary(hotel_osm_id=123, interests=["museums", "local_food"], days=3)`

#### 15. Trip Dining Planner
- [ ] New `plan_dining` tool
- [ ] Input: city, days, dietary preferences, budget, variety preference
- [ ] Return suggested restaurant per meal avoiding repeat cuisines
- [ ] Balance price levels, geographically cluster by day
- [ ] Consider opening hours for breakfast/lunch/dinner timing
- **Why**: The "killer feature" no competitor has. Requires cuisine, dietary, price, and opening
  hours data — all things we have or are adding.
- **Example**: `plan_dining(city_name="Tokyo", days=5, dietary=["pescatarian"], budget="moderate")`

## Ideas / Future Exploration

- Real-time availability/pricing APIs (Booking.com, Expedia)
- Wikidata events and attractions
- Other enrichment sources (Yelp, TripAdvisor, Foursquare)

## Regular Codebase Review

### 2026-05-17

#### Approval Needed
- [ ] **Deferred** `.github/workflows/codebase-maintenance.yml`: Owner prefers not to enable cloud-based TODO mutation for now. Keep the workflow unverified/unused and run maintenance audits locally; future direction may be GitHub issue creation instead of direct `TODO.md` updates.
- [x] **High** `.github/workflows/ci.yml`: CI now blocks on `npm audit --audit-level=high`; fixed current dependency advisories with `npm audit fix` and confirmed `npm audit --audit-level=moderate` reports 0 vulnerabilities.

#### Fixes And Risks
- [x] **High** `src/database.js`, `src/google-places.js`, `src/api/search.js`: Replaced truthy/falsy coordinate checks with explicit null/undefined validation and added zero-coordinate regressions for REST, DB search, and Google Places paths.
- [x] **High** `tests/integration/nearby-pois.test.js`: Fixed the full-suite cancellation by clearing background enrichment timeout timers after the raced enrichment promise settles. Verified full `npm test` completes with 582 passing tests.
- [x] **Medium** `src/api/search.js`: Guarded optional background enrichment so route tests and partial DB mocks no longer emit noisy `batchEnrichPOIs` errors.

#### Test Coverage
- [ ] **Deferred** `.github/workflows/codebase-maintenance.yml`: End-to-end GitHub Actions verification is intentionally paused while maintenance review remains local-first.
- [ ] **Medium** `scripts/maintenance-review-gate.js`: Gate tests cover actor, age, force, and path filters, but not the real GitHub `workflow_run` checkout/diff behavior. Recommended next action: add a lightweight CI smoke check or document the manual verification result after the first run.

#### Code Sprawl And Maintainability
- [ ] **Medium** `src/database.js`: File is about 2,683 lines and remains the broadest ownership hotspot in the repo. Progress: response shaping helpers were extracted to `src/response-utils.js`, and stale pending enrichment restarts now have a cooldown with regression coverage. Recommended next action: split by domain when touching related code, starting with POI search/enrichment and import/logging helpers.
- [ ] **Medium** `src/tools-config.js`: File is about 1,413 lines after extracting POI view/nearby helpers to `src/poi-view-utils.js`. Recommended next action: split large tool schema groups and handler wiring into focused modules while preserving the exported contract.
- [x] **Medium** `web/js/app.js`, `web/css/style.css`: Split frontend map constants, marker utilities, format store logic, and dossier-specific CSS into focused modules while preserving the existing `web/*` UI changes. Verified syntax, lint, audit, and full tests.
- [x] **Medium** `src/index-http.js`, `src/google-places.js`: Reduced both below 800 lines by extracting HTTP static helpers and Google Places matching helpers, with focused unit coverage. Verified syntax, lint, audit, and full tests.

#### Performance And Operations
- [ ] **Deferred** `.github/workflows/codebase-maintenance.yml`: Cloud review runtime/cost tuning is paused while audits run locally.
- [x] **Low** `src/import-geonames-postgres.js`: Converted the three `importId` bindings to `const`; `npm run lint` now reports no warnings.

#### Dependency Audit
- [x] **High** `package-lock.json`: Updated transitive `fast-uri` to a non-vulnerable version via `npm audit fix`; audit now reports 0 vulnerabilities.
- [x] **Medium** `package-lock.json`: Updated transitive `hono` and `@hono/node-server` via `npm audit fix`; audit now reports 0 vulnerabilities.
- [x] **Medium** `package-lock.json`: Updated transitive `ip-address` and `express-rate-limit` via `npm audit fix`; audit now reports 0 vulnerabilities.
- [x] **Medium** `package-lock.json`: Updated transitive `protocol-buffers-schema` via `npm audit fix`; audit now reports 0 vulnerabilities.

#### Documentation And Hygiene
- [x] **Low** `tests/.DS_Store`: Removed the ignored local macOS artifact.
- [ ] **Low** `doc/regular-codebase-review.md`: The review prompt is now the source of truth for scheduled maintenance behavior. Recommended next action: after the first automated run, update the document with the observed runtime, any skipped checks, and any workflow permission adjustments.

## Codebase Analysis Notes

Analysis date: 2026-04-07

### Architecture Summary

- Core architecture is strong and coherent:
  - `src/database.js` is the main business/data layer
  - `src/tools-config.js` is the MCP contract and handler layer
  - `src/index.js` and `src/index-http.js` are relatively thin transport wrappers
- HTTP surface is broader than MCP alone:
  - MCP over stdio
  - MCP over Streamable HTTP
  - REST API under `src/api/*.js`
  - HTML preview pages
  - SPA frontend in `web/`
- Data model is ambitious but sensible:
  - GeoNames for cities
  - OSM for POIs
  - Google Places for enrichment
  - OAuth + favorites layered on top
- Operational tooling is reasonably complete:
  - schema and migrations in `data/`
  - import/refresh/optimize scripts in `src/`
  - OAuth provider separated into `cloudflare-oauth-worker/`
  - local evaluation agent in `slm/`

### Strengths To Preserve

- Keep transport code thin and business logic centralized in `database.js` and `tools-config.js`
- Keep REST route modules small and delegation-heavy
- Preserve DB-first search, then optional enrichment, then shared reuse across MCP/REST/web
- Preserve current breadth of automated tests across handlers, validation, templates, routing, auth, and database query logic
- Preserve the clear separation between MCP server and Cloudflare OAuth provider

### High-Priority Follow-Ups From Analysis

#### Correctness: Fix Zero-Coordinate Bugs
- [x] Fix truthy/falsy coordinate detection in `src/database.js`
  - Current bug: `const hasCoords = !!(latitude && longitude)` fails for valid `0` latitude or longitude
  - Use explicit null/undefined checks instead
- [x] Audit all coordinate checks for the same bug pattern
  - Confirm in `searchPOIs()`
  - Confirm in any nearby/map/search helpers
  - Confirm frontend/API query handling too
- [x] Fix Google Places location bias condition in `src/google-places.js`
  - Current bug: `if (latitude && longitude)` skips valid zero coordinates

#### Safety: Make Schema Initialization Non-Destructive By Default
- [ ] Split destructive dev reset from safe bootstrap/init flow
- [ ] Replace the current default behavior in `data/schema.sql` that drops core tables up front
- [ ] Introduce one of:
  - a dedicated dev-only reset schema
  - migrations-only bootstrap for non-destructive setup
  - explicit confirmation/documentation around destructive init
- [ ] Update `GETTING_STARTED.md` and `README.md` so `db:init` is clearly safe or clearly marked destructive

#### Lifecycle: Remove Async Side Effects From `TravelDatabase` Constructor
- [ ] Refactor `TravelDatabase` so constructor does not immediately kick off async initialization
- [ ] Move Google Places initialization behind an explicit bootstrap/init step
- [ ] Make startup sequencing more explicit in `src/index.js` and `src/index-http.js`
- [ ] Reduce test noise and hidden lifecycle coupling caused by constructor-time async work

#### Scalability: Revisit Process-Local Auth and Session State
- [ ] Decide whether single-instance deployment is a permanent assumption
- [ ] If not single-instance, externalize or redesign process-local state:
  - pending PKCE state in `src/api/auth.js`
  - MCP session state in `src/index-http.js`
  - OAuth introspection cache in `src/index-http.js`
- [ ] Document current deployment assumptions around sticky sessions and horizontal scaling

### Medium-Priority Hardening

#### Documentation
- [ ] Add a short architecture document naming the authoritative layers:
  - transport
  - tools contract
  - database/business logic
  - enrichment
  - auth worker
  - frontend
- [ ] Document the canonical request flow for:
  - MCP tool call
  - REST API request
  - preview page render
  - OAuth login and token introspection

#### Repo Hygiene
- [ ] Remove stray `tests/.DS_Store`
- [ ] Add `.DS_Store` to `.gitignore` if not already ignored
- [ ] Do a small pass to reconcile older docs/scripts/schema naming drift where `imports` vs `import_log` still shows historical evolution

#### Test Coverage Extensions
- [ ] Add regression tests for coordinate value `0`
  - equator/prime-meridian cases
  - searchPOIs path
  - Google Places text bias path
- [ ] Add tests around startup/bootstrap lifecycle if `TravelDatabase` init is refactored
- [ ] Add tests that lock in whichever schema-init safety model we choose

### Notes On Current Code Health

- The codebase is in good shape overall; most risk is in edge-case correctness and production hardening, not fundamental architecture
- The current design already has good reuse, especially around:
  - shared tool handlers
  - shared DB search methods
  - shared preview rendering
  - shared auth-aware request handling
- Existing tests appear strong enough to support refactoring, especially around handlers and query-layer behavior
- Image management and CDN
- User-contributed data and corrections
- GraphQL API alongside MCP
- Trip planning (itineraries, day-by-day plans)
- Cross-platform review aggregation (TripAdvisor + Google + Yelp unified view)
- Multi-source hotel price comparison engine
- Loyalty program points tracking across chains
- Reservation sniping (auto-book when slots open on Resy/OpenTable)
- Private dining / event booking integration
