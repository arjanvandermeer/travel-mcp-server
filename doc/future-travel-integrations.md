# Future Travel Integrations

This note records the current decision for Wikidata enrichment and route-planning work. Neither should be mixed into the core POI search path until its source limits, licensing, and cache behavior are explicit.

## Wikidata Enrichment

### Useful Data

Wikidata can complement OSM and Google Places for:

- attraction descriptions and aliases
- official website and social links when absent in OSM
- image metadata through Wikimedia Commons
- entity relationships such as architect, collection, operator, or heritage status
- event/venue context for museums, galleries, monuments, stadiums, and cultural sites

### Limits

- Wikidata coverage is uneven for restaurants, small hotels, and local businesses.
- Wikimedia image licensing varies by file; downstream responses must preserve attribution and license metadata.
- Entity matching by name alone is risky. Use OSM `wikidata` tags first, then conservative name/location matching only for attraction-like POIs.
- Descriptions are encyclopedic, not travel-specific. They should supplement, not replace, Google editorial summaries or OSM tags.

### Recommended Shape

Implement Wikidata as an enrichment job and detail-view supplement, not as a default search-time dependency.

Suggested staging:

1. Add optional `wikidata_id`, `wikimedia_commons`, and attribution fields to a dedicated cache table.
2. Backfill only POIs that already have an OSM `wikidata` tag.
3. Expose cached fields in `get_poi_details` and preview pages.
4. Add a manual refresh/admin script after cache behavior is stable.

Do not call Wikidata live from MCP tool handlers; keep tool latency predictable and avoid introducing a new external availability dependency.

## Route Planning

### Useful Data

Route planning can improve:

- day-by-day itinerary ordering
- hotel-to-POI accessibility checks
- walking/transit time estimates
- neighborhood and stay quality scoring

### Limits

- Accurate routes require a routing engine or provider. Straight-line distance is not a substitute for travel time.
- Transit data depends on local GTFS availability and licensing.
- Paid providers add quota, cost, key management, and terms-of-use constraints similar to Google Places.
- Self-hosted routing such as OSRM or Valhalla needs region extracts, memory, disk, and refresh operations outside the current lightweight server model.

### Recommended Shape

Implement route planning as a separate optional integration rather than embedding it into existing POI search.

Suggested staging:

1. Add a provider abstraction for `walking`, `driving`, and optionally `transit`.
2. Start with an explicit `estimate_route` tool that returns provider, mode, distance, duration, and confidence.
3. Cache route responses by rounded coordinate pairs, mode, and provider.
4. Let `build_itinerary` consume cached route durations only after the standalone tool is stable.

The current `build_itinerary` tool should continue using PostGIS distance and clustering until a routing provider is selected.

## Decision

Wikidata and route planning belong as optional enrichment/integration layers:

- Wikidata: cached enrichment for POI details and previews.
- Routing: provider-backed tool first, then itinerary enhancement.

Both should be implemented behind explicit configuration flags, with tests that cover disabled-provider behavior, sparse data, attribution fields, and cache hits. This avoids making the reliable core POI/search surfaces dependent on external services that have different licensing, latency, and quota profiles.
