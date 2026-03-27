/**
 * GET /api/v1/map/pois — POIs within a bounding box (for map viewport)
 */

import { sendJson } from '../api-router.js';
import { validateCoordinates, validateLimit } from '../validation.js';

export function registerMapRoutes(router) {
  router.get('/api/v1/map/pois', async (req, res, { db, query, user }) => {
    // Require bounding box: sw_lat,sw_lng,ne_lat,ne_lng
    const { sw_lat, sw_lng, ne_lat, ne_lng } = query;

    const sw = validateCoordinates(sw_lat, sw_lng);
    if (!sw.valid) {
      return sendJson(res, 400, { error: `sw coordinates: ${sw.error}` });
    }
    const ne = validateCoordinates(ne_lat, ne_lng);
    if (!ne.valid) {
      return sendJson(res, 400, { error: `ne coordinates: ${ne.error}` });
    }

    const types = query.types ? query.types.split(',').map(t => t.trim()).filter(Boolean) : null;
    const limit = validateLimit(query.limit, 200, 500);
    const minRating = parseFloat(query.min_rating) || 0;

    const results = await db.searchPOIsInBBox(
      sw.lat, sw.lon, ne.lat, ne.lon,
      types,
      limit,
      minRating,
      user?.id || null,
    );

    sendJson(res, 200, { results, count: results.length });
  });
}
