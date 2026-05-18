/**
 * GET /api/v1/poi/:osm_id — full POI detail as JSON
 */

import { createErrorEnvelope, sendJson } from '../api-router.js';
import { NEARBY_LIMIT_DEFAULT, NEARBY_LIMIT_MAX, NEARBY_RADIUS_DEFAULT_KM, NEARBY_RADIUS_MAX_KM } from '../config.js';
import { getNearbyTypes } from '../poi-view-utils.js';
import { sanitizePoiExternalUrls, sanitizePoiExternalUrlsArray } from '../url-utils.js';
import { validateCoordinates, validateLimit, validateRadiusKm } from '../validation.js';

function parseTypes(value, fallback) {
  if (!value) return fallback;
  const types = String(value).split(',').map(item => item.trim()).filter(Boolean);
  return types.length > 0 ? types : fallback;
}

export function registerPOIRoutes(router) {
  router.get('/api/v1/poi/:osm_id/nearby', async (req, res, { db, params, query, user }) => {
    const osmId = parseInt(params.osm_id, 10);
    if (isNaN(osmId)) {
      return sendJson(res, 400, createErrorEnvelope('invalid_osm_id', 'Invalid osm_id'));
    }

    const poi = await db.getPOIDetails(osmId, null, user?.id || null);
    if (!poi) {
      return sendJson(res, 404, createErrorEnvelope('poi_not_found', 'POI not found'));
    }

    const coords = validateCoordinates(poi.osm_latitude ?? poi.latitude ?? poi.google_latitude, poi.osm_longitude ?? poi.longitude ?? poi.google_longitude);
    if (!coords.valid) {
      return sendJson(res, 422, createErrorEnvelope('missing_coordinates', 'Source POI has no valid coordinates'));
    }

    const radiusKm = validateRadiusKm(query.radius_km ?? query.radius, NEARBY_RADIUS_DEFAULT_KM, NEARBY_RADIUS_MAX_KM);
    const limit = validateLimit(query.limit, NEARBY_LIMIT_DEFAULT, NEARBY_LIMIT_MAX);
    const types = parseTypes(query.types, getNearbyTypes(poi.poi_type));
    const results = await db.searchPOIsNearCoordinates(
      coords.lat,
      coords.lon,
      radiusKm,
      types,
      limit,
      user?.id || null,
      [poi.osm_id],
    );

    sendJson(res, 200, {
      source: sanitizePoiExternalUrls({
        osm_id: poi.osm_id,
        name: poi.google_name || poi.osm_name || poi.name,
        poi_type: poi.poi_type,
        latitude: coords.lat,
        longitude: coords.lon,
      }),
      results: sanitizePoiExternalUrlsArray(results),
      count: results.length,
    });
  });

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
      return sendJson(res, 200, sanitizePoiExternalUrls(withFav));
    }

    sendJson(res, 200, sanitizePoiExternalUrls(poi));
  });
}
