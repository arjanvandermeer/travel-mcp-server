/**
 * GET /api/v1/poi/:osm_id — full POI detail as JSON
 */

import { sendJson } from '../api-router.js';

export function registerPOIRoutes(router) {
  router.get('/api/v1/poi/:osm_id', async (req, res, { db, params, user }) => {
    const osmId = parseInt(params.osm_id, 10);
    if (isNaN(osmId)) {
      return sendJson(res, 400, { error: 'Invalid osm_id' });
    }

    const poi = await db.getPOIDetails(osmId, null, user?.id || null);
    if (!poi) {
      return sendJson(res, 404, { error: 'POI not found' });
    }

    // Add favorite status if user is authenticated
    if (user) {
      const [withFav] = await db.addFavoriteStatus([poi], user.id);
      return sendJson(res, 200, withFav);
    }

    sendJson(res, 200, poi);
  });
}
