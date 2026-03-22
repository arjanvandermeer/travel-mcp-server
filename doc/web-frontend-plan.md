# Web Frontend Plan

## Goal

Build a public-facing website for browsing POIs (hotels, restaurants, attractions), with Google SSO login, favorites management, and type-ahead search. The website reuses the existing database layer, auth infrastructure, and detail page templates.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    index-http.js                              │
│                                                              │
│  /mcp              → MCP protocol (existing)                 │
│  /health           → Health check (existing)                 │
│  /preview/poi/:id  → POI detail HTML (existing)              │
│                                                              │
│  /api/v1/*         → REST API (JSON endpoints)               │
│  /auth/*           → Web auth flow (OAuth SSO callbacks)     │
│  /*                → Static SPA files from web/              │
└───────────┬──────────────────────────────────────────────────┘
            │
            │ reuses
            ▼
┌───────────────────────┐     ┌──────────────────────────────┐
│    src/database.js     │     │  Cloudflare OAuth Worker      │
│    (all queries)       │     │  (Google SSO - existing)      │
└───────────────────────┘     └──────────────────────────────┘
```

**Key principle**: Add REST API routes and static file serving to the _existing_ HTTP server. No separate server process. The frontend is a vanilla JS SPA served as static files.

---

## Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Frontend framework | **Vanilla JS + Alpine.js** | No build step, tiny (17KB), matches project's no-framework style. Alpine provides reactivity, x-model for forms, x-show for toggling, x-for for lists — enough for this app without a bundler. |
| CSS | **Single CSS file** (custom) | Reuse design tokens from existing templates (gradients, colors, card styles). No Tailwind/build needed. |
| Routing | **Hash-based SPA routing** | Simple `#/search`, `#/favorites`, `#/poi/123` routes. No server-side routing needed. |
| Build tool | **None** | All JS served as-is. ES modules via `<script type="module">`. |
| API layer | **REST endpoints on existing server** | `/api/v1/*` routes added to `index-http.js`. Returns JSON. |
| Auth (web) | **Cookie-based session** via OAuth | Existing Cloudflare Worker handles Google SSO. New `/auth/login` redirects to Worker, `/auth/callback` sets a session cookie. |
| Type-ahead | **Debounced fetch to `/api/v1/autocomplete`** | New lightweight DB query — fuzzy match on `osm_name` and `google_display_name`, limited to 10 results. |

### Why not React/Vue/Svelte?

The project currently has zero build tooling (no webpack, vite, etc). Introducing a build step adds complexity to CI/CD, local dev, and Docker builds. Alpine.js gives us reactivity where we need it (search form, result lists, auth state) without any of that. If we outgrow it later, we can migrate to a framework.

---

## Directory Structure

```
web/                           # Static frontend (SPA)
├── index.html                 # SPA shell (loads Alpine.js from CDN), all views inline
├── css/
│   └── style.css              # All styles (465 lines, reuses design tokens from templates)
└── js/
    ├── app.js                 # Alpine stores (auth, search, route, favorites), router, bootstrap (395 lines)
    └── api.js                 # Fetch wrapper (apiGet, apiPost, apiDelete) with cookie auth (46 lines)

src/                           # Server-side additions
├── api/                       # REST API route handlers
│   ├── search.js              # GET /api/v1/search/cities, /search/pois
│   ├── autocomplete.js        # GET /api/v1/autocomplete?q=...&country=...&city=...
│   ├── poi.js                 # GET /api/v1/poi/:osm_id
│   ├── favorites.js           # GET/POST/DELETE /api/v1/favorites
│   ├── auth.js                # GET /auth/login, /auth/callback, /auth/logout, /auth/me (192 lines, PKCE flow)
│   └── countries.js           # GET /api/v1/countries, /api/v1/states
├── api-router.js              # Lightweight request router (route matching, param extraction, helpers)
├── index-http.js              # MODIFIED — mounts API router + serves web/ static files
├── database.js                # MODIFIED — added listCountriesWithData, listStatesForCountry, autocompleteSearch
└── ...                        # everything else unchanged

tests/                         # Test coverage for web API
├── unit/
│   ├── api-router.test.js     # ApiRouter class, parseCookies, parseBody (188 lines)
│   └── database-web-api.test.js  # New DB methods + user management (371 lines)
└── integration/
    ├── api-endpoints.test.js  # All REST endpoints with mock DB (537 lines)
    └── api-auth.test.js       # OAuth PKCE flow, session management (384 lines)
```

### What lives where and why

| Directory | Purpose | Deployed |
|-----------|---------|----------|
| `web/` | Static frontend files (3 files). Served by Node.js in dev, by CloudFront/S3 or Nginx in prod. | Yes (static) |
| `src/api/` | REST API handlers (6 files). Thin layer that calls `database.js` and returns JSON. | Yes (server) |
| `src/templates/` | Existing Handlebars templates for MCP widget rendering. Untouched. | Yes (server) |
| `tests/` | Unit + integration tests for API router, endpoints, auth, and DB methods (~1,480 lines). | No |

---

## REST API Design

All API endpoints return JSON. Auth is via `Authorization: Bearer <token>` header (same as MCP).

### Search

```
GET /api/v1/countries
  → [{ code: "TH", name: "Thailand", ... }, ...]

GET /api/v1/search/cities?country_code=TH&q=bang
  → { results: [{ geoname_id, name, state, population, ... }], count: 5 }

GET /api/v1/search/pois?city_name=Bangkok&country_code=TH&poi_type=restaurant&q=sushi&limit=20
  → { results: [{ osm_id, osm_name, poi_type, google_rating, photo_url, ... }], count: 20 }
```

### Autocomplete (type-ahead)

```
GET /api/v1/autocomplete?q=wal&country_code=TH&city_name=Bangkok&limit=10
  → { suggestions: [{ osm_id, name, poi_type, rating, city }, ...] }
```

Returns fast — query uses `ILIKE` on name with `LIMIT 10`, no enrichment.

### POI Detail

```
GET /api/v1/poi/:osm_id
  → { osm_id, osm_name, poi_type, google_rating, ..., is_favorite, favorite_notes }
```

Full POI data as JSON (same shape as `getPOIDetails()` returns, plus favorite status if authenticated).

### Favorites (requires auth)

```
GET    /api/v1/favorites?poi_types=restaurant,hotel&limit=50
  → { count: 3, favorites: [{ osm_id, ..., favorite_since, favorite_notes }] }

POST   /api/v1/favorites    { osm_id: 123, notes: "Great view" }
  → { success: true }

DELETE /api/v1/favorites/:osm_id
  → { success: true }
```

### Auth

```
GET /auth/login
  → 302 redirect to Cloudflare OAuth Worker /authorize (with state, PKCE, redirect_uri=/auth/callback)

GET /auth/callback?code=...&state=...
  → Exchanges code for token via Worker /token endpoint
  → Sets httpOnly cookie with access_token (or stores in session)
  → 302 redirect to /#/ (home)

GET /auth/logout
  → Clears session cookie
  → 302 redirect to /#/

GET /auth/me
  → { authenticated: true, email, name, picture_url }
  → or { authenticated: false }
```

**Cookie vs localStorage for tokens**: Use a secure, httpOnly cookie for the access token. This is safer (no XSS exposure) and automatically sent with every request. The `/auth/me` endpoint lets the frontend know if the user is logged in.

---

## Default Webpage — Detailed Specification

The root URL (`/`) serves `web/index.html` — a single-page app that is the entry point for all users. Everything below describes what this page looks like and how it works.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  NAVBAR                                                      │
│  Travel Explorer                    [Login with Google]      │
│  ─ or after login ─                                          │
│  Travel Explorer       [My Favorites]   [avatar] Arjan ▾    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  SEARCH PANEL (always visible)                               │
│                                                              │
│  ┌─ Country ──────────────────────────────────────────────┐  │
│  │  [  -- Select country --                            ▾] │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ State/Province (appears after country selected) ──────┐  │
│  │  [  -- All states --                                ▾] │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ City (type-ahead, appears after country selected) ────┐  │
│  │  [  Start typing a city name...                      ] │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  Bangkok (10,539,000)                            │  │  │
│  │  │  Bang Sue (148,000)                              │  │  │
│  │  │  Bang Kapi (195,000)                             │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ POI Type ─────────────────────────────────────────────┐  │
│  │  [  All types                                       ▾] │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Search POI name (type-ahead) ─────────────────────────┐  │
│  │  [  Search for a place...                            ] │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  🏨 Waldorf Astoria Bangkok    ⭐4.7            │  │  │
│  │  │  🍽️ Coco51 Restaurant & Bar   ⭐4.3            │  │  │
│  │  │  🏨 The Siam Hotel             ⭐4.8            │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [ 🔍 Search ]                                               │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  RESULTS AREA                                                │
│  (appears after search or POI type-ahead selection)          │
│                                                              │
│  Hotels in Bangkok, Thailand (47 results)                    │
│                                                              │
│  ┌─ Result Card ─────────────────────────────────────────┐  │
│  │ [thumb]  Waldorf Astoria Bangkok           ⭐ 4.7    │  │
│  │          hotel  ·  $$$$ · 171 rooms                   │  │
│  │          Ratchadamri Road, Bangkok, TH         [♡]    │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌─ Result Card ─────────────────────────────────────────┐  │
│  │ [thumb]  The Siam Hotel                    ⭐ 4.8    │  │
│  │          hotel  ·  $$$$                               │  │
│  │          Khao Road, Bangkok, TH                [♡]    │  │
│  └───────────────────────────────────────────────────────┘  │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Navbar

| Element | Anonymous | Logged In |
|---------|-----------|-----------|
| Left | "Travel Explorer" (text logo, links to `#/`) | Same |
| Right | "Login with Google" button (→ `GET /auth/login`) | Avatar + name dropdown: My Favorites, Logout |

The "Login with Google" button uses the standard Google branding (white bg, Google "G" icon, "Sign in with Google" text per Google's brand guidelines). On click, navigates to `/auth/login` which starts the PKCE OAuth flow.

Auth state is checked on page load via `GET /auth/me`. The response is stored in an Alpine.js store and reactive — navbar updates immediately.

#### 2. Country Dropdown

**Data source**: `GET /api/v1/countries`

**API implementation** (new method needed on `database.js`):
```sql
-- listCountriesWithData(): countries that have BOTH cities AND POIs
SELECT DISTINCT co.iso_alpha2 as code, co.country as name, co.continent
FROM geonames_countries co
WHERE EXISTS (SELECT 1 FROM geonames_cities c WHERE c.country_code = co.iso_alpha2)
  AND EXISTS (SELECT 1 FROM osm_pois p
              JOIN geonames_cities c2 ON p.nearest_city_id = c2.geoname_id
              WHERE c2.country_code = co.iso_alpha2)
ORDER BY co.country
```

**Behavior**:
- Loaded once on page init, cached in Alpine store
- Shows "-- Select country --" placeholder
- Sorted alphabetically by country name
- Grouped by continent (optional nice-to-have via `<optgroup>`)
- Selecting a country reveals the State and City fields
- Changing country clears state, city, and results

**Existing data**: `geonames_countries` table has 252 countries with `iso_alpha2`, `country` (name), `continent`, `population`.

#### 3. State/Province Dropdown (optional filter)

**Data source**: `GET /api/v1/states?country_code=TH`

**API implementation** (new method on `database.js`):
```sql
-- listStatesForCountry(countryCode): states with POIs
SELECT DISTINCT a.admin1_code as code, a.name, a.ascii_name
FROM geonames_admin1_codes a
WHERE a.country_code = $1
ORDER BY a.name
```

**Behavior**:
- Shows "-- All states --" as default (not required)
- Only appears after country is selected
- Populated with states for the selected country
- Selecting a state narrows the city type-ahead results
- `geonames_admin1_codes` has 3,862 records with `country_code`, `admin1_code`, `name`

#### 4. City Type-Ahead

**Data source**: `GET /api/v1/search/cities?country_code=TH&state=10&q=bang&limit=8`

This reuses the **existing** `searchCities()` method on `database.js` — no new DB code needed. That method already supports:
- `query` (ILIKE on `name` and `ascii_name`)
- `countryCode` filter
- `state` filter (matches on `admin1_code` or state name)
- Returns: `geoname_id`, `name`, `ascii_name`, `country_code`, `country_name`, `state_code`, `state_name`, `population`, `latitude`, `longitude`

**Behavior**:
- Text input with debounced search (300ms delay)
- Minimum 2 characters before triggering search
- Dropdown shows city name + population (formatted: "10.5M", "148K")
- Shows state name if available: "Bangkok, Krung Thep" or "New York, New York"
- Selecting a city stores `{ geoname_id, name, latitude, longitude }` in Alpine state
- Keyboard navigation: arrow keys + Enter to select, Escape to close
- Clicking outside closes dropdown

#### 5. POI Type Selector

**Static data** — no API call needed. Uses the known POI types from the codebase:

```js
const poiTypeOptions = [
  { value: '',              label: 'All types' },
  { value: 'hotel',         label: 'Hotels' },
  { value: 'guest_house',   label: 'Guest Houses' },
  { value: 'hostel',        label: 'Hostels' },
  { value: 'resort',        label: 'Resorts' },
  { value: 'restaurant',    label: 'Restaurants' },
  { value: 'cafe',          label: 'Cafes' },
  { value: 'bar',           label: 'Bars & Pubs' },
  { value: 'fast_food',     label: 'Fast Food' },
  { value: 'attraction',    label: 'Attractions' },
  { value: 'monument',      label: 'Monuments' },
  { value: 'museum',        label: 'Museums' },
  { value: 'park',          label: 'Parks' },
];
```

Derived from `accommodationTypes` and `foodTypes` in [src/tools-config.js:10-11](src/tools-config.js#L10-L11), plus attraction types from the `osm_pois.poi_type` column.

**Behavior**:
- Standard `<select>` dropdown
- Defaults to "All types"
- Filters both the POI type-ahead and full search results

#### 6. POI Name Type-Ahead

**Data source**: `GET /api/v1/autocomplete?q=wal&country_code=TH&city_name=Bangkok&poi_type=hotel&limit=10`

**API implementation** (new method on `database.js`):
```sql
-- autocompleteSearch(query, { countryCode, cityGeonameId, poiType, limit })
-- Fast prefix search for type-ahead. Uses existing trigram indexes.
SELECT
  p.osm_id,
  COALESCE(g.display_name, p.name) as name,
  p.poi_type,
  g.rating as google_rating,
  c.name as city,
  c.country_code
FROM osm_pois p
LEFT JOIN geonames_cities c ON p.nearest_city_id = c.geoname_id
LEFT JOIN osm_google_mappings m ON p.osm_id = m.osm_id AND m.mapping_status = 'active'
LEFT JOIN google_places g ON m.google_place_id = g.google_place_id
WHERE p.name IS NOT NULL
  AND (p.name ILIKE $1 OR g.display_name ILIKE $1)
  AND c.country_code = $2          -- if countryCode provided
  AND p.nearest_city_id = $3       -- if cityGeonameId provided
  AND p.poi_type = $4              -- if poiType provided
ORDER BY g.rating DESC NULLS LAST, p.name
LIMIT $5
```

Key: uses the existing `idx_osm_pois_name_trgm` GIN index for fast fuzzy matching.

**Behavior**:
- Text input with debounced search (300ms)
- Minimum 2 characters
- Each suggestion shows: type icon + name + rating (if available)
- Type icons: 🏨 hotel, 🍽️ restaurant, ☕ cafe, 🍺 bar, 🏛️ attraction, etc.
- Selecting a suggestion navigates directly to `#/poi/:osm_id` (detail page)
- Pressing Enter or clicking "Search" runs the full search instead

#### 7. Search Button + Full Results

**Data source**: `GET /api/v1/search/pois?city_name=Bangkok&country_code=TH&poi_type=hotel&q=waldorf&limit=50`

This calls the **existing** `searchPOIs()` method — no new DB code needed. The API handler translates query params to the method's expected format:
- `cityName`, `countryCode`, `state` → location-based search
- `name` → name filter (uses trigram similarity ranking)
- `poiType` or `poiTypes` → type filter
- `limit` → capped at 100

**Result cards** reuse the design from [src/templates/search-results.hbs](src/templates/search-results.hbs):
- Thumbnail photo (from `google_photos[0]` if enriched)
- POI name + type badge
- Rating + review count
- Distance (if search was coordinate-based)
- City + country code
- Cuisine tags (for restaurants)
- Heart icon for favorites (logged-in users only)

Clicking a card navigates to `#/poi/:osm_id`.

#### 8. Login Flow (detailed)

```
User clicks "Login with Google"
  │
  ▼
GET /auth/login
  │ Server generates: state, code_verifier, code_challenge (PKCE S256)
  │ Stores { state, code_verifier } in short-lived server memory (or signed cookie)
  │ Constructs authorize URL for Cloudflare OAuth Worker
  │
  ▼
302 → https://travel-mcp-oauth.workers.dev/authorize
        ?client_id=<dynamic_client_id>
        &redirect_uri=https://travel.arjanvandermeer.com/auth/callback
        &response_type=code
        &code_challenge=<sha256_hash>
        &code_challenge_method=S256
        &state=<random>
        &scope=openid profile email
  │
  ▼
User logs in with Google (handled by Worker)
  │
  ▼
302 → /auth/callback?code=<authz_code>&state=<state>
  │ Server verifies state matches
  │ Exchanges code + code_verifier for tokens at Worker /token endpoint
  │ Gets back: access_token, refresh_token, expires_in
  │ access_token is an opaque token that the Worker can introspect
  │
  ▼
Server sets cookie: `session=<access_token>; HttpOnly; Secure; SameSite=Lax; Path=/`
  │
  ▼
302 → /#/  (or the page user was on before login)
  │
  ▼
Frontend calls GET /auth/me → { authenticated: true, name: "Arjan", ... }
Alpine store updates → navbar re-renders with user info
```

**Dynamic Client Registration**: On first startup (or on demand), the server registers itself as an OAuth client with the Worker via `POST /register`. The `client_id` is cached in `app_config` table.

### Alpine.js Store Structure

```js
// Global stores accessible from any component
Alpine.store('auth', {
  checked: false,        // has /auth/me been called?
  authenticated: false,
  user: null,            // { email, name, picture_url }

  async check() { /* GET /auth/me */ },
  login() { window.location.href = '/auth/login'; },
  logout() { window.location.href = '/auth/logout'; },
});

Alpine.store('search', {
  // Dropdown data (loaded once)
  countries: [],         // [{ code, name, continent }]
  states: [],            // [{ code, name }] — for selected country
  poiTypes: [ /* static list */ ],

  // Current selections
  country: null,         // { code, name }
  state: null,           // { code, name } or null
  city: null,            // { geoname_id, name, latitude, longitude }
  poiType: '',           // '' = all
  query: '',             // free text POI name search

  // Type-ahead state
  citySuggestions: [],
  poiSuggestions: [],

  // Results
  results: [],
  resultCount: 0,
  loading: false,

  async loadCountries() { /* GET /api/v1/countries */ },
  async loadStates(countryCode) { /* GET /api/v1/states?country_code=... */ },
  async searchCities(q) { /* GET /api/v1/search/cities?... */ },
  async autocompletePOIs(q) { /* GET /api/v1/autocomplete?... */ },
  async search() { /* GET /api/v1/search/pois?... */ },
});
```

### API Endpoints Summary (new for the default page)

| Endpoint | Method | DB Method | New? |
|----------|--------|-----------|------|
| `GET /api/v1/countries` | `listCountriesWithData()` | **New** |
| `GET /api/v1/states?country_code=TH` | `listStatesForCountry(cc)` | **New** |
| `GET /api/v1/search/cities?country_code=TH&q=bang` | `searchCities(opts)` | Existing |
| `GET /api/v1/autocomplete?q=wal&country_code=TH&...` | `autocompleteSearch(q, opts)` | **New** |
| `GET /api/v1/search/pois?city_name=Bangkok&...` | `searchPOIs(params)` | Existing |
| `GET /auth/login` | — (redirect) | **New** |
| `GET /auth/callback` | `upsertGoogleUser()` | Existing |
| `GET /auth/me` | `getUserByToken()` | Existing |

Only 3 new database methods needed. The rest reuses what's already there.

---

## Page Flow / UX

### 1. Home / Search Page (`#/`)

```
┌──────────────────────────────────────────┐
│  [Logo]  Travel Explorer    [Login]      │
├──────────────────────────────────────────┤
│                                          │
│  🌍 Explore Places                       │
│                                          │
│  Country:  [  Thailand  ▾  ]             │
│  City:     [  Bangkok   ▾  ] (type-ahead)│
│  Type:     [  All  ▾  ]                  │
│  Search:   [  sushi near me...  ]        │
│                                          │
│  [ Search ]                              │
│                                          │
├──────────────────────────────────────────┤
│  Results (20 found)                      │
│                                          │
│  ┌─ Card ──────────────────────────┐     │
│  │ [photo] Restaurant Name    ⭐4.5│     │
│  │         Thai, Sushi   1.2 km    │     │
│  │         Bangkok, TH     [♡]     │     │
│  └─────────────────────────────────┘     │
│  ┌─ Card ──────────────────────────┐     │
│  │ ...                             │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

**Flow**:
1. User selects country from dropdown (populated from `/api/v1/countries`)
2. City field becomes a type-ahead: as user types, hits `/api/v1/search/cities?country_code=TH&q=...`
3. User selects city → POI search field appears with type-ahead
4. Type-ahead in POI field hits `/api/v1/autocomplete?country_code=TH&city_name=Bangkok&q=...`
5. Clicking "Search" or pressing Enter fetches `/api/v1/search/pois`
6. Results render as cards (reusing existing `search-results.hbs` card design)
7. Each card has a heart icon (♡/♥) for logged-in users to toggle favorites

### 2. POI Detail Page (`#/poi/:osm_id`)

- Loads the existing server-rendered HTML from `/preview/poi/:osm_id` in an iframe, **or**
- Fetches `/api/v1/poi/:osm_id` and renders client-side (reusing the same design)
- Adds a prominent "Add to Favorites" / "Remove from Favorites" button
- Shows favorite notes if already saved

**Recommendation**: Use an iframe initially (fast to ship, reuses all existing template logic). Migrate to client-side rendering later if needed.

### 3. Favorites Page (`#/favorites`)

```
┌──────────────────────────────────────────┐
│  [Logo]  Travel Explorer    [User ▾]     │
├──────────────────────────────────────────┤
│                                          │
│  ♥ My Favorites (12)                     │
│                                          │
│  Filter: [All ▾] [Hotels ▾] [Restaurants]│
│                                          │
│  ┌─ Card ──────────────────────────┐     │
│  │ [photo] Waldorf Astoria   ⭐4.7│     │
│  │         Hotel   Bangkok, TH     │     │
│  │   "Amazing pool!"     [♥ Remove]│     │
│  └─────────────────────────────────┘     │
│  ...                                     │
└──────────────────────────────────────────┘
```

- Requires login (redirects to login if not authenticated)
- Fetches `/api/v1/favorites`
- Filters by POI type client-side (or pass `poi_types` param)
- Each card shows favorite notes and "Remove" action

### 4. Login

- "Login with Google" button triggers `GET /auth/login`
- Redirects through Cloudflare OAuth Worker → Google → back to `/auth/callback`
- Sets session cookie → redirects to previous page
- Navbar updates to show user avatar + name

---

## What Changed in Existing Code

> All changes below have been implemented.

### `src/index-http.js` (modified)

1. **Static file serving**: Serves `web/` directory for paths not matching `/mcp`, `/api`, `/auth`, `/preview`, `/health`, `/.well-known`. SPA fallback routes unknown paths to `index.html`.
2. **API router mounted**: Routes `/api/v1/*` and `/auth/*` to handler modules in `src/api/`. Extracts user from session cookie or Bearer token.
3. **Cookie parsing**: Session cookie (`session=<access_token>`) extracted and mapped to user via existing `getUserFromRequest()` logic.

### `src/database.js` (3 methods added)

1. **`autocompleteSearch(query, options)`** — Fast name-prefix search with `ILIKE` for type-ahead. Joins to `google_places` for ratings. Returns `osm_id`, `name`, `poi_type`, `rating`, `city`. Default limit 10, max 50. (`database.js:1967-2021`)
2. **`listCountriesWithData()`** — Returns countries that have both cities AND POIs. Uses double-EXISTS subqueries for efficiency. (`database.js:1927-1941`)
3. **`listStatesForCountry(countryCode)`** — Returns states/provinces for a country, sorted alphabetically. (`database.js:1946-1957`)

### Template rendering: Handlebars vs Alpine.js (separation of concerns)

The project now uses **two** rendering approaches for **different audiences**:

| | Handlebars (server-side) | Alpine.js (client-side) |
|---|---|---|
| **Runs in** | Node.js | Browser |
| **Serves** | MCP clients (Claude, ChatGPT) | Website users |
| **Templates** | `src/templates/*.hbs` | `web/index.html` + Alpine directives |
| **Rendering** | Server generates complete HTML string | Browser reactively updates DOM |
| **Interactivity** | None (static HTML output) | Full (forms, type-ahead, routing) |

**Rules**:
- **Never load Handlebars in the browser** for the website. Alpine.js handles all client-side rendering.
- **Never use Alpine.js for MCP output**. MCP clients need complete server-rendered HTML.
- **POI detail pages** use Handlebars (`poi-details.hbs`) and are reused by the website via iframe (`/preview/poi/:osm_id`). No duplication.
- **Search result cards** have similar markup in both worlds (Handlebars for MCP, Alpine `x-for` for website). This is acceptable — they serve different audiences with different interaction patterns.
- **Shared design**: Both use the same CSS design tokens (colors, card styles, typography). The website's `web/css/style.css` reuses values from the existing template styles.

### Nothing else changes

The existing MCP tools, templates, and MCP protocol handling remain untouched.

---

## Implementation Status

> **Phases 1–4 are complete. Phase 5 is partially done.** All essential functionality is implemented and tested (~3,250 lines of production code + ~1,480 lines of tests).

### Phase 1: Database + API Layer — ✅ Complete

**New database methods:**
- [x] `listCountriesWithData()` — countries that have both cities and POIs (`database.js:1927-1941`)
- [x] `listStatesForCountry(countryCode)` — states/provinces for a country (`database.js:1946-1957`)
- [x] `autocompleteSearch(query, { countryCode, cityGeonameId, poiType, limit })` — fast name-prefix search (`database.js:1967-2021`)
- [x] Unit tests for all 3 new methods (`tests/unit/database-web-api.test.js`)

**API infrastructure:**
- [x] `src/api-router.js` — `ApiRouter` class with route registration, `:param` extraction, query string parsing, `sendJson`/`parseBody`/`parseCookies` helpers
- [x] Mounted in `src/index-http.js` — intercepts `/api/v1/*` and `/auth/*` before the catch-all
- [x] Static file serving in `src/index-http.js` — serves `web/` directory with correct MIME types, SPA fallback to `index.html`

**API endpoints (read-only, no auth needed):**
- [x] `GET /api/v1/countries` → calls `listCountriesWithData()` (`src/api/countries.js`)
- [x] `GET /api/v1/states?country_code=TH` → calls `listStatesForCountry()` (`src/api/countries.js`)
- [x] `GET /api/v1/search/cities?country_code=TH&q=bang&limit=8` → calls existing `searchCities()` (`src/api/search.js`)
- [x] `GET /api/v1/search/pois?city_name=Bangkok&country_code=TH&poi_type=hotel&q=...&limit=50` → calls existing `searchPOIs()` (`src/api/search.js`)
- [x] `GET /api/v1/autocomplete?q=wal&country_code=TH&city_geoname_id=123&poi_type=hotel&limit=10` → calls `autocompleteSearch()` (`src/api/autocomplete.js`)
- [x] `GET /api/v1/poi/:osm_id` → calls existing `getPOIDetails()` with favorite status (`src/api/poi.js`)
- [x] Integration tests for all API endpoints (`tests/integration/api-endpoints.test.js`, 537 lines)

### Phase 2: Auth Flow (web SSO) — ✅ Complete

- [x] `GET /auth/login` — generates PKCE S256 challenge, auto-registers client via `POST /register`, redirects to OAuth Worker (`src/api/auth.js`)
- [x] `GET /auth/callback?code=...&state=...` — exchanges code for token, sets HttpOnly/SameSite/Secure session cookie (7-day TTL), redirects to `/#/`
- [x] `GET /auth/logout` — clears session cookie (Max-Age=0), redirects to `/#/`
- [x] `GET /auth/me` — returns `{ authenticated, email, name, picture_url }` or `{ authenticated: false }`
- [x] Cookie parsing in API router (`parseCookies()` helper + user extraction in `index-http.js`)
- [x] OAuth `client_id` stored in `app_config` as `web_oauth_client_id` (auto-register on first login attempt)
- [x] `GET /api/v1/favorites` → calls existing `listFavorites()` (requires auth) (`src/api/favorites.js`)
- [x] `POST /api/v1/favorites` → calls existing `addFavorite()` (requires auth, validates POI exists)
- [x] `DELETE /api/v1/favorites/:osm_id` → calls existing `removeFavorite()` (requires auth)
- [x] Tests for auth endpoints (`tests/integration/api-auth.test.js`, 384 lines) and favorites API
- [x] In-memory PKCE state store with 5-minute cleanup and 10-minute TTL
- [x] Replay protection (state deleted immediately after use)

### Phase 3: Default Webpage (frontend) — ✅ Complete

**Implementation note**: The planned `web/js/components/` and `web/js/lib/` subdirectories were not needed. All components are inline in `web/index.html` (Alpine.js directives) and all logic lives in `web/js/app.js` (Alpine stores). This is simpler and more appropriate for the current scope.

**SPA shell:**
- [x] `web/index.html` — Alpine.js (CDN), all views inline with `x-show` routing (287 lines)
- [x] `web/css/style.css` — design system with CSS variables, responsive breakpoints (465 lines)
- [x] `web/js/app.js` — Alpine stores (`auth`, `search`, `route`, `favorites`), page load bootstrap (395 lines)
- [x] `web/js/api.js` — `apiGet`/`apiPost`/`apiDelete` with `credentials: 'same-origin'` (46 lines)

**Navbar component:**
- [x] "Travel Explorer" logo/text (left)
- [x] "Login with Google" button (right, anonymous) → `window.location = '/auth/login'`
- [x] User avatar + name + dropdown (right, logged in) → My Favorites, Logout
- [x] Auth check on page load via `GET /auth/me`

**Search panel:**
- [x] Country `<select>` dropdown — loaded from `/api/v1/countries` on init, cached in Alpine store
- [x] State `<select>` dropdown — loaded from `/api/v1/states` when country changes, "All states" default
- [x] City type-ahead input — debounced 300ms, min 2 chars, shows name + formatted population (10.5M, 148K)
- [x] POI type `<select>` dropdown — hardcoded 13 types matching `tools-config.js`
- [x] POI name type-ahead input — debounced 300ms, min 2 chars, shows type emoji icon + name + rating
- [x] Search button — calls `/api/v1/search/pois`, renders results below
- [x] Cascading clear: changing country clears state/city/results

**Type-ahead widget:**
- [x] Debounced input (300ms delay, inline in Alpine store methods)
- [x] Dropdown suggestion list with keyboard navigation (arrow keys, Enter, Escape)
- [x] Click outside to close
- [x] Custom render per suggestion (city: population; POI: type emoji + rating)
- [ ] Loading spinner during fetch (CSS spinner exists but not wired to type-ahead)

**Result cards:**
- [x] Card layout matching existing design (photo, name, type badge, rating, distance, address, cuisine)
- [x] Click card → navigate to `#/poi/:osm_id`
- [x] Heart icon (♡/♥) on each card for logged-in users → `POST /api/v1/favorites`

### Phase 4: Detail + Favorites Pages — ✅ Complete

- [x] `#/poi/:osm_id` page — loads `/preview/poi/:osm_id` in an iframe (full width)
- [x] "Add to Favorites" / "Remove from Favorites" button above iframe (for logged-in users)
- [x] `#/favorites` page — requires auth, fetches `/api/v1/favorites`, renders same result cards
- [x] Remove favorite action on favorites page
- [x] Auth redirect/prompt for anonymous users accessing favorites
- [ ] POI type filter tabs on favorites page
- [ ] Favorite notes display and edit

### Phase 5: Polish — ⚠️ Partial

- [x] Responsive design (600px mobile breakpoint, stacks vertically)
- [x] Empty states in search results area
- [ ] Loading skeletons for search results (CSS spinner exists, could be more detailed)
- [ ] Error toasts for API failures (errors logged to console only)
- [ ] URL state: persist search params in hash (`#/search?country=TH&city=Bangkok&type=hotel`)
- [ ] SEO: Open Graph meta tags for shared POI links

---

## Deployment Considerations

### Local Development

```bash
# Start both MCP + web on the same port
node src/index-http.js
# Visit http://localhost:3000/ for the website
# MCP still works at http://localhost:3000/mcp
```

### Production (EC2)

The Node.js server runs directly on an EC2 t3.small instance via systemd. The `web/` directory is served by `index-http.js`. Static files, API endpoints, and MCP protocol all run in the same process. SSL is handled by Cloudflare proxy.

---

## Resolved Design Decisions

These were open questions during planning. All have been resolved through implementation:

1. **Domain**: Website lives at `travel.arjanvandermeer.com/` (same as MCP). The root URL serves the SPA; `/mcp` continues to serve the MCP protocol. No separate subdomain needed.
2. **POI detail**: **iframe** approach was chosen. The `#/poi/:osm_id` page loads `/preview/poi/:osm_id` in an iframe, reusing all existing Handlebars template logic without duplication.
3. **Alpine.js vs htmx**: **Alpine.js** was chosen. All frontend state management uses Alpine stores (`auth`, `search`, `route`, `favorites`). Components are inline via Alpine directives in `index.html`.
4. **Search results enrichment**: Search results show **only what's already in the DB** — no on-demand Google Places enrichment. This keeps the API fast and avoids API costs for browsing.
5. **Frontend structure**: The planned `components/` and `lib/` subdirectories were **not needed**. All views are inline in `index.html` with Alpine directives, and all logic lives in `app.js` Alpine stores. This is simpler and sufficient for the current scope.
