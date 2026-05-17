-- Migration: Add hotel chain and brand reference data
-- Run with: psql $DATABASE_URL < data/migrations/003_hotel_chains.sql

CREATE TABLE IF NOT EXISTS hotel_chains (
    id SERIAL PRIMARY KEY,
    chain_name VARCHAR(200) NOT NULL,
    brand_name VARCHAR(200) NOT NULL,
    parent_chain VARCHAR(200),
    wikidata_id VARCHAR(50),
    aliases TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_name, brand_name)
);

CREATE INDEX IF NOT EXISTS idx_hotel_chains_chain_name ON hotel_chains(LOWER(chain_name));
CREATE INDEX IF NOT EXISTS idx_hotel_chains_brand_name ON hotel_chains(LOWER(brand_name));
CREATE INDEX IF NOT EXISTS idx_hotel_chains_wikidata_id ON hotel_chains(wikidata_id) WHERE wikidata_id IS NOT NULL;

INSERT INTO hotel_chains (chain_name, brand_name, parent_chain, wikidata_id, aliases) VALUES
    ('Hilton', 'Hilton', NULL, NULL, ARRAY['Hilton Hotels', 'Hilton Hotels & Resorts']),
    ('Hilton', 'Conrad', 'Hilton', NULL, ARRAY['Conrad Hotels', 'Conrad Hotels & Resorts']),
    ('Hilton', 'Waldorf Astoria', 'Hilton', NULL, ARRAY['Waldorf Astoria Hotels & Resorts']),
    ('Hilton', 'DoubleTree', 'Hilton', NULL, ARRAY['DoubleTree by Hilton']),
    ('Hilton', 'Hampton by Hilton', 'Hilton', NULL, ARRAY['Hampton Inn', 'Hampton Inn by Hilton']),
    ('Hilton', 'Hilton Garden Inn', 'Hilton', NULL, ARRAY[]::TEXT[]),
    ('Hilton', 'Embassy Suites', 'Hilton', NULL, ARRAY['Embassy Suites by Hilton']),
    ('Hilton', 'Homewood Suites', 'Hilton', NULL, ARRAY['Homewood Suites by Hilton']),
    ('Marriott', 'Marriott', NULL, NULL, ARRAY['Marriott Hotels']),
    ('Marriott', 'Ritz-Carlton', 'Marriott', NULL, ARRAY['The Ritz-Carlton']),
    ('Marriott', 'St. Regis', 'Marriott', NULL, ARRAY['St Regis']),
    ('Marriott', 'Westin', 'Marriott', NULL, ARRAY['Westin Hotels']),
    ('Marriott', 'Sheraton', 'Marriott', NULL, ARRAY['Sheraton Hotels']),
    ('Marriott', 'Courtyard by Marriott', 'Marriott', NULL, ARRAY['Courtyard']),
    ('Marriott', 'Fairfield by Marriott', 'Marriott', NULL, ARRAY['Fairfield Inn']),
    ('Marriott', 'W Hotels', 'Marriott', NULL, ARRAY['W Hotel']),
    ('IHG', 'Holiday Inn', 'IHG', NULL, ARRAY[]::TEXT[]),
    ('IHG', 'Holiday Inn Express', 'IHG', NULL, ARRAY[]::TEXT[]),
    ('IHG', 'InterContinental', 'IHG', NULL, ARRAY['InterContinental Hotels']),
    ('IHG', 'Crowne Plaza', 'IHG', NULL, ARRAY[]::TEXT[]),
    ('IHG', 'Kimpton', 'IHG', NULL, ARRAY['Kimpton Hotels']),
    ('Hyatt', 'Hyatt', NULL, NULL, ARRAY['Hyatt Hotels']),
    ('Hyatt', 'Park Hyatt', 'Hyatt', NULL, ARRAY[]::TEXT[]),
    ('Hyatt', 'Grand Hyatt', 'Hyatt', NULL, ARRAY[]::TEXT[]),
    ('Hyatt', 'Andaz', 'Hyatt', NULL, ARRAY[]::TEXT[]),
    ('Accor', 'Sofitel', 'Accor', NULL, ARRAY[]::TEXT[]),
    ('Accor', 'Novotel', 'Accor', NULL, ARRAY[]::TEXT[]),
    ('Accor', 'ibis', 'Accor', NULL, ARRAY['Ibis']),
    ('Accor', 'Mercure', 'Accor', NULL, ARRAY[]::TEXT[]),
    ('Accor', 'Pullman', 'Accor', NULL, ARRAY[]::TEXT[]),
    ('Accor', 'Fairmont', 'Accor', NULL, ARRAY['Fairmont Hotels'])
ON CONFLICT (chain_name, brand_name) DO UPDATE SET
    parent_chain = EXCLUDED.parent_chain,
    wikidata_id = EXCLUDED.wikidata_id,
    aliases = EXCLUDED.aliases;
