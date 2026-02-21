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
│  /api/v1/*         → REST API (NEW - JSON endpoints)         │
│  /auth/*           → Web auth flow (NEW - SSO callbacks)     │
│  /*                → Static files from web/ (NEW)            │
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
web/                           # NEW - entire frontend lives here
├── index.html                 # SPA shell (loads Alpine.js from CDN)
├── css/
│   └── style.css              # All styles (reuses design tokens from templates)
├── js/
│   ├── app.js                 # Main app: router, auth state, Alpine stores
│   ├── api.js                 # API client (fetch wrapper with auth headers)
│   ├── components/
│   │   ├── search.js          # Search page component (country/city/POI flow)
│   │   ├── typeahead.js       # Type-ahead autocomplete widget
│   │   ├── results.js         # Search results list (reuses card design)
│   │   ├── poi-detail.js      # POI detail view (loads /preview/poi/:id in iframe or fetches JSON)
│   │   ├── favorites.js       # Favorites page
│   │   └── navbar.js          # Top nav with login/logout + favorites link
│   └── lib/
│       └── router.js          # Simple hash-based router
└── img/
    └── logo.svg               # (optional) site logo

src/                           # EXISTING - modifications marked
├── api/                       # NEW - REST API route handlers
│   ├── search.js              # GET /api/v1/search/cities, /search/pois
│   ├── autocomplete.js        # GET /api/v1/autocomplete?q=...&country=...&city=...
│   ├── poi.js                 # GET /api/v1/poi/:osm_id
│   ├── favorites.js           # GET/POST/DELETE /api/v1/favorites
│   ├── auth.js                # GET /auth/login, /auth/callback, /auth/logout, /auth/me
│   └── countries.js           # GET /api/v1/countries (for country picker)
├── api-router.js              # NEW - lightweight request router for /api/v1/* and /auth/*
├── index-http.js              # MODIFIED - add static file serving + mount API router
├── database.js                # MODIFIED - add autocomplete query method
└── ...                        # everything else unchanged
```

### What lives where and why

| Directory | Purpose | Deployed |
|-----------|---------|----------|
| `web/` | Static frontend files. Served by Node.js in dev, by CloudFront/S3 or Nginx in prod. | Yes (static) |
| `src/api/` | REST API handlers. Thin layer that calls `database.js` and returns JSON. | Yes (server) |
| `src/templates/` | Existing Handlebars templates for MCP widget rendering. Untouched. | Yes (server) |

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
        &redirect_uri=https://mcp.arjanvandermeer.com/auth/callback
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

## What Needs to Change in Existing Code

### `src/index-http.js` (modifications)

1. **Static file serving**: Serve `web/` directory for paths not matching `/mcp`, `/api`, `/auth`, `/preview`, `/health`, `/.well-known`
2. **Mount API router**: Route `/api/v1/*` and `/auth/*` to new handler modules
3. **Cookie parsing**: Add simple cookie parser for web auth sessions (no external dependency — just parse `req.headers.cookie`)

### `src/database.js` (additions)

1. **`autocompleteSearch(query, options)`** — Fast name-prefix search with `ILIKE` for type-ahead. Returns minimal fields (`osm_id`, `name`, `poi_type`, `rating`, `city`), limited to 10 results.
2. **`listCountriesWithPOIs()`** — Returns countries that have POIs in the database (for the country picker). Uses `SELECT DISTINCT osm_country_code FROM osm_pois JOIN geonames_countries`.

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

## Implementation TODO

### Phase 1: Database + API Layer

**New database methods:**
- [ ] `listCountriesWithData()` — countries that have both cities and POIs (for dropdown)
- [ ] `listStatesForCountry(countryCode)` — states/provinces for a country (for dropdown)
- [ ] `autocompleteSearch(query, { countryCode, cityGeonameId, poiType, limit })` — fast name-prefix search for type-ahead
- [ ] Write unit tests for all 3 new methods

**API infrastructure:**
- [ ] Create `src/api-router.js` — lightweight request router (method + path matching, JSON body parsing, query string parsing)
- [ ] Mount API router in `src/index-http.js` — intercept `/api/v1/*` and `/auth/*` before the catch-all
- [ ] Add static file serving in `src/index-http.js` — serve `web/` directory with correct MIME types for `text/html`, `text/css`, `application/javascript`, `image/svg+xml`

**API endpoints (read-only, no auth needed):**
- [ ] `GET /api/v1/countries` → calls `listCountriesWithData()`
- [ ] `GET /api/v1/states?country_code=TH` → calls `listStatesForCountry()`
- [ ] `GET /api/v1/search/cities?country_code=TH&q=bang&limit=8` → calls existing `searchCities()`
- [ ] `GET /api/v1/search/pois?city_name=Bangkok&country_code=TH&poi_type=hotel&q=...&limit=50` → calls existing `searchPOIs()`
- [ ] `GET /api/v1/autocomplete?q=wal&country_code=TH&city_geoname_id=123&poi_type=hotel&limit=10` → calls `autocompleteSearch()`
- [ ] `GET /api/v1/poi/:osm_id` → calls existing `getPOIDetails()`
- [ ] Write integration tests for all API endpoints

### Phase 2: Auth Flow (web SSO)

- [ ] `GET /auth/login` — generate PKCE challenge, register client (if needed), redirect to OAuth Worker
- [ ] `GET /auth/callback?code=...&state=...` — exchange code for token, set `session` cookie, redirect to `/#/`
- [ ] `GET /auth/logout` — clear session cookie, redirect to `/#/`
- [ ] `GET /auth/me` — read session cookie, validate token (reuse `getUserFromRequest`), return user JSON
- [ ] Add cookie parsing to API router (parse `req.headers.cookie`, extract `session` token, set `Authorization` header internally)
- [ ] Store OAuth `client_id` in `app_config` table (auto-register on first login attempt)
- [ ] `GET /api/v1/favorites` → calls existing `listFavorites()` (requires auth)
- [ ] `POST /api/v1/favorites` → calls existing `addFavorite()` (requires auth)
- [ ] `DELETE /api/v1/favorites/:osm_id` → calls existing `removeFavorite()` (requires auth)
- [ ] Write tests for auth endpoints and favorites API

### Phase 3: Default Webpage (frontend)

**SPA shell:**
- [ ] `web/index.html` — Alpine.js (CDN), base layout with navbar + search panel + results area
- [ ] `web/css/style.css` — design system reusing colors/gradients from existing templates (`#667eea → #764ba2` gradient, card styles, typography)
- [ ] `web/js/app.js` — Alpine stores (`auth`, `search`), router init, page load bootstrap
- [ ] `web/js/api.js` — `fetch` wrapper (credentials: 'same-origin' for cookie auth, JSON parsing, error handling)

**Navbar component:**
- [ ] "Travel Explorer" logo/text (left)
- [ ] "Login with Google" button (right, anonymous) → `window.location = '/auth/login'`
- [ ] User avatar + name + dropdown (right, logged in) → My Favorites, Logout
- [ ] Check auth on page load via `GET /auth/me`

**Search panel:**
- [ ] Country `<select>` dropdown — loaded from `/api/v1/countries` on init, cached
- [ ] State `<select>` dropdown — loaded from `/api/v1/states` when country changes, "All states" default
- [ ] City type-ahead input — debounced 300ms, min 2 chars, calls `/api/v1/search/cities`, shows name + population
- [ ] POI type `<select>` dropdown — static options (hardcoded list from tools-config.js types)
- [ ] POI name type-ahead input — debounced 300ms, min 2 chars, calls `/api/v1/autocomplete`, shows icon + name + rating
- [ ] Search button — calls `/api/v1/search/pois`, renders results below
- [ ] Cascading clear: changing country clears state/city/results, changing city clears POI results

**Type-ahead widget (reusable for both city and POI):**
- [ ] Debounced input with configurable delay
- [ ] Dropdown suggestion list with keyboard navigation (up/down/enter/escape)
- [ ] Click outside to close
- [ ] Loading spinner during fetch
- [ ] Custom render function per suggestion (city shows population, POI shows type icon + rating)

**Result cards:**
- [ ] Card layout matching existing `search-results.hbs` design
- [ ] Thumbnail photo, name, type badge, rating, review count, distance, address, cuisine
- [ ] Click card → navigate to `#/poi/:osm_id`
- [ ] Heart icon (♡/♥) on each card for logged-in users → `POST /api/v1/favorites`

### Phase 4: Detail + Favorites Pages

- [ ] `#/poi/:osm_id` page — loads `/preview/poi/:osm_id` in an iframe (full width, auto-height)
- [ ] Add "Add to Favorites" / "Remove from Favorites" button above iframe (for logged-in users)
- [ ] `#/favorites` page — requires auth, fetches `/api/v1/favorites`, renders same result cards
- [ ] POI type filter tabs on favorites page
- [ ] Favorite notes display and edit
- [ ] Redirect to login if accessing favorites while anonymous

### Phase 5: Polish

- [ ] Responsive: mobile-first CSS, search panel stacks vertically on small screens
- [ ] Loading skeletons for search results
- [ ] Empty states: "No countries found", "No results for your search", "No favorites yet"
- [ ] Error toasts for API failures
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

### Production (ECS Fargate)

The existing Docker container already runs `index-http.js`. Since we're adding static serving to the same server, the `web/` directory just needs to be included in the Docker image (already is by default via `COPY . .`).

No additional infrastructure needed for Phase 1.

**Future optimization**: Serve `web/` from CloudFront/S3 instead of Node.js for better caching and performance. The API and MCP endpoints stay on ECS.

---

## Open Questions

1. **Domain**: Should the website live at `travel.arjanvandermeer.com` (new subdomain) or at `mcp.arjanvandermeer.com/` (same as MCP)?
2. **POI detail**: iframe (fast to ship, reuses templates) vs client-side rendering (more control, no iframe quirks)?
3. **Alpine.js vs htmx**: Both are lightweight. Alpine is more natural for SPA-style interactions. htmx is better for server-rendered partials. I recommend Alpine given the SPA nature of this app.
4. **Search results enrichment**: Should search results trigger Google Places enrichment (like the MCP tools do), or only show what's already in the DB? Enrichment adds latency and API costs.
