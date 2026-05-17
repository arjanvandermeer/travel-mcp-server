# Travel MCP Server

An MCP server for travel information, powered by GeoNames city data, OpenStreetMap POIs, and Google Places enrichment.

**Live at**: https://travel.arjanvandermeer.com

**Built by Arjan van der Meer in his own time, with AI coding assistance from Claude and Codex. This project has no affiliation with his employer or colleagues.**

## Features

- **Multi-source data** — 165K+ cities (GeoNames), 2.5M+ POIs (OpenStreetMap), lazy-enriched with Google Places (ratings, reviews, photos)
- **30+ POI categories** — hotels, hostels, restaurants, cafes, bars, museums, castles, ruins, shopping, and more
- **Flexible search** — by name (fuzzy matching), city, coordinates with radius, or any combination
- **OAuth 2.1 authentication** — Google sign-in via Cloudflare Worker, with PKCE and auto-provisioning
- **Personal favorites** — bookmark POIs with notes, filtered by location or type
- **Rich detail views** — structured JSON or rendered HTML pages via MCP resource templates
- **Dual transport** — stdio (Claude Desktop) and Streamable HTTP (ChatGPT, MCP Inspector, web clients)
- **[Local SLM agent](slm/README.md)** — offline travel assistant powered by Ollama (Qwen 3.5), with tool calling against the REST API or MCP — great for demos, model evaluation, and prompt tuning

## Engineering Highlights

This codebase is actively maintained as a practical AI-assisted engineering project. Recent work focused on:

- **Reliable enrichment scheduling** — Google Places enrichment now uses a generic `next_enrichment_at` schedule for quota pauses, errors, not-found retries, and 90-day refreshes of active data.
- **Search-triggered background enrichment** — displayed POIs can queue enrichment automatically, processed serially in oldest-due order to avoid quota spikes and duplicate work.
- **Mobile-first web UI iteration** — the homepage has been reshaped around city discovery, combinable Stay/Eat/See filters, persisted feed preferences, and compact navigation.
- **Operational guardrails** — CI-oriented checks, npm audit capture, Actions log monitoring, and a recurring code-audit workflow are documented and wired into the repository.
- **Repository hygiene** — unused files, obsolete planning docs, naming inconsistencies, and code-sprawl risks are tracked through GitHub issues and cleanup commits.

## Quick Start

See [doc/getting-started.md](doc/getting-started.md) for full setup instructions.

```bash
npm install
npm run db:init                                       # Safely create missing tables
npm run db:import-geonames                            # Import ~150k cities
node scripts/import-osm.js data/REGION.osm.pbf all     # Import OSM POIs
npm run init:osm -- thailand                           # Initialize DB and download/import one OSM region
npm start                                             # stdio (Claude Desktop)
npm run start:http                                    # HTTP (port 3000)
```

## MCP Tools

All search tools enforce a max of 100 results. Search/detail/nearby tools have `_ui` variants for ChatGPT Apps SDK widgets.

| Tool | Description |
|------|-------------|
| `search_cities` | Search 165K+ cities by name, country, or coordinates |
| `search_hotels` / `_ui` | Hotels, hostels, B&Bs — by name, city, or location |
| `compare_hotels` | Compare 2-5 hotels by OSM ID, including ratings, amenities, location signals, and standout differences |
| `get_neighborhood_score` | Score amenities around a hotel or coordinate pair |
| `build_itinerary` | Build deterministic day plans from a hotel base and interest set |
| `search_restaurants` / `_ui` | Restaurants, cafes, bars — with optional type filter |
| `plan_dining` | Build multi-day dining plans with budget, cuisine variety, and dietary filters |
| `get_dining_budget` | Estimate city dining costs from enriched restaurant price-level data |
| `find_food_districts` | Find restaurant-dense city districts using spatial clustering |
| `search_pois` / `_ui` | Universal search across all 30+ POI categories |
| `get_poi_details` / `_ui` | Full POI info, triggers Google Places enrichment |
| `get_nearby_pois` / `_ui` | Find hotels near restaurants or vice versa |
| `add_favorite` | Bookmark a POI with optional notes |
| `remove_favorite` | Remove a bookmark |
| `list_favorites` | Retrieve saved POIs, filtered by location/type |
| `whoami` | Current user identity |
| `get_user_preferences` | Retrieve saved currency, language, and home location |
| `set_user_preferences` | Save currency, language, and home location |
| `get_stats` | Database statistics and recent imports |

## Architecture

```
Claude Desktop / ChatGPT / Web Browser
         │
         ▼
┌─────────────────────────────┐
│  MCP Server                 │
│  (tools-config.js)          │
│  stdio + Streamable HTTP    │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐     ┌──────────────────────┐
│  TravelDatabase             │────▶│  GooglePlacesClient   │
│  (database.js)              │     │  (google-places.js)   │
│  PostgreSQL + PostGIS       │     │  Lazy enrichment      │
└─────────────────────────────┘     └──────────────────────┘
```

## Documentation

| Document | Description |
|----------|-------------|
| [doc/architecture.md](doc/architecture.md) | Authoritative layers and canonical request flows |
| [doc/getting-started.md](doc/getting-started.md) | Full setup guide (database, imports, Claude Desktop) |
| [doc/authentication.md](doc/authentication.md) | OAuth 2.1 implementation details |
| [doc/database-schema.md](doc/database-schema.md) | PostgreSQL schema reference |
| [doc/osm-import-system.md](doc/osm-import-system.md) | OpenStreetMap import workflow |
| [doc/google-places.md](doc/google-places.md) | Google Places API integration |
| [doc/http-transport.md](doc/http-transport.md) | Streamable HTTP server setup |
| [doc/openapi.yaml](doc/openapi.yaml) | OpenAPI 3.1 REST API specification, also served at `/openapi.yaml` |
| [doc/future-travel-integrations.md](doc/future-travel-integrations.md) | Wikidata and route-planning integration decisions |
| [slm/README.md](slm/README.md) | Local SLM agent with Ollama (usage, test suite, integration guide) |
| [GitHub Issues](https://github.com/arjanvandermeer/travel-mcp-server/issues) | Planned improvements and known issues |

## Data Sources

- **[GeoNames](http://www.geonames.org/)** — City and geographic data (CC BY 4.0)
- **[OpenStreetMap](https://www.openstreetmap.org/)** — POI data (ODbL)
- **[Google Places API](https://developers.google.com/maps/documentation/places)** — Business details, ratings, reviews

## License

MIT
