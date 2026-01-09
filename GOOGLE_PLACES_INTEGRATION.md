# Google Places API Integration

This MCP server now supports automatic enrichment of POI data (hotels, restaurants, cafes, etc.) using the Google Places API.

## Features

- **Lazy Loading**: Google Places data is automatically fetched in the background when POIs are searched
- **Smart Caching**: Enrichment data is cached for 7 days (configurable) to minimize API costs
- **Automatic Matching**: POIs are automatically matched to Google Places using name + location
- **Rich Data**: Get ratings, review counts, photos, verified phone numbers, websites, and opening hours

## Setup

### 1. Get a Google Places API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Places API (New)
   - Places API
   - Maps JavaScript API (optional, for photos)
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > API Key**
6. (Optional but recommended) Restrict the API key:
   - Application restrictions: None (or IP addresses if running on server)
   - API restrictions: Select "Places API"

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Copy from example
cp .env.example .env
```

Edit `.env` and add your API key:

```env
# Database Configuration
DATABASE_URL=postgresql://traveluser:travelpass@localhost:5432/travel

# Google Places API Configuration
GOOGLE_PLACES_API_KEY=your_actual_api_key_here

# Google Places API Settings
GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_CACHE_HOURS=168  # Cache for 7 days (168 hours)
```

### 3. Restart the MCP Server

The MCP server needs to be restarted to pick up the environment variables. Since it runs through Claude Desktop, restart Claude Desktop to reload the MCP server.

## How It Works

### Automatic Background Enrichment

When you search for hotels or restaurants using the MCP tools (`search_hotels`, `search_restaurants`), the system automatically:

1. Returns OSM data immediately (fast response)
2. Triggers background enrichment for the top 10 results
3. Fetches matching Google Places data
4. Stores enrichment data in the database
5. Subsequent searches return enriched data instantly (from cache)

### Manual Detail Fetching

Use the `get_poi_details` tool to get full details for a specific POI:

```javascript
{
  "osm_id": 123456789
}
```

This returns both OSM and Google Places data in a single response.

### Enrichment Status

Each POI has a `google_enrichment_status` field:
- `null` or `pending`: Not yet enriched
- `enriched`: Successfully enriched with Google data
- `not_found`: No matching Google Place found
- `error`: Enrichment failed (will retry later)

## Data Provided by Google Places

When a POI is enriched, the following Google Places fields are added:

- `google_place_id`: Unique Google Places identifier
- `google_rating`: Rating from 0.0 to 5.0
- `google_user_ratings_total`: Number of user reviews
- `google_price_level`: Price level (0-4: free, inexpensive, moderate, expensive, very expensive)
- `google_types`: Array of place types (e.g., ["restaurant", "bar", "point_of_interest"])
- `google_formatted_address`: Verified formatted address
- `google_phone`: Verified phone number (international format)
- `google_website`: Verified website URL
- `google_opening_hours`: Detailed opening hours with periods and special days
- `google_photos`: Array of photo references (up to 10)
- `google_enriched_at`: Timestamp of last enrichment
- `google_enrichment_status`: Enrichment status

## Cost Management

### Google Places API Pricing (as of 2024)

- **Nearby Search**: $32 per 1,000 requests
- **Text Search**: $32 per 1,000 requests
- **Place Details**: $17 per 1,000 requests

Each POI enrichment makes:
- 1-2 search requests (Nearby or Text Search) = ~$0.032-$0.064
- 1 details request = $0.017
- **Total per POI**: ~$0.05

### Cost Optimization Strategies

1. **Caching**: Data is cached for 7 days by default (configurable via `GOOGLE_PLACES_CACHE_HOURS`)
2. **Lazy Loading**: Only enriches POIs that are actually searched for
3. **Batch Limiting**: Only enriches top 10 results per search (prevents quota exhaustion)
4. **Retry Prevention**: Failed lookups aren't retried for 24 hours
5. **Selective Enrichment**: Only hotels, restaurants, and cafes are auto-enriched

### Monthly Cost Estimate

Example: 100 hotel searches/day, average 5 unique hotels per search:
- Hotels enriched per month: 100 × 5 × 30 = 15,000
- Cost per hotel: $0.05
- **Total monthly cost**: ~$750

With 7-day caching, if same hotels are searched repeatedly:
- Unique hotels per month: ~2,000
- **Actual cost**: ~$100/month

### Free Tier

Google provides **$200 free credit per month**, which covers:
- ~4,000 POI enrichments per month
- ~130 enrichments per day

## Disabling Google Places Integration

To disable Google Places enrichment:

1. Set `GOOGLE_PLACES_ENABLED=false` in `.env`
2. Or remove/comment out `GOOGLE_PLACES_API_KEY`
3. Restart Claude Desktop

The system will continue to work using only OSM data.

## MCP Tools

### Updated Tools

These tools now trigger background enrichment:
- `search_hotels`
- `search_restaurants`
- `search_pois` (when `poi_type` is hotel, restaurant, or cafe)

### New Tool

**`get_poi_details`**: Get detailed information about a specific POI

```json
{
  "osm_id": 123456789
}
```

Returns full POI data including Google Places enrichment (if available).

## Example Workflow

1. **User**: "Find hotels in Bangkok"
2. **MCP**: Returns list of hotels from OSM data (fast)
3. **Background**: Enriches top 10 hotels with Google Places data
4. **User**: "Get details for Hotel XYZ"
5. **MCP**: Returns enriched data with Google ratings, photos, etc.

## Monitoring Enrichment

Check enrichment status in the database:

```sql
-- Count POIs by enrichment status
SELECT
  google_enrichment_status,
  COUNT(*)
FROM pois
GROUP BY google_enrichment_status;

-- Find recently enriched POIs
SELECT
  name,
  poi_type,
  google_rating,
  google_user_ratings_total,
  google_enriched_at
FROM pois
WHERE google_enrichment_status = 'enriched'
ORDER BY google_enriched_at DESC
LIMIT 20;
```

## Troubleshooting

### API Key Not Working

1. Check that API key is correctly set in `.env`
2. Verify Places API is enabled in Google Cloud Console
3. Check API key restrictions (should allow Places API)
4. Restart Claude Desktop to reload environment variables

### No Enrichment Happening

1. Check logs in Claude Desktop developer console for errors
2. Verify `GOOGLE_PLACES_ENABLED=true` in `.env`
3. Check that searches are for hotels/restaurants (other POI types aren't auto-enriched)
4. Look for "Enriched POI" messages in logs

### API Quota Exceeded

1. Check your Google Cloud Console quota usage
2. Increase `GOOGLE_PLACES_CACHE_HOURS` to reduce re-enrichment
3. Consider upgrading your Google Cloud billing account
4. Temporarily disable enrichment with `GOOGLE_PLACES_ENABLED=false`

## Privacy & Data Storage

- Google Places data is stored in your local PostgreSQL database
- No data is sent to external services except Google Places API
- Enrichment happens server-side, not in Claude Desktop
- Photo references (not actual photos) are stored; actual photos are fetched from Google when needed

## Future Enhancements

Potential future improvements:
- Batch enrichment scripts for popular destinations
- Support for more POI types (museums, attractions)
- Photo URL generation and display
- Real-time "open now" status
- User-facing enrichment progress indicators
