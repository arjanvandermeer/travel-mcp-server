# TODO

## High Priority

### CRITICAL: Fix Unhandled Promise in Background Enrichment
- [x] Fix `Promise.all()` not being awaited in `batchEnrichPOIs()` — added `await`
- [x] Error logging was already in place via `.catch()` handler

### Fix Google Places Matching Algorithm
- [ ] Improve name matching (Thai/non-Latin names mismatch, abbreviations, word order)
- [ ] Add validation: distance < 100m, POI type compatibility, reject confidence < 0.7
- [ ] Use normalized name matching with transliteration

### Security: Pre-commit Hook for Credential Detection
- [ ] Add git pre-commit hook to grep for credential patterns in staged files
- [ ] Add to CI pipeline (`.github/workflows/ci.yml`)

### Security: SQL Injection Audit
- [x] Audit all queries in `database.js` for proper parameterization — all safe
- [x] Fixed SQL injection in `optimize-db.js` — validate table names against allowlist
- [ ] Review dynamic query building in `unifiedSearchPOIs()`, `searchCities()`

### OAuth 2.1 — Remaining Items
- [ ] Cache OAuth introspection results (5 min TTL)
- [ ] Test with MCP Inspector `--oauth` flag
- [ ] Test with ChatGPT MCP connector
- [ ] User preferences (currency, language, home location)

## Medium Priority

### MCP Apps: Rich Interactive UI
- [ ] Interactive map with hotel/restaurant markers, filterable list, photo galleries
- [ ] `ui://` URI scheme per MCP Apps spec (ChatGPT supports now; Claude TBD)

### Input Validation Layer
- [ ] Centralized `src/validation.js` for lat/lon/limit/poiType/radius validation

### Add Type Safety with JSDoc
- [ ] JSDoc for top 10 most-used functions in database.js and google-places.js

### Data Caching and Automatic Refresh
- [ ] Background refresh of stale regions, on-demand refresh for missing data

### Google Places Rate Limiting
- [ ] Token bucket rate limiter, daily quota tracking

### Improve OSM Import Workflow
- [ ] One-command import: `npm run init:osm thailand` (auto-download + import)

## Low Priority

- [ ] Multi-language city search (alternate names table, language preference)
- [ ] Log rotation for stdio server
- [ ] Replace deprecated `url.parse()` with WHATWG `URL` API
- [ ] Add .nvmrc for consistent Node version
- [ ] Wikidata enrichment (images, descriptions)
- [ ] Route planning capabilities
- [ ] OpenAPI/Swagger spec for HTTP server

## Quick Wins

- [x] Fix Promise.all() await issue
- [ ] Extract constants to `src/config.js` (15 min)
- [ ] Add input validation for coordinates and limits (20 min)
- [ ] Replace `url.parse()` (10 min)

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
