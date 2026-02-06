-- Migration: Create import_sources table and rename imports to import_log
-- Run with: psql $DATABASE_URL < data/migrations/001_import_sources.sql

-- Step 1: Rename imports table to import_log
ALTER TABLE imports RENAME TO import_log;

-- Update index names to match new table name
ALTER INDEX idx_imports_type RENAME TO idx_import_log_type;
ALTER INDEX idx_imports_region RENAME TO idx_import_log_region;
ALTER INDEX idx_imports_status RENAME TO idx_import_log_status;
ALTER INDEX idx_imports_completed RENAME TO idx_import_log_completed;

-- Step 2: Create import_sources table
CREATE TABLE import_sources (
    id SERIAL PRIMARY KEY,
    keyword VARCHAR(100) UNIQUE NOT NULL,        -- 'france', 'thailand', 'europe'
    source_url VARCHAR(500) NOT NULL,            -- Full geofabrik URL
    display_name VARCHAR(200),                   -- Human-friendly name
    min_pois INTEGER DEFAULT 100,                -- Fail validation if fewer POIs imported
    refresh_interval_days INTEGER DEFAULT 30,    -- How often to refresh
    enabled BOOLEAN DEFAULT true,
    last_imported_at TIMESTAMP,
    last_import_id INTEGER REFERENCES import_log(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_import_sources_keyword ON import_sources(keyword);
CREATE INDEX idx_import_sources_enabled ON import_sources(enabled);

-- Step 3: Seed import_sources from known Geofabrik regions
INSERT INTO import_sources (keyword, source_url, display_name) VALUES
    -- Continents / Major Regions
    ('europe', 'https://download.geofabrik.de/europe-latest.osm.pbf', 'Europe'),
    ('asia', 'https://download.geofabrik.de/asia-latest.osm.pbf', 'Asia'),
    ('africa', 'https://download.geofabrik.de/africa-latest.osm.pbf', 'Africa'),
    ('north-america', 'https://download.geofabrik.de/north-america-latest.osm.pbf', 'North America'),
    ('south-america', 'https://download.geofabrik.de/south-america-latest.osm.pbf', 'South America'),
    ('central-america', 'https://download.geofabrik.de/central-america-latest.osm.pbf', 'Central America'),
    ('australia-oceania', 'https://download.geofabrik.de/australia-oceania-latest.osm.pbf', 'Australia & Oceania'),
    ('russia', 'https://download.geofabrik.de/russia-latest.osm.pbf', 'Russia'),

    -- Asia
    ('thailand', 'https://download.geofabrik.de/asia/thailand-latest.osm.pbf', 'Thailand'),
    ('vietnam', 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf', 'Vietnam'),
    ('cambodia', 'https://download.geofabrik.de/asia/cambodia-latest.osm.pbf', 'Cambodia'),
    ('laos', 'https://download.geofabrik.de/asia/laos-latest.osm.pbf', 'Laos'),
    ('myanmar', 'https://download.geofabrik.de/asia/myanmar-latest.osm.pbf', 'Myanmar'),
    ('malaysia-singapore-brunei', 'https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf', 'Malaysia, Singapore & Brunei'),
    ('indonesia', 'https://download.geofabrik.de/asia/indonesia-latest.osm.pbf', 'Indonesia'),
    ('philippines', 'https://download.geofabrik.de/asia/philippines-latest.osm.pbf', 'Philippines'),
    ('japan', 'https://download.geofabrik.de/asia/japan-latest.osm.pbf', 'Japan'),
    ('south-korea', 'https://download.geofabrik.de/asia/south-korea-latest.osm.pbf', 'South Korea'),
    ('china', 'https://download.geofabrik.de/asia/china-latest.osm.pbf', 'China'),
    ('india', 'https://download.geofabrik.de/asia/india-latest.osm.pbf', 'India'),
    ('nepal', 'https://download.geofabrik.de/asia/nepal-latest.osm.pbf', 'Nepal'),
    ('taiwan', 'https://download.geofabrik.de/asia/taiwan-latest.osm.pbf', 'Taiwan'),
    ('sri-lanka', 'https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf', 'Sri Lanka'),
    ('bangladesh', 'https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf', 'Bangladesh'),
    ('pakistan', 'https://download.geofabrik.de/asia/pakistan-latest.osm.pbf', 'Pakistan'),
    ('maldives', 'https://download.geofabrik.de/asia/maldives-latest.osm.pbf', 'Maldives'),

    -- Europe
    ('germany', 'https://download.geofabrik.de/europe/germany-latest.osm.pbf', 'Germany'),
    ('france', 'https://download.geofabrik.de/europe/france-latest.osm.pbf', 'France'),
    ('italy', 'https://download.geofabrik.de/europe/italy-latest.osm.pbf', 'Italy'),
    ('spain', 'https://download.geofabrik.de/europe/spain-latest.osm.pbf', 'Spain'),
    ('great-britain', 'https://download.geofabrik.de/europe/great-britain-latest.osm.pbf', 'Great Britain'),
    ('netherlands', 'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf', 'Netherlands'),
    ('belgium', 'https://download.geofabrik.de/europe/belgium-latest.osm.pbf', 'Belgium'),
    ('switzerland', 'https://download.geofabrik.de/europe/switzerland-latest.osm.pbf', 'Switzerland'),
    ('austria', 'https://download.geofabrik.de/europe/austria-latest.osm.pbf', 'Austria'),
    ('poland', 'https://download.geofabrik.de/europe/poland-latest.osm.pbf', 'Poland'),
    ('czech-republic', 'https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf', 'Czech Republic'),
    ('greece', 'https://download.geofabrik.de/europe/greece-latest.osm.pbf', 'Greece'),
    ('portugal', 'https://download.geofabrik.de/europe/portugal-latest.osm.pbf', 'Portugal'),
    ('ireland-and-northern-ireland', 'https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf', 'Ireland'),
    ('sweden', 'https://download.geofabrik.de/europe/sweden-latest.osm.pbf', 'Sweden'),
    ('norway', 'https://download.geofabrik.de/europe/norway-latest.osm.pbf', 'Norway'),
    ('finland', 'https://download.geofabrik.de/europe/finland-latest.osm.pbf', 'Finland'),
    ('denmark', 'https://download.geofabrik.de/europe/denmark-latest.osm.pbf', 'Denmark'),
    ('hungary', 'https://download.geofabrik.de/europe/hungary-latest.osm.pbf', 'Hungary'),
    ('romania', 'https://download.geofabrik.de/europe/romania-latest.osm.pbf', 'Romania'),
    ('croatia', 'https://download.geofabrik.de/europe/croatia-latest.osm.pbf', 'Croatia'),
    ('turkey', 'https://download.geofabrik.de/europe/turkey-latest.osm.pbf', 'Turkey'),

    -- Americas
    ('us', 'https://download.geofabrik.de/north-america/us-latest.osm.pbf', 'United States'),
    ('canada', 'https://download.geofabrik.de/north-america/canada-latest.osm.pbf', 'Canada'),
    ('mexico', 'https://download.geofabrik.de/north-america/mexico-latest.osm.pbf', 'Mexico'),
    ('brazil', 'https://download.geofabrik.de/south-america/brazil-latest.osm.pbf', 'Brazil'),
    ('argentina', 'https://download.geofabrik.de/south-america/argentina-latest.osm.pbf', 'Argentina'),
    ('chile', 'https://download.geofabrik.de/south-america/chile-latest.osm.pbf', 'Chile'),
    ('colombia', 'https://download.geofabrik.de/south-america/colombia-latest.osm.pbf', 'Colombia'),
    ('peru', 'https://download.geofabrik.de/south-america/peru-latest.osm.pbf', 'Peru'),

    -- Oceania
    ('australia', 'https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf', 'Australia'),
    ('new-zealand', 'https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf', 'New Zealand'),

    -- Africa
    ('south-africa', 'https://download.geofabrik.de/africa/south-africa-latest.osm.pbf', 'South Africa'),
    ('egypt', 'https://download.geofabrik.de/africa/egypt-latest.osm.pbf', 'Egypt'),
    ('morocco', 'https://download.geofabrik.de/africa/morocco-latest.osm.pbf', 'Morocco'),
    ('kenya', 'https://download.geofabrik.de/africa/kenya-latest.osm.pbf', 'Kenya'),
    ('tanzania', 'https://download.geofabrik.de/africa/tanzania-latest.osm.pbf', 'Tanzania'),
    ('ethiopia', 'https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf', 'Ethiopia'),
    ('nigeria', 'https://download.geofabrik.de/africa/nigeria-latest.osm.pbf', 'Nigeria')
ON CONFLICT (keyword) DO NOTHING;

-- Step 4: Update last_imported_at from import_log where we have successful imports
UPDATE import_sources s
SET
    last_imported_at = log.completed_at,
    last_import_id = log.id
FROM (
    SELECT DISTINCT ON (region_name)
        id, region_name, completed_at
    FROM import_log
    WHERE status = 'completed'
      AND region_name IS NOT NULL
    ORDER BY region_name, completed_at DESC
) log
WHERE s.keyword = REPLACE(log.region_name, '-latest', '');
