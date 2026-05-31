/**
 * GET /api/v1/cities/:country_code/:city_name/overview — city-level UI summary
 */

import { createErrorEnvelope, sendJson } from '../api-router.js';
import { accommodationTypes, attractionTypes, foodTypes } from '../tools-config.js';

function collectOverviewOsmIds(...groups) {
  return [...new Set(
    groups
      .flat()
      .map(poi => poi?.osm_id)
      .filter(Boolean)
  )];
}

export function registerCityOverviewRoutes(router) {
  router.get('/api/v1/cities/:country_code/:city_name/overview', async (req, res, { db, params, user }) => {
    const countryCode = params.country_code?.toUpperCase();
    const cityName = params.city_name;

    if (!countryCode || !cityName) {
      return sendJson(res, 400, createErrorEnvelope('city_required', 'country_code and city_name are required'));
    }

    const city = await db.getCityByName(cityName, countryCode);
    if (!city) {
      return sendJson(res, 404, createErrorEnvelope('city_not_found', 'City not found'));
    }

    const radius = db.getRadiusForPopulation(city.population || 100000);
    const [hotels, restaurants, attractions] = await Promise.all([
      db.searchPOIsNearCoordinates(city.latitude, city.longitude, radius, accommodationTypes, 8, user?.id || null),
      db.searchPOIsNearCoordinates(city.latitude, city.longitude, radius, foodTypes, 8, user?.id || null),
      db.searchPOIsNearCoordinates(city.latitude, city.longitude, radius, attractionTypes, 8, user?.id || null),
    ]);

    sendJson(res, 200, {
      city: {
        name: city.name,
        country_code: city.country_code,
        population: city.population,
        latitude: city.latitude,
        longitude: city.longitude,
        radius_km: radius,
      },
      counts: {
        stays: hotels.length,
        food: restaurants.length,
        attractions: attractions.length,
      },
      top: {
        stays: hotels,
        food: restaurants,
        attractions,
      },
      suggested_focus: {
        latitude: city.latitude,
        longitude: city.longitude,
        zoom: city.population > 1000000 ? 12 : 13,
      },
    });

    // Fire-and-forget enrichment for the cards the homepage just put on screen.
    if (typeof db.batchEnrichPOIs === 'function') {
      const osmIds = collectOverviewOsmIds(hotels, restaurants, attractions);
      if (osmIds.length > 0) db.batchEnrichPOIs(osmIds).catch(() => {});
    }
  });
}
