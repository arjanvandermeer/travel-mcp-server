# Travel MCP Server

MCP server for travel information using GeoNames city data, OpenStreetMap POI data, and Google Places API enrichment.

This MCP server uses publicly available data and API's. All code is written by me (and Claude) in my own time and has no correlation to my employer or colleagues. 

## Features

- **Multi-Source Data Integration**: Combines GeoNames cities, OpenStreetMap POIs, and Google Places enrichment
- **Comprehensive POI Search**: Hotels, restaurants, cafes, museums, attractions, shopping, and more
- **City Search**: Search cities worldwide from GeoNames database (150k+ cities)
- **Smart Location-Based Search**: Find POIs by city name, coordinates, or combined name+location queries
- **Google Places Enrichment**: Automatic background enrichment with ratings, reviews, photos, and verified details
- **Unified Search API**: Single `search_pois` tool supports all POI types with flexible filtering
- **PostgreSQL + PostGIS**: Efficient spatial queries with geographic indexing

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

### 1. `search_cities`

Search for cities by name with optional country filtering.

```json
{
  "query": "Bangkok",
  "country_code": "TH",
  "limit": 10
}
```

Returns cities with coordinates, population, timezone.

### 2. `search_hotels`

Search for hotels by name, location, or both.

**Search modes:**
- By name only: `{ "query": "Marriott" }`
- By city: `{ "city_name": "Bangkok", "country_code": "TH" }`
- By coordinates: `{ "latitude": 13.7563, "longitude": 100.5018, "radius_km": 5 }`
- Combined: `{ "query": "Marriott", "city_name": "Bangkok" }`

**Response includes**:
- OSM data: name, address, phone, website, stars, rooms
- Google Places data (if enriched): rating, reviews, photos, verified details
- Distance from search center
- Enrichment status

### 3. `search_restaurants`

Search for restaurants by name, location, or both. Same flexible search modes as `search_hotels`.

```json
{
  "query": "Italian restaurant",
  "city_name": "Bangkok",
  "country_code": "TH",
  "limit": 20
}
```

**Response includes**:
- OSM data: name, cuisine, opening_hours, phone, website
- Google Places data (if enriched): rating, reviews, price_level, photos
- Distance from search center

### 4. `search_pois`

Universal POI search supporting all POI types.

```json
{
  "query": "museum",
  "city_name": "Paris",
  "country_code": "FR",
  "poi_type": "museum",
  "limit": 20
}
```

**Parameters**:
- `query`: Optional name to search for
- `city_name` / `country_code`: Optional location filter
- `latitude` / `longitude` / `radius_km`: Optional coordinate-based search
- `poi_type`: Optional type filter (hotel, restaurant, museum, etc.)
- `limit`: Max results (default: 50)

### 5. `get_poi_details`

Get detailed information about a specific POI, including Google Places enrichment.

```json
{
  "osm_id": 255562903
}
```

**Triggers background enrichment** if POI hasn't been enriched yet.

### 6. `get_stats`

Get database statistics: countries, cities, POIs by type, coverage by region.

```json
{}
```

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
hotel-mcp-server/
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
