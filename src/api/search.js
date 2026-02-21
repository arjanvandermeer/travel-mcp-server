/**
 * GET /api/v1/search/cities — search cities (type-ahead)
 * GET /api/v1/search/pois   — search POIs (full results)
 */

import { sendJson } from '../api-router.js';

export function registerSearchRoutes(router) {
  router.get('/api/v1/search/cities', async (req, res, { db, query }) => {
    const countryCode = query.country_code;
    const state = query.state || null;
    const q = query.q || null;
    const limit = Math.min(parseInt(query.limit) || 10, 50);

    // searchCities requires either country_code or coordinates
    if (!countryCode && !query.latitude) {
      return sendJson(res, 400, { error: 'country_code or coordinates required' });
    }

    const results = await db.searchCities({
      query: q,
      countryCode,
      state,
      latitude: query.latitude ? parseFloat(query.latitude) : null,
      longitude: query.longitude ? parseFloat(query.longitude) : null,
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
    const limit = Math.min(parseInt(query.limit) || 50, 100);
    const latitude = query.latitude ? parseFloat(query.latitude) : null;
    const longitude = query.longitude ? parseFloat(query.longitude) : null;

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
