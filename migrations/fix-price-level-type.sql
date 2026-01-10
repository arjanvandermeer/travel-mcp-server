-- Migration: Fix google_price_level column type for Google Places API (New)
--
-- The new Google Places API returns price level as a string enum
-- (e.g., "PRICE_LEVEL_MODERATE") instead of an integer (0-4).
--
-- This migration changes the column type from INTEGER to TEXT.

ALTER TABLE pois ALTER COLUMN google_price_level TYPE TEXT;

-- Update existing numeric values to string enums (if any exist)
-- Legacy API used 0-4, new API uses enums
UPDATE pois
SET google_price_level = CASE
    WHEN google_price_level = '0' THEN 'PRICE_LEVEL_FREE'
    WHEN google_price_level = '1' THEN 'PRICE_LEVEL_INEXPENSIVE'
    WHEN google_price_level = '2' THEN 'PRICE_LEVEL_MODERATE'
    WHEN google_price_level = '3' THEN 'PRICE_LEVEL_EXPENSIVE'
    WHEN google_price_level = '4' THEN 'PRICE_LEVEL_VERY_EXPENSIVE'
    ELSE google_price_level
END
WHERE google_price_level IS NOT NULL
  AND google_price_level NOT LIKE 'PRICE_LEVEL_%';

COMMENT ON COLUMN pois.google_price_level IS 'Google Places API (New) price level enum: PRICE_LEVEL_FREE, PRICE_LEVEL_INEXPENSIVE, PRICE_LEVEL_MODERATE, PRICE_LEVEL_EXPENSIVE, PRICE_LEVEL_VERY_EXPENSIVE';
