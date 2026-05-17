# OSM Import System

This document describes the OpenStreetMap POI import system for the Travel MCP Server.

## Overview

The import system downloads and processes OpenStreetMap PBF files from [Geofabrik](https://download.geofabrik.de/) and imports Points of Interest (hotels, restaurants, attractions, etc.) into the PostgreSQL database.

**Key Features:**
- **Keyword-based imports** - Just type `import france` instead of managing URLs
- **Auto-download** - Automatically downloads from Geofabrik and cleans up after
- **Scheduled refresh** - Configurable refresh intervals per region
- **Duplicate protection** - Only one import per region can run at a time
- **Graceful abort** - Running imports detect when they've been superseded

## Database Schema

### import_sources

Pre-configured regions with their Geofabrik URLs:

```sql
CREATE TABLE import_sources (
    id SERIAL PRIMARY KEY,
    keyword VARCHAR(100) UNIQUE NOT NULL,     -- 'france', 'thailand', 'europe'
    source_url VARCHAR(500) NOT NULL,         -- Full geofabrik URL
    display_name VARCHAR(200),                -- Human-friendly name
    min_pois INTEGER DEFAULT 100,             -- Fail if fewer POIs imported
    refresh_interval_days INTEGER DEFAULT 30, -- How often to refresh
    enabled BOOLEAN DEFAULT true,
    last_imported_at TIMESTAMP,
    last_import_id INTEGER REFERENCES import_log(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Pre-seeded regions (65 total):**
- Continents: europe, asia, africa, north-america, south-america, australia-oceania
- Countries: france, germany, italy, spain, uk, japan, thailand, etc.

### import_log

Tracks all import runs:

```sql
CREATE TABLE import_log (
    id SERIAL PRIMARY KEY,
    import_type VARCHAR(50),        -- 'osm_all', 'osm_hotel', etc.
    source_file VARCHAR(200),       -- 'france-latest.osm.pbf'
    source_url VARCHAR(500),
    source_date DATE,
    region_name VARCHAR(100),
    status VARCHAR(20),             -- 'running', 'completed', 'failed', 'aborted'
    records_imported INTEGER,
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

**Status values:**
- `running` - Import in progress
- `completed` - Successfully finished
- `failed` - Error occurred
- `aborted` - Superseded by another import for same region

## Scripts

### import-osm.js

Main import script supporting both keyword and file modes.

**Keyword mode (recommended):**
```bash
# Import from Geofabrik (downloads, imports, deletes file)
node scripts/import-osm.js france
node scripts/import-osm.js thailand all
node scripts/import-osm.js maldives hotel
```

**File mode:**
```bash
# Import from local PBF file
node scripts/import-osm.js /path/to/france-latest.osm.pbf all
```

**POI types:**
- `all` (default) - All supported POI types
- `hotel` - Hotels only
- `restaurant` - Restaurants only
- Any POI type from the mappings (hostel, cafe, museum, etc.)

### refresh-imports.js

Finds and refreshes stale imports based on `refresh_interval_days`.

```bash
# List all sources and their status
node scripts/refresh-imports.js --list

# Dry run - see what would be refreshed
node scripts/refresh-imports.js --dry-run

# Refresh stale imports (limit to 3 for Lambda timeout)
node scripts/refresh-imports.js --max=3

# Force refresh a specific region
node scripts/refresh-imports.js --region=thailand --force
```

**Options:**
| Option | Description |
|--------|-------------|
| `--list` | Show all sources with status (fresh/stale/never) |
| `--dry-run` | Preview what would be refreshed |
| `--max=N` | Limit regions per run (for Lambda timeouts) |
| `--region=NAME` | Target specific region |
| `--force` | Refresh even if not due yet |

## NPM Scripts

```bash
npm run db:import -- france           # Import a region
npm run db:refresh -- --list          # List import status
npm run db:refresh -- --dry-run       # Preview refresh
npm run db:refresh -- --max=3         # Refresh up to 3 regions
```

## Duplicate Import Protection

The system prevents multiple imports of the same region running simultaneously:

### When starting a new import:
1. **Abort existing** - Any running import for the same region is marked as `'aborted'`
2. **New import starts** - Creates new import_log entry with status `'running'`

### During import:
1. **Periodic check** - Every 30 seconds, checks if status is still `'running'`
2. **Graceful exit** - If status changed to `'aborted'`, stops and exits cleanly

### Stale job cleanup:
- `'running'` > 24 hours → `'failed'` (crashed/interrupted)
- `'aborted'` > 1 hour → `'failed'` (never responded to abort)

## Three-Pass Memory-Efficient Parsing

Large PBF files (e.g., France at 4GB) require memory-efficient parsing:

1. **Pass 1** - Find POI ways, collect needed node IDs
2. **Pass 2** - Collect coordinates only for needed nodes
3. **Pass 3** - Process POI nodes + resolve way centroids

This approach keeps memory usage under 2GB even for large files.

## POI Types Imported

| Category | Types |
|----------|-------|
| Accommodation | hotel, hostel, guest_house, motel |
| Food & Drink | restaurant, cafe, bar, pub, fast_food, food_court |
| Tourism | attraction, museum, viewpoint, artwork, gallery, theme_park, zoo |
| Historic | monument, memorial, castle, ruins, archaeological_site |
| Entertainment | cinema, theatre, nightclub |
| Shopping | shopping_mall, department_store, supermarket |
| Religious | place_of_worship |

## Running on AWS

### EC2 (for large imports)

```bash
# SSH to EC2
ssh ubuntu@<ec2-hostname>

# Set up environment
export DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/travel"

# Run import
node scripts/import-osm.js france all
```

### Local against RDS

```bash
# Use the no-verify connection string for self-signed certs
DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/travel?sslmode=no-verify" \
  node scripts/import-osm.js thailand
```

### Scheduled Refresh (Cron/Lambda)

```bash
# Daily cron job - refresh up to 3 stale regions
0 2 * * * DATABASE_URL="..." node /path/to/refresh-imports.js --max=3

# Or as Lambda (15 min timeout, process 2 regions max)
DATABASE_URL="..." node scripts/refresh-imports.js --max=2
```

## Database Migration

To set up the import_sources table:

```bash
psql $DATABASE_URL < data/migrations/001_import_sources.sql
```

This migration:
1. Renames `imports` → `import_log`
2. Creates `import_sources` table
3. Seeds 65 pre-configured regions from Geofabrik
4. Links existing successful imports to their sources

## Monitoring

### Check import status
```sql
SELECT region_name, status, records_imported,
       started_at, completed_at, error_message
FROM import_log
ORDER BY started_at DESC
LIMIT 10;
```

### Check refresh schedule
```sql
SELECT keyword, display_name,
       last_imported_at,
       refresh_interval_days,
       CASE
         WHEN last_imported_at IS NULL THEN 'never'
         WHEN last_imported_at < NOW() - (refresh_interval_days || ' days')::interval THEN 'stale'
         ELSE 'fresh'
       END as status
FROM import_sources
WHERE enabled = true
ORDER BY last_imported_at NULLS FIRST;
```

### Currently running imports
```sql
SELECT * FROM import_log WHERE status = 'running';
```

## Troubleshooting

### "relation import_sources does not exist"
Run the migration: `psql $DATABASE_URL < data/migrations/001_import_sources.sql`

### Import fails with memory error
Use EC2 with sufficient RAM (8GB+ for large countries like France, Germany, UK).

### SSL certificate errors
Use `?sslmode=no-verify` in the connection string for RDS from local.

### Import seems stuck
Check if another import aborted it:
```sql
SELECT * FROM import_log WHERE region_name = 'france' ORDER BY started_at DESC LIMIT 5;
```

### Downloaded file not deleted
Check if the process crashed. The finally block handles cleanup, but hard crashes may leave files behind.

## Database Optimization

After large imports, run the optimization script to reclaim space and update statistics:

### optimize-db.js

```bash
# Standard optimization (VACUUM ANALYZE)
node scripts/optimize-db.js

# Full vacuum (reclaims more space, locks tables)
node scripts/optimize-db.js --full

# Also rebuild indexes
node scripts/optimize-db.js --reindex

# Only optimize specific table
node scripts/optimize-db.js --table=osm_pois

# Preview without executing
node scripts/optimize-db.js --dry-run
```

**NPM Script:**
```bash
npm run db:optimize
npm run db:optimize -- --full
npm run db:optimize -- --reindex
```

### Integrated with Refresh

Run optimization automatically after refreshing imports:

```bash
node scripts/refresh-imports.js --optimize
```

### What it does:
1. **VACUUM ANALYZE** - Reclaims dead tuple space, updates table statistics
2. **REINDEX** (optional) - Rebuilds indexes for optimal query performance
3. Shows before/after statistics for each table

### Recommended Schedule

```bash
# Daily: refresh stale imports + optimize
0 2 * * * DATABASE_URL="..." node scripts/refresh-imports.js --max=3 --optimize

# Weekly: full optimization with reindex
0 3 * * 0 DATABASE_URL="..." node scripts/optimize-db.js --reindex
```

## Telemetry

All import scripts integrate with Sentry for monitoring:

### Metrics Tracked

| Metric | Description |
|--------|-------------|
| `osm.import.completed` | Counter: successful imports |
| `osm.import.failed` | Counter: failed imports |
| `osm.import.aborted` | Counter: aborted imports |
| `osm.import.records` | Distribution: POIs imported per region |
| `osm.import.duration` | Distribution: import duration (ms) |
| `osm.download.size` | Distribution: downloaded file size (bytes) |
| `osm.refresh.completed` | Counter: refresh runs |
| `osm.refresh.regions` | Distribution: regions per refresh |
| `db.optimize.completed` | Counter: optimization runs |
| `db.optimize.duration` | Distribution: optimization duration (ms) |

### Configuration

Set in `.env`:
```bash
SENTRY_DSN=https://xxx@sentry.io/xxx
TELEMETRY_ENABLED=true
TELEMETRY_SAMPLE_RATE=1.0
TELEMETRY_ENVIRONMENT=production
```

Telemetry is optional - scripts work without Sentry configured.
