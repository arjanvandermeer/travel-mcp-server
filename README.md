# Travel MCP Server

MCP server for travel information using GeoNames city data, OpenStreetMap POI data, and Google Places API enrichment.

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

## Installation

```bash
npm install
```

## Configuration

### Database Setup

Create PostgreSQL database:

```bash
createdb travel
psql travel < schema.sql
```

### Google Places API (Optional but Recommended)

1. Get API key from [Google Cloud Console](https://console.cloud.google.com/)
2. Enable "Places API (New)"
3. Create `.env` file:

```env
DATABASE_URL=postgresql://traveluser:travelpass@localhost:5432/travel
GOOGLE_PLACES_API_KEY=your_api_key_here
GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_CACHE_HOURS=168  # 7 days
```

**Note**: Google Places enrichment is optional. The server works fine with just OSM data.

## Data Import

### 1. Import GeoNames Cities

```bash
npm run import:geonames
```

Imports ~150k cities worldwide from GeoNames (cities with population >1000).

### 2. Import Extended GeoNames Data (Optional)

```bash
npm run import:geonames-extended
```

Imports alternate names, admin codes, timezones, feature codes, and hierarchy data.

### 3. Import OpenStreetMap POIs

```bash
npm run import:osm
```

Imports POI data (hotels, restaurants, attractions, etc.) from OpenStreetMap for specified regions.

**Interactive mode**: Prompts for region selection (city, country, or custom bounding box)

**Supported POI types**:
- Accommodations: hotel, hostel, guest_house, motel
- Dining: restaurant, cafe, bar, pub, fast_food, food_court
- Attractions: museum, gallery, zoo, theme_park, attraction, castle, archaeological_site, ruins
- Entertainment: cinema, theatre, nightclub
- Shopping: shopping_mall, department_store, supermarket
- Religious: place_of_worship
- Others: monument, memorial, artwork, viewpoint

## Usage

### Start the MCP Server

**For stdio transport (Claude Desktop):**
```bash
npm start
```

**For HTTP/SSE transport (testing):**
```bash
npm run start:http
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "travel-info": {
      "command": "/path/to/node",
      "args": ["/path/to/hotel-mcp-server/src/index-postgres.js"]
    }
  }
}
```

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
│  MCP Server (index-postgres.js)     │
│  - Tool definitions                 │
│  - Request handling                 │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  TravelDatabase                     │
│  (database-postgres.js)             │
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
│   ├── index-postgres.js          # MCP server (stdio)
│   ├── database-postgres.js       # Database layer with all queries
│   ├── google-places.js           # Google Places API client
│   ├── import-geonames.js         # GeoNames city import
│   ├── import-geonames-extended.js# Extended GeoNames data
│   └── import-osm.js              # OpenStreetMap POI import
├── schema.sql                     # PostgreSQL schema with PostGIS
├── .env                           # Configuration (API keys)
├── .env.example                   # Configuration template
├── package.json                   # Dependencies and scripts
├── TODO.md                        # Planned improvements
├── GOOGLE_PLACES_INTEGRATION.md   # Google Places docs
└── README.md                      # This file
```

## License

MIT
