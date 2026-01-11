-- Migration: Update API field mask to capture booking-related fields
--
-- NOTE: This is not a database schema migration - the schema already supports these fields!
-- The google_places table already has:
--   - google_maps_uri (TEXT)
--   - business_status (TEXT)
--   - editorial_summary (TEXT)
--   - service_options (JSONB) - contains: reservable, delivery, dineIn, takeout
--
-- This migration just documents the update to the Google Places API field mask
-- in src/google-places.js to request these additional fields.
--
-- Updated field mask to include:
--   - googleMapsUri: Link to Google Maps (may have booking partner integrations)
--   - businessStatus: Operational status (OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY)
--   - editorialSummary: Curated place description from Google
--   - reservable: Whether the place accepts reservations
--   - delivery: Offers delivery service
--   - dineIn: Offers dine-in service
--   - takeout: Offers takeout service

-- No schema changes needed - table already has these columns!
-- Verify the schema is correct:

DO $$
BEGIN
    -- Check that google_maps_uri exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'google_places' AND column_name = 'google_maps_uri'
    ) THEN
        RAISE NOTICE '✓ google_maps_uri column exists';
    ELSE
        RAISE EXCEPTION '❌ google_maps_uri column is missing! Schema needs updating.';
    END IF;

    -- Check that business_status exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'google_places' AND column_name = 'business_status'
    ) THEN
        RAISE NOTICE '✓ business_status column exists';
    ELSE
        RAISE EXCEPTION '❌ business_status column is missing! Schema needs updating.';
    END IF;

    -- Check that editorial_summary exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'google_places' AND column_name = 'editorial_summary'
    ) THEN
        RAISE NOTICE '✓ editorial_summary column exists';
    ELSE
        RAISE EXCEPTION '❌ editorial_summary column is missing! Schema needs updating.';
    END IF;

    -- Check that service_options exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'google_places' AND column_name = 'service_options'
    ) THEN
        RAISE NOTICE '✓ service_options (JSONB) column exists';
        RAISE NOTICE '  Contains: reservable, delivery, dineIn, takeout';
    ELSE
        RAISE EXCEPTION '❌ service_options column is missing! Schema needs updating.';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '=== Schema Verification Complete ===';
    RAISE NOTICE 'All booking-related fields are present in the database.';
    RAISE NOTICE '';
    RAISE NOTICE 'Updated Google Places API field mask in src/google-places.js to include:';
    RAISE NOTICE '  - googleMapsUri';
    RAISE NOTICE '  - businessStatus';
    RAISE NOTICE '  - editorialSummary';
    RAISE NOTICE '  - reservable';
    RAISE NOTICE '  - delivery';
    RAISE NOTICE '  - dineIn';
    RAISE NOTICE '  - takeout';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Clear existing Google Places cache (optional):';
    RAISE NOTICE '     TRUNCATE google_places CASCADE;';
    RAISE NOTICE '  2. Re-enrich POIs to populate new booking fields';
    RAISE NOTICE '  3. Test booking field availability with a search';
END $$;
