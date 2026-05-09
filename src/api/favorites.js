/**
 * Favorites API (requires authentication)
 * GET    /api/v1/favorites         — list user's favorites
 * POST   /api/v1/favorites         — add a favorite
 * PATCH  /api/v1/favorites/:osm_id — update favorite notes
 * DELETE /api/v1/favorites/:osm_id — remove a favorite
 */

import { createErrorEnvelope, sendJson, parseBody } from '../api-router.js';
import { validateLimit } from '../validation.js';

export function registerFavoritesRoutes(router) {
  router.get('/api/v1/favorites', async (req, res, { db, query, user }) => {
    if (!user) {
      return sendJson(res, 401, createErrorEnvelope('authentication_required', 'Authentication required'));
    }

    const poiTypes = query.poi_types ? query.poi_types.split(',') : undefined;
    const limit = validateLimit(query.limit, 100, 100);

    const favorites = await db.listFavorites(user.id, { poiTypes, limit });
    sendJson(res, 200, { favorites, count: favorites.length });
  });

  router.post('/api/v1/favorites', async (req, res, { db, user }) => {
    if (!user) {
      return sendJson(res, 401, createErrorEnvelope('authentication_required', 'Authentication required'));
    }

    const body = await parseBody(req);
    const osmId = parseInt(body.osm_id, 10);
    if (isNaN(osmId)) {
      return sendJson(res, 400, createErrorEnvelope('invalid_osm_id', 'osm_id is required'));
    }

    const success = await db.addFavorite(user.id, osmId, body.notes || null);
    if (!success) {
      return sendJson(res, 404, createErrorEnvelope('poi_not_found', 'POI not found'));
    }

    sendJson(res, 201, { success: true });
  });

  router.patch('/api/v1/favorites/:osm_id', async (req, res, { db, params, user }) => {
    if (!user) {
      return sendJson(res, 401, createErrorEnvelope('authentication_required', 'Authentication required'));
    }

    const osmId = parseInt(params.osm_id, 10);
    if (isNaN(osmId)) {
      return sendJson(res, 400, createErrorEnvelope('invalid_osm_id', 'Invalid osm_id'));
    }

    const body = await parseBody(req);
    const updated = await db.updateFavoriteNotes(user.id, osmId, body.notes || null);
    if (!updated) {
      return sendJson(res, 404, createErrorEnvelope('favorite_not_found', 'Favorite not found'));
    }

    sendJson(res, 200, { success: true });
  });

  router.delete('/api/v1/favorites/:osm_id', async (req, res, { db, params, user }) => {
    if (!user) {
      return sendJson(res, 401, createErrorEnvelope('authentication_required', 'Authentication required'));
    }

    const osmId = parseInt(params.osm_id, 10);
    if (isNaN(osmId)) {
      return sendJson(res, 400, createErrorEnvelope('invalid_osm_id', 'Invalid osm_id'));
    }

    const removed = await db.removeFavorite(user.id, osmId);
    sendJson(res, 200, { success: removed });
  });
}
