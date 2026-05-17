-- Add explicit retry scheduling for Google Places enrichment states.
-- mapped_at remains the attempt timestamp; next_retry_at controls when pending,
-- error, and not_found mappings are eligible for another enrichment attempt.

ALTER TABLE IF EXISTS osm_google_mappings
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_osm_google_mappings_next_retry
ON osm_google_mappings(next_retry_at)
WHERE next_retry_at IS NOT NULL;
