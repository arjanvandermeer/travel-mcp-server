/**
 * GET /api/v1/homepage — discover section: random country + city + 5 hotels
 */

import { sendJson } from '../api-router.js';
import { accommodationTypes } from '../tools-config.js';

export function registerHomepageRoutes(router) {
  router.get('/api/v1/homepage', async (req, res, { db, user }) => {
    const data = await db.getHomepageDiscover(accommodationTypes, user?.id || null);
    if (!data) {
      return sendJson(res, 503, { error: 'No data available' });
    }
    sendJson(res, 200, data);
  });
}
