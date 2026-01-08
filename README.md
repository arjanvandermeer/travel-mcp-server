# Travel MCP Server

MCP server for travel information using GeoNames city data and OpenStreetMap POI data (hotels, restaurants, attractions, etc.).

## Features

- **City Search**: Search cities worldwide from GeoNames database (150k+ cities with population >1000)
- **City-based Hotel Search**: Find hotels within cities using population-based radius
- **Coordinate-based Search**: Find hotels near specific GPS coordinates
- **Smart Caching**: Lazy-loading cache with automatic background refresh
- **Dynamic Radius**: Search radius automatically scales with city population (3-25km)
- **Pending Status**: LLM-friendly status responses during data fetching

## Installation

```bash
npm install
```

## Data Import

### 1. Import GeoNames Cities

```bash
npm run import
```

Downloads and imports city data from GeoNames (cities with population >1000).

### 2. Hotel Data (OSM)

Hotel data is fetched on-demand from OpenStreetMap when you first search a region. No pre-import needed!

## Usage

### Start the MCP Server

**For stdio transport (Claude Desktop, etc.):**
```bash
npm start
```

**For HTTP transport (testing):**
```bash
npm run start:http
```

### Available Tools

#### 1. `search_cities`

Search for cities by name:

```json
{
  "query": "Bangkok",
  "limit": 10
}
```

Returns matching cities ordered by population.

#### 2. `find_hotels_in_city` (Recommended)

Find hotels within a city automatically:

```json
{
  "city_name": "Bangkok",
  "country_code": "TH",
  "limit": 50
}
```

**How it works:**
1. Searches for the city in GeoNames database
2. Determines appropriate search radius based on population:
   - Mega cities (>5M): 25km radius
   - Large cities (1-5M): 15km radius
   - Medium cities (500k-1M): 10km radius
   - Small cities (100k-500k): 5km radius
   - Towns (<100k): 3km radius
3. Fetches hotels from cache or triggers OSM fetch

**Response includes:**
- City information (name, country, population, coordinates)
- Search radius used
- Status (`fetching`, `cached`, or `cached_stale`)
- Hotels array with distance from city center
- Cache metadata

#### 3. `find_hotels_near_coordinates`

Find hotels near specific GPS coordinates:

```json
{
  "latitude": 13.7563,
  "longitude": 100.5018,
  "radius_km": 5,
  "limit": 50
}
```

Returns hotels within the specified radius.

#### 4. `get_city_by_id`

Get detailed city information by GeoNames ID:

```json
{
  "geoname_id": 1609350
}
```

#### 5. `get_hotel_by_id`

Get detailed hotel information by OSM ID:

```json
{
  "osm_id": "node/123456789"
}
```

#### 6. `get_database_stats`

Get database statistics (cities count, hotels count, cache status).

## Status Responses

The server uses structured status responses to help LLMs understand cache state:

### `fetching` - Initial Fetch

First request for an uncached region:

```json
{
  "status": "fetching",
  "message": "Hotel data for this region is being fetched from OpenStreetMap. Please retry this request in 10-30 seconds.",
  "hotels": [],
  "cache_info": {
    "is_fetching": true,
    "is_cached": false,
    "estimated_wait_seconds": 20
  },
  "instruction": "Hotel data for Bangkok is being fetched. Please retry in 10-30 seconds."
}
```

**LLM should**: Inform user to retry in 10-30 seconds.

### `cached` - Fresh Data

Subsequent requests with fresh cached data (<30 days):

```json
{
  "status": "cached",
  "message": "Data successfully retrieved from cache.",
  "hotels": [...],
  "count": 42,
  "cache_info": {
    "is_fetching": false,
    "is_cached": true,
    "is_stale": false,
    "last_updated": "2026-01-07T18:45:40.000Z"
  }
}
```

**LLM should**: Present results immediately.

### `cached_stale` - Refreshing

Stale data (>30 days) being refreshed in background:

```json
{
  "status": "cached_stale",
  "message": "Returning cached data while fetching fresh data in the background. Data may be up to 30 days old.",
  "hotels": [...],
  "count": 42,
  "cache_info": {
    "is_fetching": true,
    "is_cached": true,
    "is_stale": true,
    "last_updated": "2025-12-01T10:30:00.000Z"
  }
}
```

**LLM should**: Present results but mention data might be slightly outdated.

See [PENDING_STATUS.md](PENDING_STATUS.md) for detailed documentation.

## Caching System

- **Cache TTL**: 30 days for regions, 90 days for individual hotels
- **Lazy Loading**: Data fetched on-demand from OSM when first requested
- **Background Refresh**: Stale caches automatically refresh in background
- **Race Protection**: Multiple simultaneous requests for same region only trigger one fetch
- **Rate Limiting**: 1-second minimum delay between OSM API requests with exponential backoff

## Database Schema

### GeoNames Tables

- `geonames_cities`: City data (150k+ cities)
- `geonames_countries`: Country reference data

### OSM Cache Tables

- `osm_cache_hotels`: Cached hotel data from OpenStreetMap
- `osm_cache_metadata`: Cache status and timestamps

## Testing

Test the city search workflow:

```bash
node test-city-search.js
```

Test pending status responses:

```bash
node test-pending-status.js
```

## Configuration

Edit database paths in source files if needed:
- Default: `./data/hotels.db` (created automatically)

## Architecture

```
┌─────────────────┐
│  LLM (Claude)   │
└────────┬────────┘
         │ MCP Tools
         ▼
┌─────────────────┐
│  MCP Server     │
│  tools-config   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  HotelDatabase (database.js)        │
│  - City search (GeoNames)           │
│  - Boundary lookup (Shapes)         │
│  - Hotel queries (OSM Cache)        │
│  - Background fetch orchestration   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  OSM API (osm-api.js)               │
│  - Rate-limited fetch               │
│  - Exponential backoff              │
│  - Retry logic                      │
└─────────────────────────────────────┘
```

## Data Sources

- **GeoNames**: http://www.geonames.org/ (city and boundary data)
- **OpenStreetMap**: https://www.openstreetmap.org/ (hotel data via Overpass API)

## License

MIT
