# Google Places API Configuration

⚠️ **IMPORTANT: Never commit API keys to git!** API keys are stored in:
- `.env` file (already gitignored)
- Database `config` table (not in git)

Both are safe from being committed. The `.env.example` file contains only placeholder values.

---

The Google Places API integration can be configured in two ways:

## 1. Database Configuration (Recommended for Claude Desktop)

Configuration is stored in the `config` table and persists across restarts. This is the recommended approach when using Claude Desktop, as it sometimes has issues reading environment variables.

### View current configuration

```bash
node scripts/manage-config.js list
```

### Set your API key

```bash
node scripts/manage-config.js set google_places_api_key YOUR_API_KEY_HERE
```

### Enable/disable Google Places enrichment

```bash
node scripts/manage-config.js set google_places_enabled true
# or
node scripts/manage-config.js set google_places_enabled false
```

### Configure cache duration

```bash
# Cache for 7 days (default)
node scripts/manage-config.js set google_places_cache_hours 168

# Cache for 2 weeks
node scripts/manage-config.js set google_places_cache_hours 336

# Cache for 1 day
node scripts/manage-config.js set google_places_cache_hours 24
```

### Get a specific config value

```bash
node scripts/manage-config.js get google_places_api_key
```

## 2. Environment Variables (Alternative)

You can also use environment variables in `.env`:

```bash
# Google Places API Configuration
GOOGLE_PLACES_API_KEY=YOUR_API_KEY_HERE
GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_CACHE_HOURS=168  # Cache enrichment data for 7 days (168 hours)
```

**Note**: Database configuration takes precedence over environment variables. If a value exists in the database, it will be used instead of the environment variable.

## Priority Order

The system checks for configuration in this order:

1. **Database config table** (highest priority)
2. **Environment variables** from `.env`
3. **Default values** (if nothing else is set)

## Getting a Google Places API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the "Places API (New)"
4. Create credentials (API Key)
5. Restrict the API key to "Places API (New)" only (recommended)
6. Set your API key using one of the methods above

## Troubleshooting

### Check if Google Places is initialized

```bash
node test-db-config.js
```

This will show:
- Whether the API key is configured
- Whether Google Places is enabled
- Whether the client can make API calls

### Claude Desktop not finding API key

If Claude Desktop can't access your API key from environment variables:

1. **Use database configuration instead** (recommended):
   ```bash
   node scripts/manage-config.js set google_places_api_key YOUR_API_KEY_HERE
   ```

2. Restart Claude Desktop after configuration changes

3. Check the MCP server logs for initialization messages

### Clear "not_found" enrichment statuses

If you previously tried enrichment with a broken API key, clear the cache:

```bash
psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
  -c "UPDATE pois SET google_enrichment_status = NULL, google_enriched_at = NULL WHERE google_enrichment_status = 'not_found'"
```

## How It Works

1. When `TravelDatabase` is initialized, it:
   - Reads configuration from the database
   - Falls back to environment variables if database config is missing
   - Initializes the `GooglePlacesClient` with the API key

2. When POI searches return results:
   - Top results automatically trigger background enrichment
   - Results are cached for the configured duration (default 7 days)
   - "not_found" results are cached for 24 hours to avoid API waste

3. Configuration is checked on startup:
   - Database config is read during initialization
   - Changes require restarting the MCP server
   - Use `manage-config.js` to update configuration

## Examples

### Disable Google Places temporarily

```bash
node scripts/manage-config.js set google_places_enabled false
```

Then restart the MCP server.

### Change cache duration to 1 day

```bash
node scripts/manage-config.js set google_places_cache_hours 24
```

### Re-enable after disabling

```bash
node scripts/manage-config.js set google_places_enabled true
```
