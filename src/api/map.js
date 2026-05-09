/**
 * GET /api/v1/map/pois — POIs within a bounding box (for map viewport)
 */

import { createErrorEnvelope, sendJson } from '../api-router.js';
import { validateCoordinates, validateLimit } from '../validation.js';

export function registerMapRoutes(router) {
  router.get('/api/v1/map/pois', async (req, res, { db, query, user }) => {
    // Require bounding box: sw_lat,sw_lng,ne_lat,ne_lng
    const { sw_lat, sw_lng, ne_lat, ne_lng } = query;

    const sw = validateCoordinates(sw_lat, sw_lng);
    if (!sw.valid) {
      return sendJson(res, 400, createErrorEnvelope('invalid_bbox', `sw coordinates: ${sw.error}`));
    }
    const ne = validateCoordinates(ne_lat, ne_lng);
    if (!ne.valid) {
      return sendJson(res, 400, createErrorEnvelope('invalid_bbox', `ne coordinates: ${ne.error}`));
    }

    const types = query.types ? query.types.split(',').map(t => t.trim()).filter(Boolean) : null;
    const limit = validateLimit(query.limit, 200, 500);
    const minRating = parseFloat(query.min_rating) || 0;

    try {
      const results = await db.searchPOIsInBBox(
        sw.lat, sw.lon, ne.lat, ne.lon,
        types,
        limit,
        minRating,
        user?.id || null,
      );

      sendJson(res, 200, { results, count: results.length });
    } catch (err) {
      console.error('[map] failed:', err.message);
      sendJson(res, 500, createErrorEnvelope('map_pois_failed', 'Map places are temporarily unavailable'));
    }
  });
}
