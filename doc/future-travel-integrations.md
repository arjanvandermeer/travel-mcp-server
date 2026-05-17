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

## Commercial And Review Integrations

Future hotel, restaurant, review, reservation, and booking integrations should be evaluated one provider at a time. Do not add broad multi-provider abstractions before at least one provider is approved and integrated.

### Evaluation Checklist

Every provider needs a short implementation issue that answers:

- Data access: public API, partner API, paid contract, or no stable access.
- Allowed use: display, caching, ranking, derived summaries, and attribution requirements.
- Cost and quota: free tier, expected request volume, burst limits, and failure behavior.
- User value: whether it improves an existing workflow or introduces a new one.
- Privacy: whether user identity, location, or trip intent leaves the application.
- Operational model: cache lifetime, refresh schedule, secrets, monitoring, and disabled-state behavior.

### Candidate Decisions

| Candidate | Current decision | Reason |
|---|---|---|
| Booking.com / Expedia availability and pricing | Defer until partner access is explicit. | Availability and price data are contract-sensitive, cache-sensitive, and likely unsuitable for unauthenticated public tool calls. |
| Yelp / TripAdvisor / Foursquare enrichment | Defer pending licensing review. | Review text, ratings, photos, and rankings often have strict attribution, caching, and display limits. |
| Cross-platform review aggregation | Do not implement before source-specific approvals. | Aggregation can violate provider terms if it normalizes or republishes review/rating content without permission. |
| Multi-source hotel price comparison | Defer. | Requires booking-provider contracts, freshness guarantees, currency/tax normalization, and user-facing disclaimers. |
| Loyalty program points tracking | Separate user-feature issue if pursued. | It is account-specific and belongs with authenticated user preferences/trips, not general POI search. |
| Reservation availability / booking | Defer until a booking provider is selected. | Requires provider-specific checkout/deep-link behavior, liability boundaries, and clear handoff UX. |
| Private dining / event booking | Defer. | High-touch supply and venue-specific availability make it a product partnership, not a general enrichment layer. |

### Recommended Near-Term Focus

Keep core search focused on durable, inspectable data:

1. OSM and GeoNames for open geographic coverage.
2. Google Places for cached business enrichment with existing quota controls.
3. Optional Wikidata enrichment for attractions once attribution storage exists.
4. Optional route estimates after a provider or self-hosted routing engine is selected.

Commercial availability, booking, and review aggregation should remain future product integrations until legal access and user value are both clear.
