/**
 * Integration tests for REST API endpoints
 * Tests the endpoint handlers with a mock database
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ApiRouter, sendJson } from '../../src/api-router.js';
import { registerCountryRoutes } from '../../src/api/countries.js';
import { registerSearchRoutes } from '../../src/api/search.js';
import { registerAutocompleteRoutes } from '../../src/api/autocomplete.js';
import { registerPOIRoutes } from '../../src/api/poi.js';
import { registerFavoritesRoutes } from '../../src/api/favorites.js';
import { registerCityOverviewRoutes } from '../../src/api/city-overview.js';
import { fakeReq, fakePostReq, fakeRes } from '../mocks/http-helpers.js';

// Mock database with all methods the API handlers need
function createApiMockDb(overrides = {}) {
  return {
    listCountriesWithData: async () => [
      { code: 'TH', name: 'Thailand', continent: 'AS' },
      { code: 'JP', name: 'Japan', continent: 'AS' },
    ],
    listStatesForCountry: async (cc) => {
      if (cc === 'TH') return [{ code: '10', name: 'Bangkok', ascii_name: 'Bangkok' }];
      return [];
    },
    searchCities: async (opts) => [
      { geoname_id: 1, name: 'Bangkok', country_code: 'TH', population: 8280925 },
    ],
    getRandomCityWithData: async () => (
      { geoname_id: 1, name: 'Bangkok', country_code: 'TH', country_name: 'Thailand', population: 8280925, poi_count: 42 }
    ),
    searchPOIs: async (params) => [
      { osm_id: 123, name: 'Grand Palace Hotel', poi_type: 'hotel', google_rating: 4.5 },
    ],
    autocompleteSearch: async (q, opts) => [
      { osm_id: 123, name: 'Grand Palace Hotel', poi_type: 'hotel', google_rating: 4.5, city: 'Bangkok', country_code: 'TH' },
    ],
    getPOIDetails: async (osmId) => {
      if (osmId === 123) return { osm_id: 123, osm_name: 'Grand Palace Hotel', poi_type: 'hotel', osm_latitude: 13.75, osm_longitude: 100.5 };
      return null;
    },
    getCityByName: async (name, countryCode) => {
      if (name === 'Bangkok') return { name: 'Bangkok', country_code: countryCode, population: 8280925, latitude: 13.75, longitude: 100.5 };
      return null;
    },
    getRadiusForPopulation: () => 30,
    searchPOIsNearCoordinates: async () => [
      { osm_id: 124, name: 'Nearby Cafe', poi_type: 'cafe', distance_km: 0.4 },
    ],
    addFavoriteStatus: async (pois, userId) => pois.map(p => ({ ...p, is_favorite: false })),
    listFavorites: async (userId, opts) => [
      { osm_id: 123, name: 'Grand Palace Hotel', poi_type: 'hotel' },
    ],
    addFavorite: async (userId, osmId, notes) => osmId === 123,
    updateFavoriteNotes: async (userId, osmId, notes) => osmId === 123,
    removeFavorite: async (userId, osmId) => osmId === 123,
    ...overrides,
  };
}

describe('GET /api/v1/countries', () => {
  it('should return countries', async () => {
    const router = new ApiRouter();
    registerCountryRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/countries');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.length, 2);
    assert.strictEqual(data[0].code, 'TH');
  });
});

describe('GET /api/v1/states', () => {
  it('should return states for a country', async () => {
    const router = new ApiRouter();
    registerCountryRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/states?country_code=TH');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].name, 'Bangkok');
  });

  it('should return 400 without country_code', async () => {
    const router = new ApiRouter();
    registerCountryRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/states');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 400);
  });
});

describe('GET /api/v1/search/cities', () => {
  it('should return a random city from loaded areas', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/search/cities/random');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.city.name, 'Bangkok');
    assert.strictEqual(data.city.poi_count, 42);
  });

  it('should return 404 when no loaded random city is available', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb({
      getRandomCityWithData: async () => null,
    });

    const req = fakeReq('GET', '/api/v1/search/cities/random');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.json().error, 'No loaded cities available');
  });

  it('should search cities by country and query', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/search/cities?country_code=TH&q=bang');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.results.length, 1);
    assert.strictEqual(data.count, 1);
  });

  it('should return 400 without country_code or coordinates', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/search/cities?q=bang');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 400);
  });
});

describe('GET /api/v1/search/pois', () => {
  it('should search POIs', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/search/pois?city_name=Bangkok&country_code=TH');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.results.length, 1);
  });

  it('should return 400 without search criteria', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/search/pois');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 400);
  });
});

describe('GET /api/v1/autocomplete', () => {
  it('should return suggestions for query', async () => {
    const router = new ApiRouter();
    registerAutocompleteRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/autocomplete?q=grand&country_code=TH');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.suggestions.length, 1);
  });

  it('should return empty for short query', async () => {
    const router = new ApiRouter();
    registerAutocompleteRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/autocomplete?q=g');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.suggestions.length, 0);
  });
});

describe('GET /api/v1/poi/:osm_id', () => {
  it('should return POI details', async () => {
    const router = new ApiRouter();
    registerPOIRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/poi/123');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.osm_id, 123);
  });

  it('should return 404 for unknown POI', async () => {
    const router = new ApiRouter();
    registerPOIRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/poi/999');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 404);
  });
});

describe('Favorites API', () => {
  const mockUser = { id: 1, email: 'test@test.com' };

  it('GET /api/v1/favorites should require auth', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/favorites');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 401);
  });

  it('GET /api/v1/favorites should return favorites', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/favorites');
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.favorites.length, 1);
  });

  it('POST /api/v1/favorites should add favorite', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakePostReq('POST', '/api/v1/favorites', { osm_id: 123 });
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 201);
    const data = res.json();
    assert.strictEqual(data.success, true);
  });

  it('DELETE /api/v1/favorites/:osm_id should remove favorite', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('DELETE', '/api/v1/favorites/123');
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.success, true);
  });

  it('PATCH /api/v1/favorites/:osm_id should update notes', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakePostReq('PATCH', '/api/v1/favorites/123', { notes: 'Near the station' });
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().success, true);
  });

  it('POST /api/v1/favorites should require auth', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakePostReq('POST', '/api/v1/favorites', { osm_id: 123 });
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 401);
  });

  it('POST /api/v1/favorites should return 400 for invalid osm_id', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakePostReq('POST', '/api/v1/favorites', { osm_id: 'abc' });
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'osm_id is required');
  });

  it('POST /api/v1/favorites should return 400 when osm_id is missing', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakePostReq('POST', '/api/v1/favorites', {});
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 400);
  });

  it('POST /api/v1/favorites should return 404 when POI not found', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakePostReq('POST', '/api/v1/favorites', { osm_id: 999 });
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.json().error, 'POI not found');
  });

  it('DELETE /api/v1/favorites/:osm_id should require auth', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('DELETE', '/api/v1/favorites/123');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 401);
  });

  it('DELETE /api/v1/favorites/:osm_id should return 400 for invalid id', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('DELETE', '/api/v1/favorites/abc');
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Invalid osm_id');
  });

  it('GET /api/v1/favorites should pass poi_types and limit', async () => {
    const router = new ApiRouter();
    registerFavoritesRoutes(router);
    let capturedOpts;
    const db = createApiMockDb({
      listFavorites: async (userId, opts) => {
        capturedOpts = opts;
        return [];
      },
    });

    const req = fakeReq('GET', '/api/v1/favorites?poi_types=hotel,restaurant&limit=5');
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(capturedOpts.poiTypes, ['hotel', 'restaurant']);
    assert.strictEqual(capturedOpts.limit, 5);
  });
});

describe('GET /api/v1/poi/:osm_id edge cases', () => {
  it('should return 400 for non-numeric osm_id', async () => {
    const router = new ApiRouter();
    registerPOIRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/poi/abc');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Invalid osm_id');
  });

  it('should include favorite status when user is authenticated', async () => {
    const router = new ApiRouter();
    registerPOIRoutes(router);
    const db = createApiMockDb({
      addFavoriteStatus: async (pois, userId) => pois.map(p => ({ ...p, is_favorite: true })),
    });
    const mockUser = { id: 1, email: 'test@test.com' };

    const req = fakeReq('GET', '/api/v1/poi/123');
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.osm_id, 123);
    assert.strictEqual(data.is_favorite, true);
  });

  it('should pass user id to getPOIDetails when authenticated', async () => {
    const router = new ApiRouter();
    registerPOIRoutes(router);
    let capturedUserId;
    const db = createApiMockDb({
      getPOIDetails: async (osmId, _enrichConfig, userId) => {
        capturedUserId = userId;
        return { osm_id: osmId, osm_name: 'Test' };
      },
      addFavoriteStatus: async (pois) => pois,
    });
    const mockUser = { id: 42, email: 'test@test.com' };

    const req = fakeReq('GET', '/api/v1/poi/123');
    const res = fakeRes();
    await router.handle(req, res, { db, user: mockUser });

    assert.strictEqual(capturedUserId, 42);
  });
});

describe('GET /api/v1/poi/:osm_id/nearby', () => {
  it('should return nearby POIs as JSON', async () => {
    const router = new ApiRouter();
    registerPOIRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/poi/123/nearby?radius=2&limit=5');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.source.osm_id, 123);
    assert.strictEqual(data.results.length, 1);
  });
});

describe('GET /api/v1/cities/:country_code/:city_name/overview', () => {
  it('should return a city overview', async () => {
    const router = new ApiRouter();
    registerCityOverviewRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/cities/TH/Bangkok/overview');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.city.name, 'Bangkok');
    assert.strictEqual(data.top.stays.length, 1);
  });
});

describe('Search API edge cases', () => {
  it('GET /api/v1/search/cities should accept latitude/longitude', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    let capturedOpts;
    const db = createApiMockDb({
      searchCities: async (opts) => {
        capturedOpts = opts;
        return [];
      },
    });

    const req = fakeReq('GET', '/api/v1/search/cities?latitude=13.75&longitude=100.5');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedOpts.latitude, 13.75);
    assert.strictEqual(capturedOpts.longitude, 100.5);
  });

  it('GET /api/v1/search/pois should accept query-only search', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/search/pois?q=palace');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 200);
  });

  it('GET /api/v1/search/pois should accept coordinate search', async () => {
    const router = new ApiRouter();
    registerSearchRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/search/pois?latitude=13.75&longitude=100.5');
    const res = fakeRes();
    await router.handle(req, res, { db, user: null });

    assert.strictEqual(res.statusCode, 200);
  });
});

describe('Autocomplete API edge cases', () => {
  it('should return empty for missing query', async () => {
    const router = new ApiRouter();
    registerAutocompleteRoutes(router);
    const db = createApiMockDb();

    const req = fakeReq('GET', '/api/v1/autocomplete');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().suggestions.length, 0);
  });

  it('should pass all filter params to autocompleteSearch', async () => {
    const router = new ApiRouter();
    registerAutocompleteRoutes(router);
    let capturedOpts;
    const db = createApiMockDb({
      autocompleteSearch: async (q, opts) => {
        capturedOpts = opts;
        return [];
      },
    });

    const req = fakeReq('GET', '/api/v1/autocomplete?q=grand&country_code=TH&city_geoname_id=123&poi_type=hotel&limit=5');
    const res = fakeRes();
    await router.handle(req, res, { db });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedOpts.countryCode, 'TH');
    assert.strictEqual(capturedOpts.cityGeonameId, 123);
    assert.strictEqual(capturedOpts.poiType, 'hotel');
    assert.strictEqual(capturedOpts.limit, 5);
  });
});
