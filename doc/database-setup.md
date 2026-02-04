# PostgreSQL Database Setup

This guide covers setting up PostgreSQL for the travel-mcp-server, whether locally or on any PostgreSQL instance.

## Prerequisites

- PostgreSQL 14+ with PostGIS extension available
- `psql` command-line tool

## Setup Steps

### 1. Connect as superuser

```bash
psql -U postgres
```

Or for a remote server:

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres"
```

### 2. Create the database and user

```sql
-- Create the application database
CREATE DATABASE travel;

-- Create the application user
CREATE USER traveluser WITH PASSWORD 'your-secure-password';

-- Make traveluser the owner of the database
ALTER DATABASE travel OWNER TO traveluser;
```

### 3. Connect to the travel database and set up extensions

```sql
-- Connect to the travel database
\c travel

-- Enable PostGIS extension (required for spatial queries)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pg_trgm extension (required for text search indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Grant schema permissions to traveluser
GRANT ALL ON SCHEMA public TO traveluser;
GRANT ALL ON ALL TABLES IN SCHEMA public TO traveluser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO traveluser;

-- Exit
\q
```

### 4. Set the DATABASE_URL environment variable

```bash
# Local PostgreSQL
export DATABASE_URL="postgresql://traveluser:your-secure-password@localhost:5432/travel"

# Remote PostgreSQL (with SSL)
export DATABASE_URL="postgresql://traveluser:your-secure-password@hostname:5432/travel?sslmode=require"

# Remote PostgreSQL (skip certificate verification)
export DATABASE_URL="postgresql://traveluser:your-secure-password@hostname:5432/travel?sslmode=no-verify"
```

### 5. Initialize the schema and import data

```bash
# Initialize database schema
node src/init.js

# Import GeoNames data (countries, cities)
node src/import-geonames.js

# Download and import OSM data
wget https://download.geofabrik.de/north-america/us-latest.osm.pbf -O data/us.osm.pbf
node src/import-osm.js data/us.osm.pbf
```

## Application Configuration (app_config table)

The server stores most configuration in the database `app_config` table instead of environment variables. This allows runtime configuration changes without redeploying.

### Configuration Values

| Key | Default | Description |
|-----|---------|-------------|
| `server_base_url` | (none) | Base URL for the server (e.g., `https://mcp.example.com`) |
| `google_places_api_key` | (none) | Google Places API key (encrypted) |
| `google_places_enabled` | `true` | Enable/disable Google Places enrichment |
| `google_places_cache_hours` | `168` | Hours to cache Google Places data (168 = 7 days) |
| `google_api_daily_limit` | `100` | Daily limit for Google Places API calls |
| `oauth_issuer` | (none) | OAuth provider URL for token introspection |
| `sentry_dsn` | (none) | Sentry DSN for error tracking (encrypted) |
| `telemetry_enabled` | `true` | Enable/disable telemetry |
| `telemetry_sample_rate` | `1.0` | Trace sample rate 0.0-1.0 |
| `telemetry_environment` | `development` | Environment name for telemetry |
| `sentry_send_dev` | `true` | Send telemetry events in development mode |

### Viewing Current Configuration

```sql
SELECT key, value, description FROM app_config ORDER BY key;
```

### Updating Configuration

```sql
-- Enable Google Places enrichment
UPDATE app_config SET value = 'true' WHERE key = 'google_places_enabled';

-- Set server base URL
INSERT INTO app_config (key, value, description)
VALUES ('server_base_url', 'https://mcp.example.com', 'Base URL for the server')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Increase daily API limit
UPDATE app_config SET value = '500' WHERE key = 'google_api_daily_limit';
```

### Environment Variables vs Database Config

**Database value takes precedence**, with env var as fallback:

| Setting | Database key | Env var fallback |
|---------|-------------|------------------|
| API Key | `google_places_api_key` | `GOOGLE_PLACES_API_KEY` |
| Enabled | `google_places_enabled` | `GOOGLE_PLACES_ENABLED` |
| Sentry DSN | `sentry_dsn` | `SENTRY_DSN` |

**Environment-only (no database fallback):**
- `DATABASE_URL` - Required to connect to the database

**Database-only (no env var fallback):**
- All other settings in the table above - use database for runtime configurability

## Troubleshooting

### "permission denied for schema public"

PostgreSQL 15+ restricts the public schema by default. Run these as superuser:

```sql
GRANT ALL ON SCHEMA public TO traveluser;
```

### "function postgis_version() does not exist"

PostGIS extension is not installed. Run as superuser:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### SSL certificate errors

Use `sslmode=no-verify` in your DATABASE_URL to skip certificate verification (still encrypted).

### "database does not exist"

Create the database first as superuser:

```sql
CREATE DATABASE travel OWNER traveluser;
```

## User Authentication (Optional)

The server supports optional token-based authentication to enable per-user features like bypassing API rate limits.

### Tables

The auth schema includes:
- `users` - User accounts (email, name, optional Google ID)
- `user_tokens` - API tokens for authentication
- `user_config` - Per-user settings (e.g., `google_places_limit`)
- `user_favorites` - Saved POIs (future feature)

### Creating a User and Token

```sql
-- Create a user
INSERT INTO users (email, name) VALUES ('user@example.com', 'User Name');

-- Generate a secure token (use openssl or similar)
-- openssl rand -hex 32

-- Create a token for the user
INSERT INTO user_tokens (user_id, token, name)
VALUES (1, 'your-64-char-hex-token', 'Claude Desktop');

-- Set unlimited Google Places access
INSERT INTO user_config (user_id, key, value)
VALUES (1, 'google_places_limit', 'unlimited');
```

### Using Authentication

Include the token in the Authorization header when connecting to the MCP server:

```
Authorization: Bearer <your-token>
```

Authentication is completely optional - anonymous access continues to work with default rate limits.
