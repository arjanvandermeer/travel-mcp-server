# Hotel MCP Server

A Model Context Protocol (MCP) server that provides access to hotel and geographic information from open data sources including GeoNames, OpenStreetMap, and Wikidata.

## Project Status

**Current Progress:**
- ✅ Project structure created
- ✅ Database schema designed (SQLite with spatial indexes)
- ✅ GeoNames import script completed (countries + cities)
- ✅ GeoNames countries data imported (252 countries)
- ✅ GeoNames cities data imported (33,103 cities)
- ✅ MCP server with tools implemented
- ✅ Test suite created and passing
- 🔜 OpenStreetMap hotel data import (next step)
- 🔜 Wikidata enrichment (future)

## What We've Built So Far

### 1. Database Layer (`src/database.js`)
- SQLite database with four main tables:
  - `geonames_countries`: Country data with ISO codes, capitals, currencies, languages
  - `geonames_cities`: City data with coordinates, population, timezone
  - `hotels`: Hotel data with amenities, contact info, ratings
  - `amenities`: Lookup table for hotel amenities
- Spatial indexing for fast geographic queries
- Methods for searching countries/cities/hotels by name or coordinates
- Haversine distance calculations for "near me" queries

### 2. GeoNames Import (`src/import-geonames.js`)
- Downloads and parses GeoNames country and city data
- Imports countryInfo.txt (252 countries with ISO codes, currencies, languages)
- Imports cities data (cities1000.txt, cities5000.txt, or cities15000.txt)
- Batch processing (1000 records at a time) for performance
- Progress reporting during import
- Gracefully handles missing files

### 3. MCP Server (`src/index.js`)
- Implements Model Context Protocol
- 6 tools available:
  1. `search_cities` - Search cities by name
  2. `get_city_by_id` - Get city details by GeoNames ID
  3. `find_cities_near_coordinates` - Find cities within radius
  4. `search_hotels` - Search hotels (needs OSM data)
  5. `find_hotels_near_coordinates` - Find hotels within radius (needs OSM data)
  6. `get_database_stats` - Database statistics
- Communicates via stdio (standard MCP protocol)

### 4. Test Suite (`test.js`)
- Tests all database operations
- Tests country search and lookup by ISO code
- Inserts sample cities (London, Paris, NYC)
- Inserts sample hotels (Ritz London, Plaza Athénée)
- Verifies search and geospatial queries work
- All tests passing with real GeoNames data

## Installation
```bash
# Already done:
npm install

# Dependencies installed:
# - @modelcontextprotocol/sdk: MCP protocol implementation
# - better-sqlite3: Fast SQLite database
```

## Next Steps

### ✅ Completed: Import GeoNames Data

GeoNames data has been successfully imported:
- ✅ 252 countries with full metadata (ISO codes, currencies, languages, etc.)
- ✅ 33,103 cities (population > 15,000)
- ✅ All tests passing

To re-import or update data:
```bash
cd data
curl -O http://download.geonames.org/export/dump/countryInfo.txt
curl -O http://download.geonames.org/export/dump/cities15000.zip
unzip cities15000.zip
cd ..
npm run import
```

### Next: OpenStreetMap Hotel Import

Need to create `src/import-osm.js` that:
- Queries Overpass API for hotels in specific regions
- Parses OSM tags (`tourism=hotel`, `name`, `addr:*`, `contact:*`)
- Extracts amenities from tags (`wifi`, `parking`, `pool`, etc.)
- Imports into `hotels` table

Example Overpass API query:
```
[out:json];
area["ISO3166-1"="GB"][admin_level=2];
node["tourism"="hotel"](area);
out body;
```

### Future: Enhancements

1. **Wikidata Enrichment**
   - Query SPARQL endpoint for notable hotels
   - Add historical information, awards, notable guests
   - Link to Wikimedia Commons images

2. **More MCP Tools**
   - `search_hotels_by_amenities`: Filter by wifi, pool, parking
   - `get_hotels_in_city`: All hotels in a city
   - `find_nearest_airport`: Airport proximity queries
   - `compare_hotels`: Side-by-side comparison

3. **Performance Improvements**
   - Add full-text search indexes
   - Cache frequently-accessed data
   - Consider PostGIS for more accurate distance calculations

4. **API Integrations**
   - Real-time pricing from booking APIs
   - Availability checks
   - Review aggregation

## Architecture Decisions

### Why These Data Sources?

- **GeoNames**: Free, comprehensive, well-maintained city database with coordinates
- **OpenStreetMap**: Open data with decent hotel coverage, especially in Europe/US
- **Wikidata**: Rich metadata for notable properties

### Why SQLite?

- Self-contained (no separate database server)
- Fast for read-heavy workloads
- Perfect for MCP servers running locally
- Good enough spatial support for our needs

### Why MCP?

- Standard protocol for LLM tool integration
- Works with Claude Desktop, custom clients, etc.
- Clean separation between data and AI interface

## Project Structure
```
hotel-mcp-server/
├── src/
│   ├── database.js          # Database layer and queries
│   ├── index.js             # Main MCP server
│   └── import-geonames.js   # GeoNames data import
├── data/                    # Database and source data files
│   └── hotels.db           # SQLite database (created on import)
├── test.js                  # Test suite
├── package.json             # Project config
├── .gitignore              # Git ignore rules
└── README.md               # This file
```

## Data Schema

### geonames_countries
```sql
iso TEXT PRIMARY KEY
iso3 TEXT
iso_numeric TEXT
fips TEXT
country TEXT NOT NULL
capital TEXT
area_sq_km INTEGER
population INTEGER
continent TEXT
tld TEXT
currency_code TEXT
currency_name TEXT
phone TEXT
postal_code_format TEXT
postal_code_regex TEXT
languages TEXT
geoname_id INTEGER UNIQUE
neighbours TEXT
equivalent_fips_code TEXT
```

### geonames_cities
```sql
geoname_id INTEGER PRIMARY KEY
name TEXT
ascii_name TEXT
alternate_names TEXT
latitude REAL
longitude REAL
feature_class TEXT
feature_code TEXT
country_code TEXT
admin1_code TEXT
admin2_code TEXT
population INTEGER
elevation INTEGER
timezone TEXT
modification_date TEXT
```

### hotels
```sql
id INTEGER PRIMARY KEY
osm_id TEXT UNIQUE
name TEXT
latitude REAL
longitude REAL
address TEXT
city TEXT
country_code TEXT
phone TEXT
website TEXT
email TEXT
stars INTEGER
rooms INTEGER
amenities TEXT (JSON array)
```

## Using with Claude Desktop

Add to your Claude Desktop config:

**MacOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{
  "mcpServers": {
    "hotel-info": {
      "command": "node",
      "args": ["/FULL/PATH/TO/hotel-mcp-server/src/index.js"]
    }
  }
}
```

Restart Claude Desktop, then ask:
- "Search for cities named London"
- "Find cities within 100km of Paris"
- "What's the population of Tokyo?"

## Development Context

This project was started to create an open-data alternative to commercial hotel APIs. The goal is to provide LLMs with rich, structured hotel and geographic information without relying on proprietary services.

**Design Philosophy:**
- Open data sources only
- Fast local queries (no network latency)
- Comprehensive geographic coverage
- Extensible architecture

**Key Learnings:**
- GeoNames has excellent city coverage (25k cities with pop > 15k)
- OSM hotel data quality varies by region
- Spatial queries need careful optimization
- Batch imports are crucial for performance

## Contributing

**Current Priorities:**
1. OpenStreetMap hotel import script
2. Testing with real-world queries
3. Performance optimization for large datasets

**Future Work:**
- Wikidata integration
- Image URLs from Wikimedia
- Review sentiment analysis
- Booking integration

## License

MIT

## Data Attribution

- **GeoNames**: http://www.geonames.org/ (CC BY 4.0)
- **OpenStreetMap**: http://www.openstreetmap.org/ (ODbL)
- **Wikidata**: http://www.wikidata.org/ (CC0)

## Contact & Support

This is an open-source project. Issues, PRs, and suggestions welcome!

---

**Last Updated:** 2026-01-07
**Status:** Active Development
**Next Milestone:** GeoNames import complete + OSM hotel import script