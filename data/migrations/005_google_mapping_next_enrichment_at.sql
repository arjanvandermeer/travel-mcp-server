-- Rename the enrichment scheduling column to reflect retries and refreshes.

ALTER TABLE IF EXISTS osm_google_mappings
ADD COLUMN IF NOT EXISTS next_enrichment_at TIMESTAMP;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'osm_google_mappings'
          AND column_name = 'next_retry_at'
    ) THEN
        UPDATE osm_google_mappings
        SET next_enrichment_at = COALESCE(next_enrichment_at, next_retry_at)
        WHERE next_retry_at IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_osm_google_mappings_next_enrichment
ON osm_google_mappings(next_enrichment_at)
WHERE next_enrichment_at IS NOT NULL;

DROP INDEX IF EXISTS idx_osm_google_mappings_next_retry;

ALTER TABLE IF EXISTS osm_google_mappings
DROP COLUMN IF EXISTS next_retry_at;
