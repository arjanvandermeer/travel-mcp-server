# OSM API Rate Limiting and Error Handling

## Overview

The hotel-mcp-server implements sophisticated rate limiting and error handling to work reliably with the public OSM Overpass API, which has strict usage limits and can experience high load.

## Features Implemented

### 1. Race Condition Protection

**Problem**: Multiple simultaneous requests for the same uncached region would trigger duplicate API fetches.

**Solution**: Track active fetches in memory using a Map. If a fetch is already in progress for a region, subsequent requests will skip triggering a new fetch.

```javascript
// In HotelDatabase constructor:
this.activeFetches = new Map(); // regionHash -> Promise

// In getHotelsNearCoordinates:
if (!this.activeFetches.has(regionHash)) {
  const fetchPromise = this.refreshRegionCache(...)
    .finally(() => this.activeFetches.delete(regionHash));
  this.activeFetches.set(regionHash, fetchPromise);
} else {
  console.log('Fetch already in progress, skipping duplicate');
}
```

This ensures that even if 100 users simultaneously request hotels in Amsterdam, only ONE API fetch is triggered.

### 2. Rate Limiting

**Minimum request delay**: 1 second between API requests

This prevents overwhelming the OSM API and respects their usage guidelines.

```javascript
const MIN_REQUEST_DELAY = 1000; // 1 second
```

### 3. Exponential Backoff

When the API returns errors (429 Rate Limit, 504 Timeout, 5xx Server Errors), the system automatically retries with exponentially increasing delays:

- Attempt 1: 1 second delay
- Attempt 2: 2 seconds delay
- Attempt 3: 4 seconds delay
- Max delay: 30 seconds

If the API returns a `Retry-After` header, that value is respected instead.

### 4. Region Tiling

Large geographic regions are automatically split into smaller tiles to avoid API timeouts.

**Splitting triggers when:**
- Area size > 0.04 square degrees (~4.4km x 4.4km), OR
- Expected hotel count > 200

**Default tiling**: 2x2 grid (4 tiles)

Example: Amsterdam 10km radius (460 hotels) → Split into 4 tiles

### 5. Smart Error Recovery

The system handles various failure scenarios:

- **First request to new region**: Returns empty array, triggers background fetch
- **Stale cache**: Returns stale data immediately while refreshing in background
- **API timeout**: Retries with exponential backoff
- **Partial success**: Caches whatever data was successfully fetched
- **Database closed**: Logs error but doesn't crash

## Usage Examples

### Small Region (No Tiling)
```javascript
// 2km radius - small enough, won't split
const hotels = await db.getHotelsNearCoordinates(52.3730796, 4.8924534, 2, 100);
// Expected: 281 hotels
// Behavior: Single API request with retry on errors
```

### Large Region (With Tiling)
```javascript
// 10km radius - large area, will split into tiles
const hotels = await db.getHotelsNearCoordinates(52.37403, 4.88969, 10, 200);
// Expected: 460 hotels
// Behavior: Splits into 4 tiles, fetches sequentially with rate limiting
```

## API Request Flow

```
User Query
    ↓
Check Cache
    ↓
If Missing/Stale → Trigger Background Refresh
    ↓
Rate Limit Check (wait if needed)
    ↓
Calculate Region Size & Hotel Count
    ↓
Split into Tiles? (if large)
    ↓
For Each Tile:
    ↓
    Fetch with Retry Logic
    ↓
    Rate Limit (1s delay)
    ↓
    Parse & Insert Hotels
    ↓
Update Cache Metadata
    ↓
Return Cached Results
```

## Testing

Run the test scripts to verify the system:

```bash
# Test race condition protection
node test-race-condition.js

# Test small region (no tiling)
node test-small-region.js

# Test large region (with tiling)
node test-rate-limiting.js

# Test cache system overall
node test-cache.js
```

### Test Results

**Race Condition Test** ([test-race-condition.js](test-race-condition.js)):
- 3 simultaneous requests for the same region
- Expected: 1 fetch started, 2 duplicates skipped
- ✓ Working correctly

**Small Region Test** ([test-small-region.js](test-small-region.js)):
- 2km radius, ~281 hotels
- No tiling needed (area < 0.04 sq deg)
- ✓ Successfully fetched all hotels

**Large Region Test** ([test-rate-limiting.js](test-rate-limiting.js)):
- 10km radius, ~460 hotels
- Splits into 4 tiles automatically
- ✓ Rate limiting and retry logic working

## Configuration

Adjust these constants in the code to tune behavior:

**src/osm-api.js:**
```javascript
const MIN_REQUEST_DELAY = 1000;  // Minimum delay between requests (ms)
```

**src/database.js:**
```javascript
const CACHE_TTL = {
  region_hotels: 30,        // Refresh region cache after 30 days
  individual_hotel: 90,     // Refresh individual hotel after 90 days
};

// Tiling thresholds in refreshRegionCache():
const shouldSplit = areaSize > 0.04 || expectedCount > 200;
const tiles = shouldSplit ? splitBoundingBox(..., 4) : [...];
```

## OSM Overpass API Limits

The public Overpass API has these general limits:

- **Rate limit**: ~2-3 requests per second (enforced server-side)
- **Timeout**: Queries timeout after 25-180 seconds depending on complexity
- **Concurrent queries**: Limited to 2 simultaneous queries per IP
- **Fair use**: Excessive usage may result in temporary IP blocks

Our implementation respects these limits through rate limiting, tiling, and retry logic.

## Future Improvements

- [ ] Add configurable rate limit settings
- [ ] Implement adaptive tiling based on API response times
- [ ] Add metrics tracking (requests, retries, success rate)
- [ ] Support alternative Overpass API instances
- [ ] Implement request queuing for better concurrency control
