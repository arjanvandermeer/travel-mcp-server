/**
 * GET /api/v1/search/cities — search cities (type-ahead)
 * GET /api/v1/search/pois   — search POIs (full results)
 */

import { sendJson } from '../api-router.js';
import { validateCoordinates, validateLimit } from '../validation.js';

export function registerSearchRoutes(router) {
  router.get('/api/v1/search/cities/random', async (req, res, { db }) => {
    const city = await db.getRandomCityWithData();
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
      userId: user?.id || null,
    });

    sendJson(res, 200, { results, count: results.length });
  });
}
