# Troubleshooting Google Places Enrichment

## Common Issues and Solutions

### Error Status: "invalid input syntax for type integer"

**Symptom**: POIs are marked with `google_enrichment_status = 'error'` and logs show:
```
Error enriching POI XXXXX with Google Places: invalid input syntax for type integer: "PRICE_LEVEL_MODERATE"
```

**Cause**: Google Places API (New) returns price levels as string enums (e.g., `PRICE_LEVEL_MODERATE`) but the database column was defined as `INTEGER` for the legacy API.

**Solution**:

1. Run the migration:
   ```bash
   psql "postgresql://traveluser:travelpass@localhost:5432/travel" < migrations/fix-price-level-type.sql
   ```

2. Clear errored POIs to allow retry:
   ```bash
   psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
     -c "UPDATE pois SET google_enrichment_status = NULL, google_enriched_at = NULL WHERE google_enrichment_status = 'error'"
   ```

3. POIs will be retried automatically on next search

**Price Level Values**:
- `PRICE_LEVEL_FREE` - Free
- `PRICE_LEVEL_INEXPENSIVE` - $
- `PRICE_LEVEL_MODERATE` - $$
- `PRICE_LEVEL_EXPENSIVE` - $$$
- `PRICE_LEVEL_VERY_EXPENSIVE` - $$$$

---

### Check Enrichment Status

```bash
# View status counts
psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
  -c "SELECT google_enrichment_status, COUNT(*) FROM pois GROUP BY google_enrichment_status"

# See POIs with errors
psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
  -c "SELECT osm_id, name, poi_type, google_enriched_at FROM pois WHERE google_enrichment_status = 'error'"

# See POIs marked as not found
psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
  -c "SELECT osm_id, name, poi_type FROM pois WHERE google_enrichment_status = 'not_found'"
```

---

### Debug Specific POI

Use the debug script to test enrichment for a specific OSM ID:

```javascript
// Edit debug-error.js and change the osmId
const osmId = YOUR_OSM_ID_HERE;

// Then run:
node debug-error.js
```

This will:
1. Test Google Places search for the POI
2. Show matching results
3. Test Place Details API
4. Retry enrichment and show results

---

### Clear Cache to Force Re-enrichment

```bash
# Clear specific POI
psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
  -c "UPDATE pois SET google_enrichment_status = NULL, google_enriched_at = NULL WHERE osm_id = YOUR_OSM_ID"

# Clear all "not_found" to retry
psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
  -c "UPDATE pois SET google_enrichment_status = NULL, google_enriched_at = NULL WHERE google_enrichment_status = 'not_found'"

# Clear all "error" to retry
psql "postgresql://traveluser:travelpass@localhost:5432/travel" \
  -c "UPDATE pois SET google_enrichment_status = NULL, google_enriched_at = NULL WHERE google_enrichment_status = 'error'"
```

---

### Google Places API Not Working

**Check configuration**:
```bash
node test-db-config.js
```

This verifies:
- API key is configured
- Google Places client initializes
- API calls work

**Check API key permissions**:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Check that "Places API (New)" is enabled
3. Verify API key restrictions allow your IP/domain

**Common API errors**:
- `REQUEST_DENIED` - API not enabled or key invalid
- `OVER_QUERY_LIMIT` - Exceeded API quota
- `INVALID_REQUEST` - Malformed request (check logs)

---

### Enrichment Not Triggering

**Verify Google Places is enabled**:
```bash
node scripts/manage-config.js get google_places_enabled
```

Should return `true`.

**Check if POI is already enriched**:
```sql
SELECT google_enrichment_status, google_enriched_at
FROM pois
WHERE osm_id = YOUR_OSM_ID;
```

If enriched recently (within cache period), it won't re-enrich.

**Force re-enrichment** by clearing the cache (see above).

---

### Performance Issues

**Check enrichment queue**:
```sql
SELECT COUNT(*) FROM pois WHERE google_enrichment_status IS NULL AND google_place_id IS NULL;
```

Shows how many POIs are pending enrichment.

**Adjust cache duration** to reduce API calls:
```bash
# Cache for 2 weeks instead of 1 week
node scripts/manage-config.js set google_places_cache_hours 336
```

**Limit enrichment** by disabling for certain POI types (requires code changes).

---

### Cost Management

**Monitor API usage**:
- Check [Google Cloud Console](https://console.cloud.google.com/apis/dashboard)
- View Places API (New) usage metrics
- Set up billing alerts

**Reduce costs**:
1. Increase cache duration (default 7 days)
2. Reduce search result limit (currently top 10)
3. Disable for low-value POI types
4. Only enrich "bookable" POIs (hotels, restaurants, attractions)

**Current cost controls**:
- Top 10 results per search
- 7-day cache (configurable)
- 24-hour retry prevention for "not_found"
- Background/fire-and-forget (doesn't block searches)
