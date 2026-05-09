/**
 * GET /api/v1/poi/:osm_id — full POI detail as JSON
 */

import { createErrorEnvelope, sendJson } from '../api-router.js';
import { getNearbyTypes } from '../tools-config.js';
import { validateLimit } from '../validation.js';

export function registerPOIRoutes(router) {
  router.get('/api/v1/poi/:osm_id', async (req, res, { db, params, user }) => {
    const osmId = parseInt(params.osm_id, 10);
    if (isNaN(osmId)) {
      return sendJson(res, 400, createErrorEnvelope('invalid_osm_id', 'Invalid osm_id'));
    }

    const poi = await db.getPOIDetails(osmId, null, user?.id || null);
    if (!poi) {
      return sendJson(res, 404, createErrorEnvelope('poi_not_found', 'POI not found'));
    }

    // Add favorite status if user is authenticated
    if (user) {
      const [withFav] = await db.addFavoriteStatus([poi], user.id);
      return sendJson(res, 200, withFav);
    }

    sendJson(res, 200, poi);
  });

  router.get('/api/v1/poi/:osm_id/nearby', async (req, res, { db, params, query, user }) => {
    const osmId = parseInt(params.osm_id, 10);
    if (isNaN(osmId)) {
      return sendJson(res, 400, createErrorEnvelope('invalid_osm_id', 'Invalid osm_id'));
    }

    const sourcePoi = await db.getPOIDetails(osmId, null, user?.id || null);
    if (!sourcePoi) {
      return sendJson(res, 404, createErrorEnvelope('poi_not_found', 'POI not found'));
    }

    const latitude = sourcePoi.osm_latitude ?? sourcePoi.latitude;
    const longitude = sourcePoi.osm_longitude ?? sourcePoi.longitude;
    if (latitude == null || longitude == null) {
      return sendJson(res, 422, createErrorEnvelope('poi_missing_coordinates', 'POI does not have coordinates'));
    }

    const radius = Math.min(parseFloat(query.radius) || 1.5, 10);
    const limit = validateLimit(query.limit, 10, 20);
    const types = query.types
      ? query.types.split(',').map(t => t.trim()).filter(Boolean)
      : getNearbyTypes(sourcePoi.poi_type);

    const results = await db.searchPOIsNearCoordinates(
      latitude,
      longitude,
      radius,
      types,
      limit,
      user?.id || null,
      [sourcePoi.osm_id],
    );

    sendJson(res, 200, {
      source: {
        osm_id: sourcePoi.osm_id,
        name: sourcePoi.name || sourcePoi.osm_name,
        poi_type: sourcePoi.poi_type,
        latitude,
        longitude,
      },
      radius_km: radius,
      types,
      results,
      count: results.length,
    });
  });
}
