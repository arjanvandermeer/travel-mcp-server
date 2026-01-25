# Google Places API Integration

This MCP server supports automatic enrichment of POI data (hotels, restaurants, cafes, etc.) using the Google Places API.

## Features

- **Lazy Loading**: Google Places data is automatically fetched in the background when POIs are searched
- **Smart Caching**: Enrichment data is cached for 7 days (configurable) to minimize API costs
- **Automatic Matching**: POIs are automatically matched to Google Places using name + location
- **Rich Data**: Get ratings, review counts, photos, verified phone numbers, websites, and opening hours

## Setup

### 1. Get a Google Places API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Places API (New)**
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > API Key**
6. (Recommended) Restrict the API key to "Places API (New)" only

### 2. Configure API Key

**Option A: Database Configuration (Recommended for Claude Desktop)**

Configuration stored in the database persists across restarts and works better with Claude Desktop:

```bash
# Set your API key
node scripts/manage-config.js set google_places_api_key YOUR_API_KEY_HERE

# Enable Google Places enrichment
node scripts/manage-config.js set google_places_enabled true

# Set cache duration (default: 168 hours = 7 days)
node scripts/manage-config.js set google_places_cache_hours 168

# View current configuration
node scripts/manage-config.js list
```

**Option B: Environment Variables**

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://traveluser:travelpass@localhost:5432/travel
GOOGLE_PLACES_API_KEY=your_api_key_here
GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_CACHE_HOURS=168
```

**Priority Order**: Database config > Environment variables > Defaults

### 3. Restart the MCP Server

The MCP server needs to be restarted to pick up configuration changes.

## How It Works

### Automatic Background Enrichment

When you search for hotels or restaurants using MCP tools (`search_hotels`, `search_restaurants`, `search_pois`):

1. OSM data is returned immediately (fast response)
2. Background enrichment triggers for top 10 results
3. Google Places data is fetched and stored
4. Subsequent searches return enriched data instantly (from cache)

### Manual Detail Fetching

Use `get_poi_details` to get full details for a specific POI:

```json
{ "osm_id": 123456789 }
```

If not already enriched, this triggers enrichment and returns a status:

- `pending`: Enrichment started, check back in ~1 minute
- `complete`: Fully enriched with Google data
- `failed`: No matching Google Place found
- `disabled`: Google Places not configured

### Data Provided

When a POI is enriched, these fields are available:

| Field | Description |
|-------|-------------|
| `google_place_id` | Unique Google Places identifier |
| `google_name` | Verified business name |
| `google_rating` | Rating (0.0 - 5.0) |
| `google_reviews` | Number of user reviews |
| `google_price_level` | Price level (free/inexpensive/moderate/expensive) |
| `google_address` | Verified formatted address |
| `google_phone` | Verified phone number |
| `google_website` | Verified website URL |
| `opening_hours` | Detailed opening hours |
| `photos` | Photo references (up to 10) |
| `business_status` | OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY |

## Cost Management

### Google Places API Pricing

- **Nearby Search**: $32 per 1,000 requests
- **Text Search**: $32 per 1,000 requests
- **Place Details**: $17 per 1,000 requests
- **Cost per POI**: ~$0.05 (1-2 searches + 1 details)

### Cost Optimization

1. **Caching**: Data cached for 7 days (configurable)
2. **Lazy Loading**: Only enriches POIs that are actually searched
3. **Batch Limiting**: Only enriches top 10 results per search
4. **Retry Prevention**: Failed lookups cached for 24 hours

### Free Tier

Google provides **$200 free credit per month**, covering:
- ~4,000 POI enrichments per month
- ~130 enrichments per day

## Troubleshooting

### Check if Google Places is Working

```bash
node tests/test-enrichment.js
```

### API Key Not Working

1. Verify API key is correctly set
2. Confirm Places API (New) is enabled in Google Cloud Console
3. Check API key restrictions
4. Restart Claude Desktop

### Enrichment Not Completing

1. Run `tests/test-enrichment.js` which waits for completion
2. Check that `GOOGLE_PLACES_ENABLED=true`
3. Verify searches are for hotels/restaurants

### Clear Failed Enrichment Cache

```sql
-- Reset failed enrichment attempts
DELETE FROM osm_google_mappings WHERE mapping_status IN ('not_found', 'error');
```

### Disable Google Places

```bash
node scripts/manage-config.js set google_places_enabled false
```

Or set `GOOGLE_PLACES_ENABLED=false` in `.env`.

## Database Tables

Google Places integration uses these tables:

- `google_places` - Cached Google Places data
- `osm_google_mappings` - Links OSM POIs to Google Places
- `enriched_pois` (view) - Combined OSM + Google data with "best" fields

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for full schema details.

## Security

- API keys are stored in `.env` (gitignored) or database `config` table
- Never commit API keys to git
- `.env.example` contains only placeholder values
