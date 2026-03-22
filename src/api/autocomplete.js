/**
 * GET /api/v1/autocomplete — fast POI name search for type-ahead
 */

import { sendJson } from '../api-router.js';
import { validateLimit } from '../validation.js';

export function registerAutocompleteRoutes(router) {
  router.get('/api/v1/autocomplete', async (req, res, { db, query }) => {
    const q = query.q;
    if (!q || q.length < 2) {
      return sendJson(res, 200, { suggestions: [] });
    }

    const countryCode = query.country_code || undefined;
    const cityGeonameId = query.city_geoname_id ? parseInt(query.city_geoname_id) : undefined;
    const poiType = query.poi_type || undefined;
    const poiTypes = query.poi_types ? query.poi_types.split(',').map(t => t.trim()).filter(Boolean) : undefined;
    const limit = validateLimit(query.limit, 10, 50);

    const suggestions = await db.autocompleteSearch(q, {
      countryCode,
      cityGeonameId,
      poiType,
      poiTypes,
      limit,
    });

    sendJson(res, 200, { suggestions });
  });
}
