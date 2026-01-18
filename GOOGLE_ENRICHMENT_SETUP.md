# Google Places Enrichment Setup

## What Changed

### New Database Tables

1. **`google_places`** - Stores all Google Places API data
   - Place details (name, address, phone, website, etc.)
   - Ratings and reviews
   - Photos and opening hours
   - Business status
   - All raw API response data

2. **`osm_google_mappings`** - Maps OSM POIs to Google Places
   - Tracks enrichment status (`active`, `not_found`, `error`)
   - Match quality metrics (confidence, distance, method)
   - Timestamps for caching and retry logic

### Removed from `pois` Table

All Google-specific columns were removed from the `pois` table:
- `google_place_id`
- `google_rating`
- `google_user_ratings_total`
- `google_price_level`
- `google_formatted_address`
- `google_phone`
- `google_website`
- `google_opening_hours`
- `google_photos`
- `google_enriched_at`
- `google_enrichment_status`

### Updated `enriched_pois` View

The view now joins three tables:
- `pois` (OSM data)
- `osm_google_mappings` (enrichment status)
- `google_places` (Google data)

The "best" fields prefer Google data when available, falling back to OSM data.

## How Enrichment Works

1. **Trigger**: When `get_poi_details` is called for an unenriched POI
2. **Background Process**: Enrichment runs asynchronously with 2-minute timeout
3. **Steps**:
   - Find matching Google Place using nearby search
   - Fetch full place details from Google Places API
   - Store in `google_places` table
   - Create mapping in `osm_google_mappings`
4. **Caching**: Enriched data cached for 7 days (configurable)
5. **Retry Logic**:
   - `not_found`: Retry after 7 days
   - `error`: Can be manually retried
   - `active`: Refresh after cache expires

## Migration

To add the Google tables to an existing database:

```bash
node run-migration.js
```

Or manually:

```bash
psql travel < data/migration-add-google-tables.sql
```

## Configuration

Set the Google Places API key in `.env`:

```
GOOGLE_PLACES_API_KEY=your_key_here
```

Optional settings:
```
GOOGLE_PLACES_ENABLED=false  # Explicitly disable enrichment
GOOGLE_PLACES_CACHE_HOURS=168  # Cache duration (default: 7 days)
```

## Status Messages

When requesting POI details, the response includes enrichment status:

- **`complete`**: POI is enriched with Google data
- **`pending`**: Enrichment is running in background
  - Message includes start time and when to check back
- **`failed` (not_found)**: No matching Google Place found
- **`failed` (error)**: Enrichment encountered an error
- **`disabled`**: Google Places API not configured

## Timeout

Enrichment has a 2-minute timeout to prevent hanging. If enrichment times out, check:
1. Google Places API key is valid
2. API quotas haven't been exceeded
3. Network connectivity
4. Check server logs for specific errors

## Testing

Test enrichment:
```bash
node tests/test-enrichment.js
```

This will find a POI, trigger enrichment, and show the status.
