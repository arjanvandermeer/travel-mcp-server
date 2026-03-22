# Travel MCP Server

An MCP server for travel information, powered by GeoNames city data, OpenStreetMap POIs, and Google Places enrichment.

- **OAuth 2.1 authentication** — seamless sign-in via Google
- **Hotel & restaurant discovery** — search by city name or geographic coordinates
- **Point-of-interest search** — explore museums, attractions, cafes, and more across the globe
- **Personal favorites** — bookmark and retrieve your preferred hotels and restaurants
- **Rich detail views** — access comprehensive POI information as structured JSON or rendered HTML pages ([MCP resource templates](src/templates/))
- **[Ollama Agent](doc/ollama-agent.md)** — local AI travel assistant using a small language model (Qwen 3.5 via Ollama) with tool-calling against the MCP server or REST API

**All code is written by me (and Claude) in my own time and has no affiliation with my employer or colleagues.**

## Features

### Multi-Source Data Integration
Combines three complementary data sources into a unified view: **GeoNames** for 150k+ cities worldwide, **OpenStreetMap** for 350k+ points of interest, and **Google Places** for ratings, reviews, photos, and verified business details. An `enriched_pois` database view merges OSM and Google data automatically, always selecting the best available field from each source.

### Comprehensive Search
Search across 30+ POI categories — hotels, hostels, restaurants, cafes, bars, museums, attractions, castles, ruins, shopping malls, places of worship, and more. All searches support multiple modes: by name (with fuzzy matching and similarity scoring), by city, by geographic coordinates with configurable radius, or any combination. Results are sorted by distance when coordinates are provided, and include favorite status for authenticated users.

### Google Places Enrichment
Automatic, lazy-loaded enrichment for "bookable" POIs (hotels, restaurants, museums, etc.). When a search returns results, the top 10 are enriched in the background via Google's Places API — adding star ratings, review counts, price levels, photos, verified phone numbers, websites, opening hours, service options (dine-in, takeout, delivery), amenities, and accessibility information. All enrichment data is cached for 7 days to minimise API costs, with daily call limits and retry prevention.

### Personal Favorites
Authenticated users can bookmark any POI as a favorite, attach personal notes, and retrieve their collection later — filtered by city, coordinates, or POI type. Favorite status is also surfaced in all search results, so you can immediately see which results you've previously saved.

### Rich Detail Views
Every POI is accessible as structured JSON (for LLM consumption) or as a rendered HTML detail page via [MCP resource templates](src/templates/). The HTML pages feature photo galleries, rating stars, review excerpts, opening hours tables, service option badges, amenity icons, and accessibility indicators — suitable for embedding in ChatGPT via the Apps SDK or browsing directly.

### OAuth 2.1 Authentication
Full OAuth 2.1 implementation with Google as identity provider, powered by a Cloudflare Worker. Supports PKCE (S256), dynamic client registration (RFC 7591), token introspection, refresh token rotation, and automatic user provisioning on first login. Also supports simple database tokens for programmatic access (e.g., Claude Desktop).

### OpenStreetMap Data Synchronization
65 pre-seeded regions (continents and major countries) with automatic Geofabrik downloads, configurable refresh intervals, duplicate import protection, and three-pass memory-efficient PBF parsing that handles multi-gigabyte files in under 2 GB of RAM. The `refresh-imports` command identifies stale regions and re-imports them on schedule.

### PostgreSQL + PostGIS
All geographic queries backed by PostGIS spatial indexing — GIST indexes on geometry columns, GIN trigram indexes for fuzzy name matching, and aggressive indexing on read-heavy import tables (13 indexes on `osm_pois` alone). The database-first configuration model (`app_config` table) keeps settings environment-independent and changeable at runtime.

### Telemetry & Monitoring
Sentry integration for error tracking and performance monitoring, with custom metrics for authentication, session management, Google Places API usage, and MCP protocol errors. Health check endpoint reports server status, version, git commit, and active session count.

## Authentication

The server supports two authentication methods, used in sequence — if an OAuth token is not present or invalid, the server falls back to database tokens. Unauthenticated requests are treated as anonymous (no 401/403 errors), but features like favorites require a logged-in user.

### OAuth 2.1 (Primary)

A full OAuth 2.1 flow implemented via a **Cloudflare Worker**, with Google as the identity provider.

| Component | Detail |
|-----------|--------|
| **Code challenge** | PKCE with S256 |
| **Client registration** | Dynamic (RFC 7591) |
| **Discovery** | `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource` (RFC 9728) |
| **Token exchange** | `/token` endpoint with authorization code grant |
| **Introspection** | `/introspect` for token validation |
| **Revocation** | `/revoke` endpoint |
| **Access tokens** | 7-day lifetime |
| **Refresh tokens** | 30-day lifetime, rotated on each use |
| **Authorization codes** | 5-minute lifetime |

New users are **auto-provisioned** on first OAuth login — the server calls the introspection endpoint, retrieves the Google profile, and creates a local user record. Subsequent logins update the profile (name, picture) and record `last_login_at`.

### Database Tokens (Programmatic)

For non-browser clients like Claude Desktop, the server supports long-lived database tokens — 64-character hex strings stored in the `user_tokens` table. Tokens track `created_at`, `expires_at`, `last_used_at`, and can be revoked individually. The `whoami` MCP tool returns the authenticated user's identity regardless of which method was used.

### Mid-Session Authentication

The HTTP server supports **authentication upgrades mid-session** — a client can start anonymously and authenticate later without reconnecting. User context is passed to all tool handlers via a mutable reference, so tools always see the current authentication state.

---

## OpenStreetMap Data Synchronization

### Import System

The server maintains a registry of **65 pre-seeded regions** (continents and individual countries), each with a Geofabrik download URL, a minimum POI threshold, and a configurable refresh interval (default: 30 days).

**Keyword-based import** — supply a region name and the server downloads the correct PBF file automatically:
```bash
node src/import-osm-pbf.js france          # All POI types for France
node src/import-osm-pbf.js thailand hotel  # Hotels only for Thailand
node src/import-osm-pbf.js maldives all    # Everything for Maldives
```

**Scheduled refresh** — the `refresh-imports` script identifies regions whose data has gone stale:
```bash
node src/refresh-imports.js --list          # Show all regions and their status
node src/refresh-imports.js --dry-run       # Preview what would be refreshed
node src/refresh-imports.js --max=5         # Refresh up to 5 stale regions
node src/refresh-imports.js --region=france # Refresh a specific region
```

### Three-Pass Memory-Efficient Parsing

Large PBF files (e.g., the 4 GB Europe extract) are parsed in three passes to keep memory usage below 2 GB:

1. **Pass 1** — Scan for POI ways and collect the node IDs they reference
2. **Pass 2** — Collect coordinates only for nodes identified in Pass 1
3. **Pass 3** — Process POI nodes directly and resolve way centroids from collected coordinates

### Import Safety

- **Duplicate protection** — if an import is already running for the same region, the existing job is aborted before the new one starts
- **Graceful termination** — running imports check every 30 seconds whether they've been aborted
- **Stale job cleanup** — imports running for more than 24 hours are automatically marked as failed
- **Minimum POI threshold** — each region has a `min_pois` value; imports that produce fewer records are flagged

### POI Types Imported

| Category | Types |
|----------|-------|
| Accommodation | hotel, hostel, guest_house, motel, resort, apartment, bed_and_breakfast |
| Food & Drink | restaurant, cafe, bar, pub, fast_food, food_court |
| Tourism | attraction, museum, viewpoint, artwork, gallery, theme_park, zoo |
| Historic | monument, memorial, castle, ruins, archaeological_site |
| Entertainment | cinema, theatre, nightclub |
| Shopping | shopping_mall, department_store, supermarket |
| Religious | place_of_worship |

---

## Recent Updates

### Google Places API Integration ✨
- Automatic background enrichment for hotels, restaurants, attractions, and other "bookable" POIs
- Enrichment data includes: ratings, review counts, price levels, photos, verified hours, phone, website
- Smart caching (7-day default) to minimize API costs
- Fire-and-forget architecture: searches return immediately, enrichment happens in background
- Cost management: batch limiting (top 10 results), selective enrichment, retry prevention

### Unified POI System
- Single `pois` table for all POI types (hotels, restaurants, cafes, museums, attractions, etc.)
- PostgreSQL with PostGIS for efficient spatial queries
- Streamlined MCP tools: `search_hotels`, `search_restaurants`, `search_pois`
- Flexible search modes: by name, by location (city or coordinates), or combined

### Enhanced Search Capabilities
- Combined name + location queries (e.g., "Marriott in Bangkok")
- Fuzzy name matching with similarity scoring
- Distance-based sorting with configurable radius
- POI type filtering (search specific types or all)

## Quick Start

**New to this project?** See [GETTING_STARTED.md](GETTING_STARTED.md) for a complete step-by-step setup guide that covers:
- Installing Node.js, PostgreSQL, and PostGIS
- Setting up the database (Docker or native installation)
- Importing GeoNames and OpenStreetMap data
- Configuring Google Places API (optional)
- Setting up Claude Desktop integration
- Troubleshooting common issues

**Quick install for experienced users:**

```bash
# Install dependencies
npm install

# Setup PostgreSQL database with PostGIS
createdb travel
psql travel < data/schema.sql

# Import data
npm run db:import-geonames                         # Import ~150k cities
node src/import-osm-pbf.js data/REGION.osm.pbf all # Import OSM POIs

# Start server
npm start  # For Claude Desktop (stdio)
# OR
npm run start:http  # For HTTP/SSE clients
```

## Server Modes

The server supports two transport modes:

**stdio transport** (for Claude Desktop):
```bash
npm start
```

**HTTP transport** (for web clients, ChatGPT, MCP Inspector):
```bash
npm run start:http  # Starts on port 3000
```

The HTTP server supports two transport protocols simultaneously:

| Endpoint | Protocol | Use Case |
|----------|----------|----------|
| `POST /` | StreamableHTTP | ChatGPT and modern MCP clients |
| `GET /sse` | SSE | MCP Inspector and legacy SSE clients |
| `GET /mcp` | SSE (alt) | Alternative SSE endpoint |
| `GET /health` | JSON | Health check endpoint |

**Connecting ChatGPT:**
1. Start the HTTP server: `npm run start:http`
2. Expose via ngrok: `ngrok http 3000`
3. Use the ngrok HTTPS URL in ChatGPT's MCP settings

**Connecting MCP Inspector:**
1. Start the HTTP server: `npm run start:http`
2. In MCP Inspector, connect to: `http://localhost:3000/sse`

For Claude Desktop configuration and detailed setup instructions, see [GETTING_STARTED.md](GETTING_STARTED.md).

## Available MCP Tools

All search tools enforce a **maximum limit of 100 results**. Each search tool also has a `_ui` variant (e.g., `search_hotels_ui`) that returns structured content for ChatGPT's Apps SDK in addition to plain text.

---

### Search Tools

#### `search_cities`

Search the GeoNames database of 150k+ cities worldwide. Requires either a `country_code` or coordinates — a bare `query` alone will return an error.

**Parameters**: `query`, `country_code`, `state`, `latitude`, `longitude`, `limit` (default 10, max 100)

**Valid combinations**:
| Parameters | Behaviour |
|------------|-----------|
| `query` + `country_code` | Name search within a country |
| `query` + `country_code` + `state` | Name search within a state/province |
| `query` + `latitude` + `longitude` | Name search near a point |
| `country_code` | List largest cities by population |
| `country_code` + `state` | List cities in a state |
| `latitude` + `longitude` | Nearest cities to a point (default radius 50 km) |

**Returns**: `geoname_id`, `name`, `country_code`, `country_name`, `state_code`, `state_name`, `population`, `latitude`, `longitude`, `timezone`, `distance_km` (coordinate searches)

---

#### `search_hotels` / `search_hotels_ui`

Search for accommodation: hotels, hostels, guest houses, motels, resorts, apartments, and B&Bs. Supports fuzzy name matching with similarity scoring.

**Parameters**: `query`, `city_name`, `country_code`, `state`, `latitude`, `longitude`, `radius_km` (default 15, max 50), `limit` (default 50, max 100)

**Valid combinations**:
- `query` — global brand/name search (e.g., "Marriott")
- `city_name` + `country_code` — all hotels in a city
- `latitude` + `longitude` — hotels within radius of a point
- `query` + `city_name` + `country_code` — brand search in a specific city
- `query` + `latitude` + `longitude` — brand search near coordinates
- Any of the above with optional `state` for disambiguation

**Response fields**: `osm_id`, `name`, `poi_type`, `latitude`, `longitude`, `city`, `country_code`, `osm_stars`, `osm_brand`, `google_rating`, `google_review_count`, `google_price_level`, `google_phone`, `google_website`, `google_maps_url`, `google_opening_hours`, `google_photos`, `photo_url`, `preview_url`, `resource_uri`, `distance_meters`, `is_favorite`, `favorite_since`, `favorite_notes`

Searches automatically trigger **background Google Places enrichment** for the top 10 results.

---

#### `search_restaurants` / `search_restaurants_ui`

Search for dining and drinking venues: restaurants, cafes, bars, pubs, fast food, and food courts. Same flexible search modes as `search_hotels`.

**Additional parameter**: `type` — optional enum filter (`restaurant`, `cafe`, `bar`, `pub`, `fast_food`, `food_court`)

**Extra response fields**: `osm_cuisine` (cuisine types from OSM)

---

#### `search_pois` / `search_pois_ui`

Universal search across all 30+ POI categories. Useful for exploring attractions, museums, castles, ruins, shopping, entertainment, and places of worship — or searching across all types at once.

**Additional parameters**:
- `poi_type` — single type filter (e.g., `museum`)
- `poiTypes` — array filter for multiple types (e.g., `["museum", "gallery", "castle"]`)

---

### Detail Tools

#### `get_poi_details` / `get_poi_details_ui`

Retrieve full information about a single POI by its OpenStreetMap ID or Google Place ID. If the POI has not yet been enriched with Google Places data, this call **triggers background enrichment** and returns a status message — call again after ~1 minute to get the enriched result.

**Parameters**: `osm_id` or `google_place_id`

**Enrichment statuses**: `complete` (data available), `pending` (enrichment in progress), `failed` (no match found), `disabled` (Google Places not configured)

**Response includes** all search fields plus: full Google reviews (top 5 with author, rating, text), service options (dine-in, takeout, delivery, reservations), amenities, accessibility features, parking and payment options, editorial summary, and business status.

The `_ui` variant renders a rich HTML detail page with photo galleries, rating stars, review excerpts, opening hours tables, and amenity icons.

---

### Favorites Tools

All favorites tools require authentication. Anonymous users receive a clear error message.

#### `add_favorite`

Bookmark a POI with optional personal notes. Uses upsert — calling it again on the same POI updates the notes.

**Parameters**: `osm_id` (required), `notes` (optional string)

#### `remove_favorite`

Remove a POI from your favorites.

**Parameters**: `osm_id` (required)

#### `list_favorites`

Retrieve your saved POIs with full detail, filtered by location or type.

**Parameters**: `city_name`, `country_code`, `state`, `latitude`, `longitude`, `radius_km` (default 50), `poi_types` (array filter, e.g., `["restaurant", "hotel"]`), `limit` (default 100, max 100)

**Returns**: Full POI details plus `is_favorite: true`, `favorite_since`, and `favorite_notes`. Sorted by distance (coordinate searches) or by date saved (city searches).

---

### Identity & Statistics

#### `whoami`

Returns the authenticated user's profile (`id`, `email`, `name`, `picture_url`) or `{ authenticated: false }` for anonymous sessions.

#### `get_stats`

Returns comprehensive database statistics: total countries, cities, POIs, and hotels; breakdowns by POI type and country; Google Places enrichment status distribution; and the 10 most recent completed imports with record counts.

---

### MCP Prompts

The server exposes five discovery-friendly prompts that guide LLMs through common workflows:

| Prompt | Description |
|--------|-------------|
| `find_hotels_in_city` | Search hotels in a given city and country |
| `find_restaurants_nearby` | Search restaurants near geographic coordinates |
| `find_attractions` | Discover tourist attractions in a city |
| `explore_area` | Comprehensive area exploration (hotels + restaurants + attractions) |
| `find_near_landmark` | Two-step workflow: find a landmark's coordinates, then search nearby |

---

### MCP Resources

| Resource | Description |
|----------|-------------|
| `info://version` | Server version and git commit info |
| `info://random-poi` | Link to a random enriched POI preview |
| `samples://queries` | Example queries with suggested workflows |
| `ui://{host}/poi/{osm_id}` | Rich HTML detail page for a specific POI |

## Google Places Enrichment

### How It Works

1. **Automatic Enrichment**: When you search for hotels, restaurants, or attractions, the top 10 results are automatically enriched in the background
2. **Fire-and-Forget**: Search results return immediately with OSM data; enrichment happens asynchronously
3. **Smart Caching**: Enriched data cached for 7 days (configurable) to minimize API costs
4. **Selective**: Only "bookable" POIs enriched (hotels, restaurants, museums) - not monuments or viewpoints

### Enrichment Data Provided

- **Ratings**: Google star rating (0.0 - 5.0)
- **Reviews**: Number of user reviews
- **Price Level**: Cost indicator (0-4: free to very expensive)
- **Photos**: Photo references for images
- **Verified Details**: Google-verified phone, website, address
- **Opening Hours**: Detailed hours for each day of week
- **Place Types**: Google's place type classifications

### Cost Management

- **Caching**: 7-day default (168 hours) - configurable via `GOOGLE_PLACES_CACHE_HOURS`
- **Batch Limiting**: Only top 10 results per search enriched
- **Selective Types**: Only enriches POIs where reviews/hours matter
- **Retry Prevention**: Failed matches cached 24 hours to avoid repeated API calls
- **Estimated Cost**: ~$0.05 per enrichment (Basic Data SKU)

See [GOOGLE_PLACES_INTEGRATION.md](GOOGLE_PLACES_INTEGRATION.md) for detailed documentation.

## Database Schema

### GeoNames Tables
- `geonames_cities`: Cities worldwide (150k+)
- `geonames_countries`: Country reference data
- `geonames_alternate_names`: City name translations
- `geonames_admin_codes`: Administrative divisions
- `geonames_timezones`: Timezone data
- `geonames_feature_codes`: Feature type definitions
- `geonames_hierarchy`: Geographic hierarchy

### OSM Tables
- `pois`: All POI data with Google Places enrichment columns
- `regions`: Imported OSM regions tracking

### Import Tracking
- `imports`: Import history and metadata

### Key Fields in `pois` Table

**OSM Data**:
- `osm_id`, `osm_type`, `poi_type`, `name`
- `location` (PostGIS geography point)
- `latitude`, `longitude`
- `address`, `cuisine`, `opening_hours`
- `phone`, `email`, `website`
- `stars`, `rooms`, `beds` (for hotels)

**Google Places Enrichment**:
- `google_place_id`, `google_rating`, `google_user_ratings_total`
- `google_price_level`, `google_types`
- `google_formatted_address`, `google_phone`, `google_website`
- `google_opening_hours` (JSONB)
- `google_photos` (JSONB)
- `google_enriched_at`, `google_enrichment_status`

## Testing

Test Google Places integration:
```bash
node test-google-places.js
```

Test hotel search with enrichment:
```bash
node test-search-with-enrichment.js
```

Test Bangkok hotel search:
```bash
node test-bangkok-search.js
```

## Architecture

```
┌─────────────────────┐
│  Claude Desktop     │
│  (MCP Client)       │
└──────────┬──────────┘
           │ MCP Protocol
           ▼
┌─────────────────────────────────────┐
│  MCP Server (index.js)     │
│  - Tool definitions                 │
│  - Request handling                 │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  TravelDatabase                     │
│  (database.js)             │
│  - City search (GeoNames)           │
│  - POI search (OSM)                 │
│  - Spatial queries (PostGIS)        │
│  - Background enrichment            │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  GooglePlacesClient                 │
│  (google-places.js)                 │
│  - Place search & matching          │
│  - Enrichment with full details     │
│  - Rate limiting & error handling   │
└─────────────────────────────────────┘
```

## Data Flow: Search with Enrichment

1. User searches for hotels via MCP tool
2. MCP server calls `unifiedSearchPOIs()` in database layer
3. Database returns OSM POI data immediately
4. Background enrichment triggered for top 10 results
5. Google Places API queried for each POI
6. Enrichment data stored in `pois` table
7. Subsequent queries return both OSM + Google data

## Data Sources

- **GeoNames**: http://www.geonames.org/ - City and geographic data (CC BY 4.0)
- **OpenStreetMap**: https://www.openstreetmap.org/ - POI data (ODbL)
- **Google Places API**: https://developers.google.com/maps/documentation/places - Business details, ratings, reviews

## Known Issues & Future Work

See [TODO.md](TODO.md) for planned improvements:
- SQL injection security audit
- Separate data sources into dedicated tables (OSM, Google, mapping)
- Improve Google Places matching algorithm (especially for Thai/non-Latin names)
- Data caching and automatic refresh system
- Additional POI types and features

## Project Structure

```
travel-mcp-server/
├── src/
│   ├── index.js                   # MCP server (stdio transport)
│   ├── index-http.js              # MCP server (HTTP transport - dual protocol)
│   ├── database.js                # Database layer with all queries
│   ├── google-places.js           # Google Places API client
│   ├── telemetry.js               # Sentry telemetry integration
│   ├── templates/                 # Handlebars templates for MCP Apps
│   │   ├── index.js               # Template engine
│   │   ├── poi-details.hbs        # POI detail page template
│   │   ├── test-widget.hbs        # Test widget template
│   │   └── error.hbs              # Error page template
│   ├── import-geonames.js         # GeoNames city import
│   ├── import-geonames-extended.js# Extended GeoNames data
│   └── import-osm.js              # OpenStreetMap POI import
├── data/
│   └── schema.sql                 # PostgreSQL schema with PostGIS
├── .env                           # Configuration (API keys)
├── .env.example                   # Configuration template
├── package.json                   # Dependencies and scripts
├── TODO.md                        # Planned improvements
├── GETTING_STARTED.md             # Setup guide
├── GOOGLE_PLACES_INTEGRATION.md   # Google Places docs
└── README.md                      # This file
```

## License

MIT
