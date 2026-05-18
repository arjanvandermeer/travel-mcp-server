/**
 * Centralized configuration constants
 *
 * Consolidates magic numbers from across the codebase into named exports.
 * Grouped by domain: SEARCH, AUTH, CACHE, GEO, GOOGLE_PLACES, NEARBY, SESSION.
 */

function positiveIntFromEnv(name, defaultValue) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

// --- Search defaults and limits ---
export const SEARCH_LIMIT_DEFAULT = 50;
export const SEARCH_LIMIT_MAX = 100;
export const SEARCH_RADIUS_DEFAULT_KM = 50;
export const SEARCH_RADIUS_MAX_KM = 50;
export const CITY_SEARCH_RADIUS_MAX_KM = 1000;
export const MAP_POI_LIMIT_MAX = 500;

// --- Nearby POI defaults ---
export const NEARBY_RADIUS_DEFAULT_KM = 1.5;
export const NEARBY_RADIUS_MAX_KM = 10;
export const NEARBY_LIMIT_DEFAULT = 10;
export const NEARBY_LIMIT_MAX = 20;

// --- Auth ---
export const AUTH_PENDING_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
export const AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1000;              // 10 minutes
export const AUTH_PENDING_MAX_SIZE = 10000;
export const AUTH_SESSION_COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;    // 7 days
export const AUTH_TOKEN_MIN_LENGTH = 10;

// --- Cache TTLs ---
export const OAUTH_INTROSPECTION_CACHE_TTL_MS = 5 * 60 * 1000;    // 5 minutes
export const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;                 // 5 minutes
export const HOMEPAGE_CACHE_TTL_MS = 15 * 60 * 1000;              // 15 minutes
export const HOMEPAGE_CACHE_MAX_SIZE = 50;
export const COUNTRIES_CACHE_TTL_MS = 60 * 60 * 1000;             // 1 hour

// --- Session ---
export const SESSION_MAX_AGE_MS = 30 * 60 * 1000;                 // 30 minutes
export const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;         // 5 minutes
export const SESSION_MAX_ACTIVE = positiveIntFromEnv('MCP_SESSION_MAX_ACTIVE', 500);
export const SESSION_CREATE_WINDOW_MS = 60 * 1000;                 // 1 minute
export const SESSION_CREATE_MAX_PER_WINDOW = positiveIntFromEnv('MCP_SESSION_CREATE_MAX_PER_WINDOW', 60);

// --- Database ---
export const DB_STATEMENT_TIMEOUT_MS = 30000;                     // 30 seconds

// --- Geo ---
export const EARTH_RADIUS_METERS = 6371000;

// --- Google Places ---
export const GOOGLE_PLACES_MIN_CONFIDENCE = 0.7;
export const GOOGLE_PLACES_TEXT_SEARCH_RADIUS = 500;               // meters — hard locationRestriction, aligned with 500m post-match distance check
export const GOOGLE_PLACES_NEARBY_SEARCH_RADIUS = 50;             // meters (default)
export const GOOGLE_PLACES_MATCH_SEARCH_RADIUS = 100;             // meters (for findMatchingPlace)
export const GOOGLE_PLACES_MAX_RESULTS = 20;
export const GOOGLE_PLACES_DAILY_LIMIT_DEFAULT = 100;
