-- Add OpenRouter-backed AI summary configuration.

INSERT INTO app_config (key, value, encrypted, description) VALUES
    ('openrouter_api_key', NULL, TRUE, 'OpenRouter API key for AI enrichment jobs'),
    ('openrouter_place_summary_model', 'openrouter/auto', FALSE, 'OpenRouter model for place review and homepage summaries'),
    ('homepage_harvest_refresh_days', '180', FALSE, 'Days before official homepage content and images should be refreshed')
ON CONFLICT (key) DO UPDATE SET
    value = CASE
        WHEN app_config.value IS NULL THEN EXCLUDED.value
        WHEN app_config.key = 'homepage_harvest_refresh_days' AND app_config.value = '30' THEN EXCLUDED.value
        ELSE app_config.value
    END,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;
