/**
 * GET /api/v1/search/cities — search cities (type-ahead)
 * GET /api/v1/search/pois   — search POIs (full results)
 */

import { sendJson } from '../api-router.js';
import { validateCoordinates, validateLimit } from '../validation.js';

function parsePositiveInt(value, defaultValue, maxValue) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, maxValue);
}

function parsePositiveFloat(value, defaultValue, maxValue) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, maxValue);
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
    const radiusKm = parsePositiveFloat(query.radius_km, 50, 1000);
    const minPoiCount = parsePositiveInt(query.min_pois, 0, 1000);

    // searchCities requires either country_code or coordinates
    if (!countryCode && !query.latitude) {
      return sendJson(res, 400, { error: 'country_code or coordinates required' });
    }

    let latitude = null;
    let longitude = null;
    if (query.latitude) {
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
    const name = query.q || null;
    const limit = validateLimit(query.limit, 50, 100);
    const offset = Math.max(0, parseInt(query.offset ?? '0', 10) || 0);

    let latitude = null;
    let longitude = null;
    if (query.latitude) {
      const coords = validateCoordinates(query.latitude, query.longitude);
      if (!coords.valid) {
        return sendJson(res, 400, { error: coords.error });
      }
      latitude = coords.lat;
      longitude = coords.lon;
    }

    // Need at least a name, city, or coordinates
    if (!name && !cityName && !latitude) {
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
      name,
      limit,
      offset,
      userId: user?.id || null,
    });

    sendJson(res, 200, { results, count: results.length });

    // Fire-and-forget: enrich any returned POIs that haven't been enriched yet.
    // enrichOSMPOI skips already-active entries and enforces daily quota, so this is safe unconditionally.
    if (results.length > 0) {
      db.batchEnrichPOIs(results.map(r => r.osm_id)).catch(() => {});
    }
  });
}
