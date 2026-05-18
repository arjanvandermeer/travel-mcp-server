/**
 * GET /api/v1/search/cities — search cities (type-ahead)
 * GET /api/v1/search/pois   — search POIs (full results)
 */

import { sendJson } from '../api-router.js';
import { CITY_SEARCH_RADIUS_MAX_KM, SEARCH_RADIUS_MAX_KM } from '../config.js';
import { parseStrictInteger, validateCoordinates, validateLimit, validateRadiusKm } from '../validation.js';

function parsePositiveInt(value, defaultValue, maxValue) {
  const parsed = parseStrictInteger(value);
  if (parsed === null || parsed <= 0) return defaultValue;
  return Math.min(parsed, maxValue);
}

function parseNonNegativeInt(value, defaultValue, maxValue) {
  const parsed = parseStrictInteger(value);
  if (parsed === null || parsed < 0) return defaultValue;
  return Math.min(parsed, maxValue);
}

function hasAnyQueryCoordinate(query) {
  return query.latitude !== undefined || query.longitude !== undefined;
}

function parseListParam(value) {
  if (!value) return null;
  const values = Array.isArray(value) ? value : String(value).split(',');
  const normalized = values.map(v => String(v).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

function parseBooleanParam(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null || value === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function registerSearchRoutes(router) {
  router.get('/api/v1/search/cities/random', async (req, res, { db, query }) => {
    const minPoiCount = parsePositiveInt(query.min_pois, 25, 1000);
    const minPopulation = parsePositiveInt(query.min_population, 50000, 10000000);
    const city = await db.getRandomCityWithData({ minPoiCount, minPopulation });
    if (!city) {
      return sendJson(res, 404, { error: 'No loaded cities available' });
    }
    sendJson(res, 200, { city });
  });

  router.get('/api/v1/search/cities', async (req, res, { db, query }) => {
    const countryCode = query.country_code;
    const state = query.state || null;
    const q = query.q || null;
    const limit = validateLimit(query.limit, 10, 50);
    const radiusKm = validateRadiusKm(query.radius_km, 50, CITY_SEARCH_RADIUS_MAX_KM);
    const minPoiCount = parseNonNegativeInt(query.min_pois, 0, 1000);

    // searchCities requires either country_code or coordinates
    if (!countryCode && !hasAnyQueryCoordinate(query)) {
      return sendJson(res, 400, { error: 'country_code or coordinates required' });
    }

    let latitude = null;
    let longitude = null;
    if (hasAnyQueryCoordinate(query)) {
      const coords = validateCoordinates(query.latitude, query.longitude);
      if (!coords.valid) {
        return sendJson(res, 400, { error: coords.error });
      }
      latitude = coords.lat;
      longitude = coords.lon;
    }

    const results = await db.searchCities({
      query: q,
      countryCode,
      state,
      latitude,
      longitude,
      radiusKm,
      minPoiCount,
      limit,
    });

    sendJson(res, 200, { results, count: results.length });
  });

  router.get('/api/v1/search/pois', async (req, res, { db, query, user }) => {
    const cityName = query.city_name || null;
    const countryCode = query.country_code || null;
    const state = query.state || null;
    const poiType = query.poi_type || null;
    const poiTypes = query.poi_types ? query.poi_types.split(',').map(t => t.trim()).filter(Boolean) : null;
    const cuisine = parseListParam(query.cuisine);
    const dietary = parseListParam(query.dietary);
    const name = query.q || null;
    const limit = validateLimit(query.limit, 50, 100);
    const offset = parseNonNegativeInt(query.offset ?? '0', 0, 100000);
    const radiusKm = validateRadiusKm(query.radius_km, null, SEARCH_RADIUS_MAX_KM);
    const openNow = parseBooleanParam(query.open_now);

    let latitude = null;
    let longitude = null;
    if (hasAnyQueryCoordinate(query)) {
      const coords = validateCoordinates(query.latitude, query.longitude);
      if (!coords.valid) {
        return sendJson(res, 400, { error: coords.error });
      }
      latitude = coords.lat;
      longitude = coords.lon;
    }

    // Need at least a name, city, or coordinates
    if (!name && !cityName && latitude === null) {
      return sendJson(res, 400, { error: 'Provide q (name), city_name, or coordinates' });
    }

    const results = await db.searchPOIs({
      cityName,
      countryCode,
      state,
      latitude,
      longitude,
      poiType,
      poiTypes,
      cuisine,
      dietary,
      name,
      radius: radiusKm,
      openNow,
      limit,
      offset,
      userId: user?.id || null,
    });

    sendJson(res, 200, { results, count: results.length });

    // Fire-and-forget: enrich any returned POIs that haven't been enriched yet.
    // enrichOSMPOI skips already-active entries and enforces daily quota, so this is safe unconditionally.
    if (results.length > 0 && typeof db.batchEnrichPOIs === 'function') {
      db.batchEnrichPOIs(results.map(r => r.osm_id)).catch(() => {});
    }
  });
}
