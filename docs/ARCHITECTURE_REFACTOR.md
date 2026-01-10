# Architecture Refactor: Separate OSM and Google Places Data

## Overview

We've refactored the database architecture to properly separate OpenStreetMap (OSM) data from Google Places enrichment data. This provides:

✅ **Clear separation of concerns** - OSM and Google are distinct data sources
✅ **Independent lifecycles** - Refresh OSM and Google data separately
✅ **Better data integrity** - One Google Place can match multiple OSM POIs
✅ **Cleaner schema** - Each table has a single responsibility
✅ **Easier maintenance** - Update one source without affecting the other

## New Database Structure

### Table: `osm_pois`
**Purpose**: Store OpenStreetMap POI data (hotels, restaurants, attractions, etc.)

**Key fields**:
- `osm_id` (PRIMARY KEY) - OpenStreetMap identifier
- `poi_type` - hotel, restaurant, cafe, museum, etc.
- `name`, `name_en`, `name_local`
- `location` (PostGIS Geography)
- `latitude`, `longitude`
- Address fields (street, city, country, etc.)
- Contact (phone, email, website from OSM)
- `osm_tags` (JSONB) - All OSM tags
- Hotel-specific: `stars`, `rooms`, `beds`

### Table: `google_places`
**Purpose**: Store Google Places API enrichment data

**Key fields**:
- `google_place_id` (PRIMARY KEY) - Google's place identifier
- `name`, `display_name`
- `location`, `latitude`, `longitude` (Google's coordinates)
- `types`, `primary_type` - Google's categorization
- Contact: `national_phone`, `website_uri`, `formatted_address`
- Ratings: `rating`, `user_rating_count`, `price_level`
- Business: `business_status`, `editorial_summary`
- `opening_hours`, `photos` (JSONB)
- Service options: `service_options` (JSONB) - delivery, dine-in, takeout, etc.
- Accessibility: `accessibility`, `amenities` (JSONB)
- `enriched_at`, `cache_expires_at`

### Table: `osm_google_mappings`
**Purpose**: Links OSM POIs to Google Places

**Key fields**:
- `osm_id` + `google_place_id` (COMPOSITE PRIMARY KEY)
- `match_confidence` (0.00 to 1.00)
- `match_method` - 'nearby_search', 'text_search', 'manual'
- `match_distance_meters`
- `mapping_status` - 'active', 'not_found', 'error'
- `mapped_at`, `verified_at`, `verified_by`

### View: `enriched_pois`
**Purpose**: Combined view of OSM + Google data for easy querying

Joins `osm_pois` ← `osm_google_mappings` → `google_places`

Returns both OSM and Google fields, plus "best_*" fields that prefer Google when available.

### View: `pois_needing_enrichment`
**Purpose**: Find OSM POIs that need Google enrichment

Returns POIs that:
- Have no mapping yet
- Were marked 'not_found' but it's been 7+ days (worth retrying)

## Migration Status

### ✅ Completed

1. **Database migration** - `migrations/separate-osm-google-tables.sql`
   - Created `osm_pois`, `google_places`, `osm_google_mappings` tables
   - Created `enriched_pois` and `pois_needing_enrichment` views
   - Dropped old `pois` table (data was cleared)

### 🔄 In Progress / TODO

2. **Update `src/database.js`**
   - Change all `pois` table references to `osm_pois`
   - Update search methods to query `enriched_pois` view
   - Update enrichment logic to:
     - Store Google data in `google_places` table
     - Create mapping in `osm_google_mappings` table
   - Add methods for managing mappings

3. **Update `src/import-osm.js`**
   - Change INSERT statements to use `osm_pois` table
   - Remove all Google Places columns from import
   - Update field mappings

4. **Update Google Places enrichment**
   - New method: `enrichOSMPOI(osmId)` - Main entry point
   - New method: `upsertGooglePlace(placeData)` - Store/update Google data
   - New method: `createMapping(osmId, googlePlaceId, metadata)` - Link OSM to Google
   - Handle cache expiration properly

5. **Update MCP tools** (`src/tools-config.js`)
   - Change queries to use `enriched_pois` view
   - Update result formatting to handle new structure

6. **Re-import OSM data**
   - Run `npm run import:osm` with existing PBF file
   - Verify data loads into `osm_pois` table

7. **Test everything**
   - Search queries work
   - Enrichment creates proper mappings
   - Views return correct data
   - MCP tools function correctly

## Benefits of New Architecture

### For OSM Data
- ✅ Can refresh OSM data independently
- ✅ OSM tags preserved in JSONB without cluttering schema
- ✅ Clear what comes from OSM vs. Google

### For Google Places Data
- ✅ One Google Place entry even if matched to multiple OSM POIs
- ✅ Cache expiration handled properly
- ✅ Can store additional Google fields without affecting OSM
- ✅ Can add new enrichment sources easily (Yelp, TripAdvisor, etc.)

### For Querying
- ✅ `enriched_pois` view makes queries simple
- ✅ Can query OSM-only or Google-only data separately
- ✅ Match confidence helps filter low-quality matches
- ✅ Easy to find POIs needing enrichment

## Code Migration Guide

### Before (old structure)
```javascript
// Search POIs
const result = await db.pool.query(`
  SELECT osm_id, name, google_rating
  FROM pois
  WHERE poi_type = $1
`, [poiType]);
```

### After (new structure)
```javascript
// Search enriched POIs
const result = await db.pool.query(`
  SELECT osm_id, osm_name, google_rating, best_name
  FROM enriched_pois
  WHERE poi_type = $1
`, [poiType]);
```

### Enrichment - Before
```javascript
// Old: Update pois table with Google data
await db.pool.query(`
  UPDATE pois
  SET google_rating = $2, google_place_id = $3
  WHERE osm_id = $1
`, [osmId, rating, placeId]);
```

### Enrichment - After
```javascript
// New: Insert into google_places, create mapping
await db.pool.query(`
  INSERT INTO google_places (google_place_id, name, rating, ...)
  VALUES ($1, $2, $3, ...)
  ON CONFLICT (google_place_id) DO UPDATE SET ...
`, [placeId, name, rating, ...]);

await db.pool.query(`
  INSERT INTO osm_google_mappings (osm_id, google_place_id, match_confidence, ...)
  VALUES ($1, $2, $3, ...)
  ON CONFLICT (osm_id, google_place_id) DO UPDATE SET ...
`, [osmId, placeId, confidence, ...]);
```

## Files to Update

- [x] `migrations/separate-osm-google-tables.sql` - Migration script (DONE)
- [ ] `schema.sql` - Update for new installations
- [ ] `src/database.js` - Main database methods
- [ ] `src/import-osm.js` - OSM import script
- [ ] `src/tools-config.js` - MCP tools
- [ ] Test scripts - All test scripts need updating

## Testing Checklist

- [ ] OSM import works with new `osm_pois` table
- [ ] Search returns results from `enriched_pois` view
- [ ] Enrichment creates entries in `google_places` table
- [ ] Mappings created in `osm_google_mappings` table
- [ ] Cache expiration works properly
- [ ] Duplicate Google Places handled correctly
- [ ] Not_found status tracked in mappings
- [ ] Manual verification workflow works

## Next Steps

1. **Update code** (database.js, import-osm.js, tools-config.js)
2. **Re-import OSM data** from existing PBF file
3. **Test search** - verify enriched_pois view works
4. **Test enrichment** - verify new table structure works
5. **Update documentation** - README, API docs, etc.

## Rollback Plan

If issues occur:

```bash
# Restore old schema
psql "postgresql://..." -f schema.sql.backup

# Re-import data if needed
npm run import:osm
```

The old schema is backed up at `schema.sql.backup`.
