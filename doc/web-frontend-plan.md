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

### Nothing else changes

The existing MCP tools, templates, and MCP protocol handling remain untouched.

---

## Implementation TODO

### Phase 1: API Layer + Static Serving (foundation)

- [ ] Create `src/api-router.js` — lightweight request router (method + path matching, JSON body parsing)
- [ ] Create `src/api/countries.js` — `GET /api/v1/countries`
- [ ] Create `src/api/search.js` — `GET /api/v1/search/cities`, `GET /api/v1/search/pois`
- [ ] Create `src/api/autocomplete.js` — `GET /api/v1/autocomplete`
- [ ] Create `src/api/poi.js` — `GET /api/v1/poi/:osm_id`
- [ ] Add `autocompleteSearch()` to `src/database.js`
- [ ] Add `listCountriesWithPOIs()` to `src/database.js`
- [ ] Add static file serving to `src/index-http.js` (serve `web/` directory)
- [ ] Add API router mounting to `src/index-http.js`
- [ ] Write tests for new API handlers and database methods

### Phase 2: Auth Flow (web SSO)

- [ ] Create `src/api/auth.js` — `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`
- [ ] Implement PKCE flow against existing Cloudflare OAuth Worker
- [ ] Add session cookie handling (set on callback, clear on logout, read on every request)
- [ ] Create `src/api/favorites.js` — `GET/POST/DELETE /api/v1/favorites`
- [ ] Write tests for auth flow and favorites API

### Phase 3: Frontend Shell

- [ ] Create `web/index.html` — SPA shell with Alpine.js CDN, base layout
- [ ] Create `web/css/style.css` — design system (reuse colors, gradients, card styles from templates)
- [ ] Create `web/js/lib/router.js` — hash-based SPA router
- [ ] Create `web/js/api.js` — fetch wrapper with cookie auth
- [ ] Create `web/js/app.js` — Alpine.js stores (auth state, search state)
- [ ] Create `web/js/components/navbar.js` — navigation bar with login/user menu

### Phase 4: Search UI

- [ ] Create `web/js/components/search.js` — country/city/type selectors
- [ ] Create `web/js/components/typeahead.js` — debounced autocomplete widget
- [ ] Create `web/js/components/results.js` — search results card list
- [ ] Wire up search flow: country → city type-ahead → POI search → results
- [ ] Add POI type-ahead in the search field

### Phase 5: Detail + Favorites UI

- [ ] Create `web/js/components/poi-detail.js` — detail page (iframe or client-rendered)
- [ ] Add favorite toggle (heart icon) to result cards
- [ ] Create `web/js/components/favorites.js` — favorites list page
- [ ] Add favorite notes editing
- [ ] Handle unauthenticated state gracefully (prompt login for favorites)

### Phase 6: Polish

- [ ] Responsive design (mobile-first)
- [ ] Loading states and error handling
- [ ] Empty states (no results, no favorites)
- [ ] SEO meta tags (Open Graph for shared POI links)
- [ ] Consider deploying `web/` via CloudFront/S3 for production

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
