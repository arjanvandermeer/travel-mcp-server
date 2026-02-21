/**
 * GET /api/v1/countries — list countries with POI data
 * GET /api/v1/states   — list states for a country
 */

import { sendJson } from '../api-router.js';

export function registerCountryRoutes(router) {
  router.get('/api/v1/countries', async (req, res, { db }) => {
    const countries = await db.listCountriesWithData();
    sendJson(res, 200, countries);
  });

  router.get('/api/v1/states', async (req, res, { db, query }) => {
    const countryCode = query.country_code;
    if (!countryCode) {
      return sendJson(res, 400, { error: 'country_code parameter is required' });
    }
    const states = await db.listStatesForCountry(countryCode);
    sendJson(res, 200, states);
  });
}
