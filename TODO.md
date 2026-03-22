# TODO

## High Priority

### CRITICAL: Fix Unhandled Promise in Background Enrichment
- [x] Fix `Promise.all()` not being awaited in `batchEnrichPOIs()` — added `await`
- [x] Error logging was already in place via `.catch()` handler

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

## Ideas / Future Exploration

- Real-time availability/pricing APIs (Booking.com, Expedia)
- Wikidata events and attractions
- Other enrichment sources (Yelp, TripAdvisor, Foursquare)
- Image management and CDN
- User-contributed data and corrections
- GraphQL API alongside MCP
- Trip planning (itineraries, day-by-day plans)
