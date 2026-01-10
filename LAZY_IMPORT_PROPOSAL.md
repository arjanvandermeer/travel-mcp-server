# Bulk Import System with Lazy Loading Proposal

## Overview

A system for tracking available **bulk data sources** (OSM PBF files, large API datasets) with geographic coverage polygons, and automatically importing them on-demand when users request POIs in uncovered regions.

**Terminology:**
- **Bulk Import**: Large-scale data imports from files (OSM PBF, Geofabrik extracts) or batch API calls
- **Lazy API Import**: Small on-demand enrichment (Google Places, individual POI lookups)
- **Lazy Loading**: Triggering bulk imports automatically when data is first needed

## Goals

1. **Pre-register bulk import sources** - Catalog all available OSM files and batch API endpoints with their coverage areas
2. **Lazy-load bulk imports on demand** - Automatically import large datasets when users search in uncovered regions
3. **Scheduled refresh** - Periodically update imported regions with fresh bulk data
4. **Coverage tracking** - Know exactly which geographic areas have bulk data and when it was last updated
5. **Efficient queries** - Quickly determine if a location has bulk coverage and which import source to use
6. **Separate from lazy API imports** - Bulk imports (OSM files) are distinct from lazy API imports (Google Places enrichment)

## Database Schema

### New Table: `bulk_import_sources`

Tracks available **bulk** data sources that CAN be imported (not yet imported, but cataloged). This is separate from lazy API imports like Google Places enrichment.

```sql
CREATE TABLE bulk_import_sources (
    id SERIAL PRIMARY KEY,

    -- Source identification
    source_name VARCHAR(200) NOT NULL,           -- 'thailand-latest', 'europe-germany', 'asia-bangkok'
    source_type VARCHAR(50) NOT NULL,            -- 'osm_pbf', 'osm_overpass_bulk', 'geofabrik_region'

    -- Coverage area (the most important part!)
    coverage_polygon geometry(Polygon, 4326),    -- The exact geographic area this source covers
    coverage_bbox_min_lat DOUBLE PRECISION,      -- Bounding box for quick filtering
    coverage_bbox_min_lon DOUBLE PRECISION,
    coverage_bbox_max_lat DOUBLE PRECISION,
    coverage_bbox_max_lon DOUBLE PRECISION,

    -- Source details
    download_url VARCHAR(1000),                  -- Where to get the data
    file_size_mb INTEGER,                        -- Estimated file size
    estimated_pois INTEGER,                      -- Estimated POI count (for progress bars)

    -- Metadata
    source_date DATE,                            -- Date this source was published
    priority INTEGER DEFAULT 0,                  -- Higher = prefer this source (for overlapping regions)
    enabled BOOLEAN DEFAULT true,                -- Can be disabled without deleting

    -- Status tracking
    import_status VARCHAR(20) DEFAULT 'available', -- 'available', 'importing', 'imported', 'failed', 'stale'
    last_imported_at TIMESTAMP,
    last_import_id INTEGER,                      -- FK to imports table
    refresh_interval_days INTEGER DEFAULT 30,    -- How often to refresh
    next_refresh_at TIMESTAMP,                   -- When to refresh next

    -- Additional info
    region_tags JSONB,                           -- Hierarchical tags: {continent: 'asia', country: 'TH', region: 'bangkok'}
    metadata JSONB,                              -- Any extra info

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spatial index for "does this lat/lon need bulk importing?"
CREATE INDEX idx_bulk_import_sources_coverage ON bulk_import_sources USING GIST(coverage_polygon);

-- Bounding box index for quick filtering before spatial query
CREATE INDEX idx_bulk_import_sources_bbox ON bulk_import_sources(
    coverage_bbox_min_lat, coverage_bbox_min_lon,
    coverage_bbox_max_lat, coverage_bbox_max_lon
);

-- Other useful indexes
CREATE INDEX idx_bulk_import_sources_status ON bulk_import_sources(import_status);
CREATE INDEX idx_bulk_import_sources_priority ON bulk_import_sources(priority DESC);
CREATE INDEX idx_bulk_import_sources_enabled ON bulk_import_sources(enabled);
CREATE INDEX idx_bulk_import_sources_refresh ON bulk_import_sources(next_refresh_at) WHERE enabled = true;
```

### Enhanced `imports` Table

Link actual imports back to their bulk source.

```sql
-- Add to existing imports table
ALTER TABLE imports ADD COLUMN bulk_import_source_id INTEGER REFERENCES bulk_import_sources(id);
ALTER TABLE imports ADD COLUMN import_category VARCHAR(50); -- 'bulk' or 'lazy_api' (Google Places, etc.)
ALTER TABLE imports ADD COLUMN trigger_reason VARCHAR(50); -- 'user_request', 'scheduled_refresh', 'manual'
ALTER TABLE imports ADD COLUMN trigger_location geometry(Point, 4326); -- The search that triggered it

CREATE INDEX idx_imports_bulk_source ON imports(bulk_import_source_id);
CREATE INDEX idx_imports_category ON imports(import_category);
```

### New Table: `bulk_coverage_cache`

Fast lookup for "does this point have bulk import coverage?" without expensive polygon queries.

```sql
CREATE TABLE bulk_coverage_cache (
    id SERIAL PRIMARY KEY,

    -- Geographic cell (H3 hexagon or S2 cell)
    cell_id VARCHAR(50) NOT NULL UNIQUE,        -- H3 resolution 6 (~36km diameter) or S2 level 10
    cell_center geometry(Point, 4326) NOT NULL,

    -- Bulk coverage status
    has_bulk_import BOOLEAN DEFAULT false,
    bulk_import_source_ids INTEGER[],           -- Array of bulk source IDs covering this cell
    last_bulk_import_at TIMESTAMP,

    -- Quick stats
    poi_count INTEGER DEFAULT 0,
    last_poi_import_at TIMESTAMP
);

CREATE INDEX idx_bulk_coverage_cache_cell ON bulk_coverage_cache(cell_id);
CREATE INDEX idx_bulk_coverage_cache_covered ON bulk_coverage_cache(has_bulk_import);
CREATE INDEX idx_bulk_coverage_cache_center ON bulk_coverage_cache USING GIST(cell_center);
```

## Architecture Flow

### 1. Bootstrapping: Catalog Available Bulk Sources

```javascript
// Script: src/catalog-bulk-import-sources.js
// Run once to populate bulk_import_sources table

const sources = [
  {
    source_name: 'thailand-latest',
    source_type: 'osm_pbf',
    download_url: 'https://download.geofabrik.de/asia/thailand-latest.osm.pbf',
    coverage_polygon: thailandPolygon,  // From Geofabrik's coverage JSON
    priority: 1,
    region_tags: { continent: 'asia', country: 'TH' }
  },
  {
    source_name: 'bangkok-overpass',
    source_type: 'osm_overpass',
    coverage_polygon: bangkokPolygon,   // 25km radius from city center
    priority: 2,  // Higher priority than country-wide (more up-to-date)
    region_tags: { continent: 'asia', country: 'TH', city: 'bangkok' }
  },
  // ... more sources
];

await db.catalogBulkImportSources(sources);
```

**Bulk source catalog ideas:**
- Geofabrik PBF regions (all continents, countries, states) - static files
- Major city bounding boxes (auto-generated from geonames_cities) - Overpass batch queries
- Custom regions (Alps, Mediterranean, etc.) - PBF extracts or Overpass
- Note: Google Places is NOT a bulk source - it's handled separately as lazy API enrichment

### 2. Query Flow: User Searches for Hotels

```javascript
// User: "Find hotels in Chiang Mai"

// Step 1: Database checks if Chiang Mai has bulk coverage
const coverage = await db.checkBulkCoverage({
  cityName: 'Chiang Mai',
  countryCode: 'TH'
});

if (coverage.status === 'not_covered') {
  // Step 2: Find which bulk import source covers this area
  const source = await db.findBestBulkImportSource({
    latitude: coverage.city.latitude,
    longitude: coverage.city.longitude
  });

  if (source) {
    // Step 3: Trigger bulk import
    const importId = await db.triggerBulkImport(source.id, {
      trigger_reason: 'user_request',
      trigger_location: coverage.city.location
    });

    // Step 4: Return "fetching" status
    return {
      status: 'fetching',
      message: `Importing bulk POI data for ${source.source_name}. This will take 30-120 seconds.`,
      import_id: importId,
      estimated_wait_seconds: estimateBulkImportTime(source.file_size_mb)
    };
  } else {
    return {
      status: 'no_bulk_source',
      message: 'No bulk data source available for this region. Please add a custom import source.'
    };
  }
}

// Step 5: If covered, proceed with normal search
// Note: This will also trigger lazy API imports (Google Places) for individual POIs
const pois = await db.searchPOIs(...);
return { status: 'success', pois };

```

### 3. Bulk Import Execution: Background Worker

```javascript
// src/bulk-import-worker.js
// Runs bulk imports in background (could be separate process or in-process with promise queue)

class BulkImportWorker {
  async executeBulkImport(bulkImportSourceId, importId) {
    const source = await db.getBulkImportSource(bulkImportSourceId);

    // Update source status
    await db.updateBulkImportSource(source.id, {
      import_status: 'importing',
      last_import_id: importId
    });

    try {
      // Execute bulk import based on source type
      if (source.source_type === 'osm_pbf') {
        await this.importPBF(source, importId);
      } else if (source.source_type === 'osm_overpass_bulk') {
        await this.importOverpassBulk(source, importId);
      }

      // Mark as complete
      await db.updateBulkImportSource(source.id, {
        import_status: 'imported',
        last_imported_at: new Date(),
        next_refresh_at: new Date(Date.now() + source.refresh_interval_days * 86400000)
      });

      await db.completeImport(importId, recordCount);

      // Update bulk coverage cache
      await db.updateBulkCoverageCache(source.coverage_polygon);

    } catch (error) {
      await db.updateBulkImportSource(source.id, { import_status: 'failed' });
      await db.failImport(importId, error.message);
    }
  }
}

// Note: Separate from lazy API imports
// Google Places enrichment happens independently via GooglePlacesClient
```

### 4. Scheduled Refresh: Cron Job

```javascript
// src/scheduled-bulk-refresh.js
// Run daily via cron or systemd timer

async function checkForStaleBulkImports() {
  const staleSources = await db.query(`
    SELECT id, source_name
    FROM bulk_import_sources
    WHERE enabled = true
      AND import_status = 'imported'
      AND next_refresh_at < NOW()
    ORDER BY priority DESC
    LIMIT 5  -- Don't overwhelm system
  `);

  for (const source of staleSources) {
    const importId = await db.startImport('pois', {
      bulk_import_source_id: source.id,
      import_category: 'bulk',
      trigger_reason: 'scheduled_refresh'
    });

    await bulkImportWorker.executeBulkImport(source.id, importId);
  }
}

// Note: This is separate from Google Places refresh
// Google Places data has its own refresh cycle (google_enriched_at + 7 days)
```

## Key Database Methods

### `checkBulkCoverage(location)`

```javascript
async checkBulkCoverage({ cityName, countryCode, latitude, longitude }) {
  // Quick cell-based check first
  const cellId = getCellId(latitude, longitude);
  const cached = await this.query(`
    SELECT has_bulk_import, bulk_import_source_ids
    FROM bulk_coverage_cache
    WHERE cell_id = $1
  `, [cellId]);

  if (cached && cached.has_bulk_import) {
    return { status: 'bulk_covered', cache: 'hit' };
  }

  // Fallback to polygon query
  const covered = await this.query(`
    SELECT id, source_name
    FROM bulk_import_sources
    WHERE import_status = 'imported'
      AND enabled = true
      AND ST_Contains(coverage_polygon, ST_SetSRID(ST_MakePoint($1, $2), 4326))
    ORDER BY priority DESC
    LIMIT 1
  `, [longitude, latitude]);

  return covered ?
    { status: 'bulk_covered', source: covered } :
    { status: 'not_bulk_covered' };
}
```

### `findBestBulkImportSource(location)`

```javascript
async findBestBulkImportSource({ latitude, longitude }) {
  // Find smallest available bulk source that covers this point
  // (smallest = most specific, like city rather than country)
  const source = await this.query(`
    SELECT
      id, source_name, source_type, download_url,
      ST_Area(coverage_polygon) as coverage_area
    FROM bulk_import_sources
    WHERE enabled = true
      AND import_status IN ('available', 'stale')
      -- Quick bbox filter first
      AND coverage_bbox_min_lat <= $1
      AND coverage_bbox_max_lat >= $1
      AND coverage_bbox_min_lon <= $2
      AND coverage_bbox_max_lon >= $2
      -- Then precise polygon check
      AND ST_Contains(coverage_polygon, ST_SetSRID(ST_MakePoint($2, $1), 4326))
    ORDER BY priority DESC, coverage_area ASC
    LIMIT 1
  `, [latitude, longitude]);

  return source;
}
```

### `triggerBulkImport(sourceId, options)`

```javascript
async triggerBulkImport(sourceId, { trigger_reason, trigger_location }) {
  // Check if already importing
  const source = await this.getBulkImportSource(sourceId);
  if (source.import_status === 'importing') {
    return { status: 'already_importing', import_id: source.last_import_id };
  }

  // Start new bulk import
  const importId = await this.startImport('pois', {
    bulk_import_source_id: sourceId,
    import_category: 'bulk',
    trigger_reason,
    trigger_location,
    source_file: source.source_name,
    source_url: source.download_url,
    region_name: source.source_name
  });

  // Queue for background execution
  bulkImportWorker.queueBulkImport(sourceId, importId);

  return { status: 'queued', import_id: importId };
}
```

## Bulk Coverage Cache Strategy

Use **H3 hexagons** (Uber's spatial indexing system) or **S2 cells** (Google's) for fast bulk coverage checks:

- **Resolution 6 H3** = ~36km diameter hexagons
- Store which hexagons have bulk import data
- O(1) lookup: "Does lat/lon have bulk coverage?"
- Avoids expensive polygon queries for every search
- Separate from lazy API imports (Google Places enrichment happens per-POI)

```javascript
import h3 from 'h3-js';

function getCellId(lat, lon, resolution = 6) {
  return h3.geoToH3(lat, lon, resolution);
}

async function updateBulkCoverageCache(polygon) {
  // Get all H3 cells within polygon
  const cells = h3.polyfill(polygon, 6);

  // Update bulk coverage cache
  for (const cellId of cells) {
    const center = h3.h3ToGeo(cellId);
    await db.query(`
      INSERT INTO bulk_coverage_cache (cell_id, cell_center, has_bulk_import)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), true)
      ON CONFLICT (cell_id) DO UPDATE SET
        has_bulk_import = true,
        last_bulk_import_at = NOW()
    `, [cellId, center[1], center[0]]);
  }
}
```

## Bulk Import Source Catalog Bootstrapping

### Script: `npm run catalog:geofabrik`

Catalogs Geofabrik's PBF extracts as bulk import sources.

```javascript
// Fetch Geofabrik's region index
const response = await fetch('https://download.geofabrik.de/index-v1.json');
const regions = await response.json();

for (const region of regions.features) {
  const polygon = region.geometry; // GeoJSON polygon
  const bbox = calculateBbox(polygon);

  await db.insertImportSource({
    source_name: region.properties.id,
    source_type: 'osm_pbf',
    coverage_polygon: polygon,
    coverage_bbox_min_lat: bbox.minLat,
    coverage_bbox_min_lon: bbox.minLon,
    coverage_bbox_max_lat: bbox.maxLat,
    coverage_bbox_max_lon: bbox.maxLon,
    download_url: region.properties.urls['pbf'],
    region_tags: {
      continent: region.properties.parent,
      name: region.properties.name
    },
    priority: calculatePriority(region), // Country=1, State=2, City=3
  });
}
```

### Script: `npm run catalog:cities`

Catalogs major cities as bulk import sources (via Overpass batch queries).

```javascript
// Generate import sources for top 1000 cities
const cities = await db.query(`
  SELECT geoname_id, name, country_code, latitude, longitude, population
  FROM geonames_cities
  WHERE population > 100000
  ORDER BY population DESC
  LIMIT 1000
`);

for (const city of cities) {
  const radiusKm = getRadiusForPopulation(city.population);
  const polygon = createCirclePolygon(city.latitude, city.longitude, radiusKm);
  const bbox = calculateBbox(polygon);

  await db.insertBulkImportSource({
    source_name: `${city.country_code}-${city.name.toLowerCase().replace(/\s+/g, '-')}`,
    source_type: 'osm_overpass_bulk',
    coverage_polygon: polygon,
    coverage_bbox_min_lat: bbox.minLat,
    coverage_bbox_min_lon: bbox.minLon,
    coverage_bbox_max_lat: bbox.maxLat,
    coverage_bbox_max_lon: bbox.maxLon,
    download_url: null, // Overpass doesn't use URLs
    priority: 3, // Cities have highest priority (most up-to-date)
    region_tags: {
      continent: getContinent(city.country_code),
      country: city.country_code,
      city: city.name,
      geoname_id: city.geoname_id
    },
    estimated_pois: estimatePOIsForCity(city.population)
  });
}
```

## MCP Tool Enhancement

### New tool: `get_bulk_coverage_status`

```javascript
{
  name: 'get_bulk_coverage_status',
  description: 'Check if a location has bulk POI data coverage and when it was last updated. Note: This checks for bulk imports (OSM files), not lazy API imports (Google Places enrichment).',
  inputSchema: {
    type: 'object',
    properties: {
      city_name: { type: 'string' },
      country_code: { type: 'string' },
      latitude: { type: 'number' },
      longitude: { type: 'number' }
    }
  }
}

// Returns:
{
  bulk_status: 'bulk_covered' | 'not_bulk_covered' | 'stale',
  bulk_sources: [
    {
      source_name: 'thailand-latest',
      source_type: 'osm_pbf',
      last_imported_at: '2026-01-08T12:00:00Z',
      days_since_import: 2,
      next_refresh_at: '2026-02-08T12:00:00Z',
      poi_count: 45231
    }
  ],
  can_trigger_bulk_import: true,
  estimated_bulk_import_time_seconds: 90,

  // Note: Separate from lazy API imports
  note: 'Google Places enrichment happens independently per-POI'
}
```

## Benefits

### 1. **Automatic Bulk Coverage**
- Users never see "no bulk data" errors for supported regions
- System automatically fills gaps when discovered
- Separate from lazy API imports (Google Places)

### 2. **Efficient Storage**
- Only import bulk data that's actually used
- Start with popular cities, expand as needed
- Lazy API imports happen independently

### 3. **Always Fresh**
- Scheduled refresh keeps bulk data current
- Configurable refresh intervals per region
- Google Places has its own refresh cycle (7 days default)

### 4. **Smart Prioritization**
- Multiple overlapping bulk sources? Use the best one
- City-level data preferred over country-level
- Clear separation: bulk imports vs. lazy API imports

### 5. **Transparent to Users**
- First search: "Importing bulk data, wait 60 seconds"
- Subsequent searches: Instant results
- Google Places enrichment happens silently in background
- Users understand the tradeoff

### 6. **Cost Control**
- Track bulk import sizes and times
- Batch bulk imports during off-peak hours
- Disable expensive bulk sources if needed
- Google Places costs tracked separately

### 7. **Clear Architecture**
- **Bulk imports**: Large OSM files, batch API calls (this system)
- **Lazy API imports**: Per-POI enrichment (Google Places, existing system)
- Two complementary systems working together

## Implementation Phases

### Phase 1: Schema & Cataloging (Week 1)
- [ ] Create `bulk_import_sources` table
- [ ] Create `bulk_coverage_cache` table
- [ ] Update `imports` table with `bulk_import_source_id` FK and `import_category`
- [ ] Write Geofabrik catalog script (`npm run catalog:geofabrik`)
- [ ] Write city-based catalog script (`npm run catalog:cities`)
- [ ] Populate with top 100 cities

### Phase 2: Coverage Checking (Week 2)
- [ ] Implement `checkBulkCoverage()`
- [ ] Implement `findBestBulkImportSource()`
- [ ] Add H3 library for cell-based caching
- [ ] Write bulk coverage cache update logic
- [ ] Add `get_bulk_coverage_status` MCP tool

### Phase 3: Bulk Import Triggering (Week 3)
- [ ] Implement `triggerBulkImport()`
- [ ] Create `BulkImportWorker` class
- [ ] Integrate with existing `import-osm.js`
- [ ] Add bulk import queue management
- [ ] Update `unifiedSearchPOIs()` to check bulk coverage and trigger imports

### Phase 4: Scheduled Refresh (Week 4)
- [ ] Create `scheduled-bulk-refresh.js` script
- [ ] Add cron job / systemd timer
- [ ] Implement stale bulk import detection logic
- [ ] Add refresh prioritization
- [ ] Add monitoring/alerting

### Phase 5: Optimization (Week 5+)
- [ ] Performance tuning for polygon queries
- [ ] Bulk coverage cache warming
- [ ] Bulk import deduplication
- [ ] Progress tracking UI/feedback
- [ ] Admin tools for bulk source management

**Note**: Google Places lazy API imports already work and don't need changes.

## Example User Experience

```
User: "Find hotels in Reykjavik"

System (first time - no bulk data):
  → Checking bulk coverage for Reykjavik, Iceland...
  → No bulk data found for this region
  → Found bulk import source: iceland-latest.osm.pbf (42MB, ~1200 POIs)
  → Starting bulk import... (estimated 45 seconds)
  → [Progress: 30%... 60%... 90%...]
  → Bulk import complete! Found 28 hotels in Reykjavik
  → [Returns hotel list]
  → [Background: Google Places enrichment starting for top 10 hotels...]

User (10 minutes later): "Find restaurants in Reykjavik"

System (bulk data cached):
  → Bulk data already available for Reykjavik
  → Found 145 restaurants
  → [Returns restaurant list instantly]
  → [Background: Google Places enrichment for top 10 restaurants...]

User (2 hours later): "Show me details for Hotel Borg"

System (lazy API enrichment):
  → Hotel found in bulk data
  → Checking Google Places enrichment... already enriched (2 hours ago)
  → [Returns: OSM data + Google rating 4.5★, 1200 reviews, photos, hours, etc.]

User (35 days later): "Find hotels in Reykjavik again"

System (auto-refresh bulk data):
  → Bulk data is 35 days old (stale)
  → Returning cached bulk results while refreshing in background...
  → [Returns hotel list immediately with Google Places data]
  → [Background: Bulk refresh import started...]
  → [Background: Google Places re-enrichment for stale POIs...]
```

## Questions to Answer

1. **Storage Strategy**: Do we keep old bulk data during refresh or replace it?
   - **Recommendation**: Keep old data, mark with import_id, clean up after successful refresh

2. **Bulk Import Queue**: FIFO or priority-based?
   - **Recommendation**: Priority (user requests > scheduled refresh)

3. **Failed Bulk Imports**: Retry logic?
   - **Recommendation**: Exponential backoff, max 3 retries, alert after failure

4. **Coverage Gaps**: What if no bulk source available?
   - **Recommendation**: Allow users to request custom regions, queue for admin approval

5. **Overlapping Bulk Sources**: How to handle?
   - **Recommendation**: Priority-based (city > state > country), keep all data, mark with bulk_import_source_id

6. **Interaction with Lazy API Imports**: How do bulk and lazy systems work together?
   - **Recommendation**:
     - Bulk imports populate base POI data (OSM)
     - Lazy API imports (Google Places) enrich existing POIs
     - Two independent refresh cycles
     - `imports` table tracks both via `import_category` field

## Conclusion

This **bulk import system** provides:
- ✅ Automatic bulk data coverage expansion
- ✅ Always-fresh bulk data via scheduled refresh
- ✅ Transparent user experience (with progress feedback)
- ✅ Efficient resource usage (only import what's needed)
- ✅ Geographic coverage tracking (H3 hexagons)
- ✅ Flexible bulk source management
- ✅ Clear separation from lazy API imports (Google Places)

### The Key Insight

**Catalog ALL possible bulk imports upfront, execute them lazily on-demand.**

### Two-Tier Import Architecture

1. **Bulk Imports** (this proposal):
   - Large OSM PBF files (countries, regions)
   - Batch Overpass API queries (cities)
   - Pre-cataloged with coverage polygons
   - Triggered when user searches uncovered region
   - Scheduled refresh every 30 days

2. **Lazy API Imports** (existing Google Places):
   - Per-POI enrichment
   - Triggered automatically after bulk search results
   - Background fire-and-forget
   - Cached for 7 days
   - Independent refresh cycle

Both systems work together seamlessly:
- Bulk imports provide base POI data
- Lazy API imports add enrichment
- Users get comprehensive results combining both data sources
