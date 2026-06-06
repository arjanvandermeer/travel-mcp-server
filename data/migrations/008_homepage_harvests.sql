-- Store official homepage harvest data separately from AI summaries.

INSERT INTO app_config (key, value, encrypted, description) VALUES
    ('homepage_harvest_refresh_days', '180', FALSE, 'Days before official homepage content and images should be refreshed')
ON CONFLICT (key) DO UPDATE SET
    value = CASE
        WHEN app_config.value IS NULL THEN EXCLUDED.value
        WHEN app_config.value = '30' THEN EXCLUDED.value
        ELSE app_config.value
    END,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS poi_homepage_harvests (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT NOT NULL REFERENCES osm_pois(osm_id) ON DELETE CASCADE,
    original_url VARCHAR(500) NOT NULL,
    final_url VARCHAR(1000),
    fetch_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    http_status INTEGER,
    content_type VARCHAR(200),
    title TEXT,
    meta_description TEXT,
    text_content TEXT,
    image_urls JSONB DEFAULT '[]'::jsonb,
    content_hash VARCHAR(64),
    fetch_error TEXT,
    fetched_at TIMESTAMP,
    next_fetch_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (osm_id, original_url)
);

CREATE INDEX IF NOT EXISTS idx_poi_homepage_harvests_osm_id ON poi_homepage_harvests(osm_id);
CREATE INDEX IF NOT EXISTS idx_poi_homepage_harvests_next_fetch ON poi_homepage_harvests(next_fetch_at) WHERE next_fetch_at IS NOT NULL;
