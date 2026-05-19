/**
 * Unit Tests for executeToolHandler and handleReadResource
 *
 * Tests tool handler logic with mocked database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  executeToolHandler,
  getToolsConfig,
  handleReadResource,
} from '../../src/tools-config.js';
import { MCP_APP_HTML_MIME_TYPE } from '../../src/resources-config.js';
import { render } from '../../src/templates/index.js';

// Simple DB mock
function createMockDb(overrides = {}) {
  return {
    searchCities: async () => [],
    searchPOIs: async () => [],
    searchPOIsNearCoordinates: async () => [],
    getDiningBudget: async () => null,
    findFoodDistricts: async () => null,
    getNeighborhoodScore: async () => null,
    buildItinerary: async () => null,
    planDining: async () => null,
    getPOIDetails: async () => null,
    getStats: async () => ({ total_pois: 100, total_cities: 50 }),
    batchEnrichPOIs: async () => {},
    addFavorite: async () => true,
    removeFavorite: async () => true,
    listFavorites: async () => [],
    getServerBaseUrl: async () => 'https://mcp.example.com',
    setUserConfig: async () => {},
    ...overrides,
  };
}

function parseResponse(result) {
  return JSON.parse(result.content[0].text);
}

// =============================================================================
// search_cities
// =============================================================================

describe('executeToolHandler: search_cities', () => {
  it('should return error when no country_code or coords', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('search_cities', { query: 'test' }, db);
    const parsed = parseResponse(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes('country_code'));
  });

  it('should search with country_code', async () => {
    const cities = [{ name: 'New York', population: 8000000 }];
    const db = createMockDb({ searchCities: async () => cities });
    const result = await executeToolHandler('search_cities', { country_code: 'US', query: 'New York' }, db);
    const parsed = parseResponse(result);
    assert.deepStrictEqual(parsed, cities);
  });

  it('should search with coordinates', async () => {
    const cities = [{ name: 'Nearby City' }];
    const db = createMockDb({ searchCities: async () => cities });
    const result = await executeToolHandler('search_cities', { latitude: 40.7, longitude: -73.9 }, db);
    const parsed = parseResponse(result);
    assert.deepStrictEqual(parsed, cities);
  });

  it('should enforce max limit of 100', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchCities: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_cities', { country_code: 'US', limit: 999 }, db);
    assert.strictEqual(capturedArgs.limit, 100);
  });

  it('should default limit to 10', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchCities: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_cities', { country_code: 'US' }, db);
    assert.strictEqual(capturedArgs.limit, 10);
  });
});

// =============================================================================
// search_hotels
// =============================================================================

describe('executeToolHandler: search_hotels', () => {
  it('should search with city_name and country_code', async () => {
    const pois = [{ osm_id: 1, osm_name: 'Grand Hotel' }];
    const db = createMockDb({ searchPOIs: async () => pois });
    const result = await executeToolHandler('search_hotels', { city_name: 'NYC', country_code: 'US' }, db);
    const parsed = parseResponse(result);
    assert.deepStrictEqual(parsed, pois);
  });

  it('search_hotels_ui should return structuredContent', async () => {
    const pois = [{ osm_id: 1, osm_name: 'Grand Hotel' }];
    const db = createMockDb({ searchPOIs: async () => pois });
    const result = await executeToolHandler('search_hotels_ui', { city_name: 'NYC', country_code: 'US' }, db);
    assert.ok(result.structuredContent);
    assert.strictEqual(result.structuredContent.count, 1);
    assert.deepStrictEqual(result.structuredContent.results, pois);
  });

  it('should cap limit at 100', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels', { city_name: 'NYC', country_code: 'US', limit: 200 }, db);
    assert.strictEqual(capturedArgs.limit, 100);
  });

  it('should cap search radius at 50 km', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels', {
      latitude: 40.7,
      longitude: -73.9,
      radius_km: 500,
    }, db);
    assert.strictEqual(capturedArgs.radius, 50);
  });

  it('should filter by a single accommodation type', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels', {
      city_name: 'Chiang Mai',
      country_code: 'TH',
      accommodation_type: 'guest_house',
    }, db);
    assert.deepStrictEqual(capturedArgs.poiTypes, ['guest_house']);
  });

  it('should filter by multiple accommodation types', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels_ui', {
      city_name: 'Chiang Mai',
      country_code: 'TH',
      accommodation_type: ['hostel', 'bed_and_breakfast'],
    }, db);
    assert.deepStrictEqual(capturedArgs.poiTypes, ['hostel', 'bed_and_breakfast']);
  });

  it('should pass amenity filters to hotel search', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels', {
      city_name: 'Bangkok',
      country_code: 'TH',
      amenities: ['wifi', 'pool', 'breakfast'],
    }, db);
    assert.deepStrictEqual(capturedArgs.amenities, ['wifi', 'pool', 'breakfast']);
  });

  it('should pass open_now and open_at filters to hotel search', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels_ui', {
      city_name: 'Bangkok',
      country_code: 'TH',
      open_now: true,
      open_at: '2026-05-18T20:00:00Z',
    }, db);
    assert.strictEqual(capturedArgs.openNow, true);
    assert.strictEqual(capturedArgs.openAt, '2026-05-18T20:00:00Z');
  });

  it('should pass hotel brand and chain filters to hotel search', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels', {
      country_code: 'TH',
      brand: 'DoubleTree',
      chain: 'Hilton',
    }, db);
    assert.strictEqual(capturedArgs.brand, 'DoubleTree');
    assert.strictEqual(capturedArgs.chain, 'Hilton');
  });

  it('should pass hotel intent filters to hotel search', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_hotels', {
      city_name: 'Bali',
      country_code: 'ID',
      intent: 'romantic',
    }, db);
    assert.strictEqual(capturedArgs.intent, 'romantic');
  });

  it('should reject invalid accommodation types', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('search_hotels', {
      city_name: 'Chiang Mai',
      country_code: 'TH',
      accommodation_type: 'spaceship',
    }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /Invalid accommodation_type/);
  });

  it('should expose accommodation_type schema on hotel tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_hotels', 'search_hotels_ui']) {
      const tool = tools.find(t => t.name === toolName);
      const schema = tool.inputSchema.properties.accommodation_type;
      assert.ok(schema, `${toolName} should expose accommodation_type`);
      const enumValues = schema.oneOf[1].items.enum;
      assert.ok(enumValues.includes('guest_house'));
      assert.ok(enumValues.includes('camp_site'));
      assert.ok(enumValues.includes('chalet'));
    }
  });

  it('should expose amenity schema on hotel tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_hotels', 'search_hotels_ui']) {
      const tool = tools.find(t => t.name === toolName);
      const schema = tool.inputSchema.properties.amenities;
      assert.ok(schema, `${toolName} should expose amenities`);
      assert.strictEqual(schema.type, 'array');
      assert.ok(schema.items.enum.includes('wifi'));
      assert.ok(schema.items.enum.includes('pool'));
      assert.ok(schema.items.enum.includes('breakfast'));
      assert.ok(schema.items.enum.includes('air_conditioning'));
      assert.ok(schema.items.enum.includes('parking'));
    }
  });

  it('should expose open_at schema on hotel tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_hotels', 'search_hotels_ui']) {
      const tool = tools.find(t => t.name === toolName);
      const schema = tool.inputSchema.properties.open_at;
      assert.ok(schema, `${toolName} should expose open_at`);
      assert.strictEqual(schema.type, 'string');
    }
  });

  it('should expose brand and chain schema on hotel tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_hotels', 'search_hotels_ui']) {
      const tool = tools.find(t => t.name === toolName);
      assert.strictEqual(tool.inputSchema.properties.brand.type, 'string');
      assert.strictEqual(tool.inputSchema.properties.chain.type, 'string');
    }
  });

  it('should expose intent schema on hotel tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_hotels', 'search_hotels_ui']) {
      const tool = tools.find(t => t.name === toolName);
      const schema = tool.inputSchema.properties.intent;
      assert.strictEqual(schema.type, 'string');
      assert.ok(schema.enum.includes('remote_work'));
      assert.ok(schema.enum.includes('family'));
      assert.ok(schema.enum.includes('romantic'));
      assert.ok(schema.enum.includes('budget'));
      assert.ok(schema.enum.includes('accessible'));
      assert.ok(schema.enum.includes('pet_friendly'));
    }
  });
});

// =============================================================================
// compare_hotels
// =============================================================================

describe('executeToolHandler: compare_hotels', () => {
  const hotels = new Map([
    [101, {
      osm_id: 101,
      poi_type: 'hotel',
      osm_name: 'Central Hotel',
      city: 'Bangkok',
      country_code: 'TH',
      osm_latitude: 13.75,
      osm_longitude: 100.5,
      osm_stars: '5',
      google_rating: 4.7,
      google_review_count: 1200,
      google_price_level: 'PRICE_LEVEL_EXPENSIVE',
      osm_tags: { internet_access: 'wlan', swimming_pool: 'yes', spa: 'yes' },
    }],
    [202, {
      osm_id: 202,
      poi_type: 'hotel',
      google_display_name: { text: 'Garden Stay' },
      city: 'Bangkok',
      country_code: 'TH',
      osm_latitude: 13.76,
      osm_longitude: 100.51,
      osm_stars: '3',
      google_rating: 4.2,
      google_review_count: 400,
      google_price_level: 'PRICE_LEVEL_MODERATE',
      osm_tags: { internet_access: 'wlan', parking: 'yes' },
    }],
  ]);

  it('should return side-by-side comparison data', async () => {
    const db = createMockDb({
      getPOIDetails: async (osmId) => hotels.get(osmId) || null,
      searchPOIsNearCoordinates: async (_lat, _lon, _radius, _types, _limit, _userId, exclude) => (
        exclude?.[0] === 101
          ? [{ osm_id: 1 }, { osm_id: 2 }, { osm_id: 3 }, { osm_id: 4 }, { osm_id: 5 }]
          : [{ osm_id: 6 }]
      ),
      getCityByName: async () => ({ latitude: 13.755, longitude: 100.505 }),
      calculateDistance: () => 0.75,
    });

    const result = await executeToolHandler('compare_hotels', { osm_ids: [101, 202] }, db);
    const parsed = parseResponse(result);

    assert.ok(result.structuredContent, 'Should return structured content');
    assert.strictEqual(parsed.hotel_count, 2);
    assert.strictEqual(parsed.hotels[0].name, 'Central Hotel');
    assert.strictEqual(parsed.hotels[1].name, 'Garden Stay');
    assert.deepStrictEqual(parsed.hotels[0].amenities, ['pool', 'spa', 'wifi']);
    assert.strictEqual(parsed.hotels[0].nearby_restaurant_count, 5);
    assert.strictEqual(parsed.hotels[0].walkability_proxy, 'good');
    assert.strictEqual(parsed.hotels[0].distance_to_city_center_km, 0.75);
    assert.ok(parsed.differences.some(diff => diff.field === 'price_level'));
    assert.ok(parsed.standout_summary.some(item => item.feature === 'highest_google_rating'));
  });

  it('should reject fewer than two unique hotel IDs', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('compare_hotels', { osm_ids: [101, 101] }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /2-5 unique numeric osm_ids/);
  });

  it('should return an error for missing hotels', async () => {
    const db = createMockDb({ getPOIDetails: async () => null });
    const result = await executeToolHandler('compare_hotels', { osm_ids: [101, 202] }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /Hotel not found/);
  });

  it('should return an error for non-accommodation POIs', async () => {
    const db = createMockDb({
      getPOIDetails: async (osmId) => osmId === 101 ? hotels.get(101) : { osm_id: 303, poi_type: 'restaurant' },
    });
    const result = await executeToolHandler('compare_hotels', { osm_ids: [101, 303] }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /only accepts accommodation/);
  });

  it('should expose compare_hotels schema', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    const tool = tools.find(t => t.name === 'compare_hotels');
    assert.ok(tool);
    assert.deepStrictEqual(tool.inputSchema.required, ['osm_ids']);
    assert.strictEqual(tool.inputSchema.properties.osm_ids.minItems, 2);
    assert.strictEqual(tool.inputSchema.properties.osm_ids.maxItems, 5);
  });
});

// =============================================================================
// get_neighborhood_score
// =============================================================================

describe('executeToolHandler: get_neighborhood_score', () => {
  it('should return structured neighborhood score content', async () => {
    let capturedArgs;
    const score = {
      score: 82,
      label: 'very_good',
      radius_km: 1.5,
      categories: {
        restaurants: { count: 9, score: 100 },
        transit: { count: 3, score: 75 },
      },
    };
    const db = createMockDb({
      getNeighborhoodScore: async (args) => {
        capturedArgs = args;
        return score;
      },
    });

    const result = await executeToolHandler('get_neighborhood_score', { osm_id: 101, radius_km: 2 }, db);
    const parsed = parseResponse(result);

    assert.deepStrictEqual(parsed, score);
    assert.deepStrictEqual(result.structuredContent, score);
    assert.strictEqual(capturedArgs.osmId, 101);
    assert.strictEqual(capturedArgs.radiusKm, 2);
  });

  it('should accept latitude and longitude', async () => {
    let capturedArgs;
    const db = createMockDb({
      getNeighborhoodScore: async (args) => {
        capturedArgs = args;
        return { score: 50, categories: {} };
      },
    });

    await executeToolHandler('get_neighborhood_score', { latitude: '13.75', longitude: '100.5' }, db);
    assert.strictEqual(capturedArgs.latitude, 13.75);
    assert.strictEqual(capturedArgs.longitude, 100.5);
  });

  it('should reject missing source arguments', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('get_neighborhood_score', {}, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /requires either osm_id or latitude and longitude/);
  });

  it('should return an error when source POI is not found', async () => {
    const db = createMockDb({ getNeighborhoodScore: async () => null });
    const result = await executeToolHandler('get_neighborhood_score', { osm_id: 999 }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /Source POI not found/);
  });

  it('should expose get_neighborhood_score schema', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    const tool = tools.find(t => t.name === 'get_neighborhood_score');
    assert.ok(tool);
    assert.ok(tool.inputSchema.properties.osm_id);
    assert.ok(tool.inputSchema.properties.latitude);
    assert.ok(tool.inputSchema.properties.longitude);
    assert.strictEqual(tool.inputSchema.properties.radius_km.default, 1.5);
  });
});

// =============================================================================
// build_itinerary
// =============================================================================

describe('executeToolHandler: build_itinerary', () => {
  it('should return structured itinerary content', async () => {
    let capturedArgs;
    const itinerary = {
      hotel: { osm_id: 101, name: 'Central Hotel' },
      days: 2,
      itinerary: [
        { day: 1, stops: [{ osm_id: 1, name: 'Museum' }] },
        { day: 2, stops: [{ osm_id: 2, name: 'Restaurant' }] },
      ],
    };
    const db = createMockDb({
      buildItinerary: async (args) => {
        capturedArgs = args;
        return itinerary;
      },
    });

    const result = await executeToolHandler('build_itinerary', {
      hotel_osm_id: 101,
      interests: ['museums', 'local_food'],
      days: 2,
    }, db);
    const parsed = parseResponse(result);

    assert.deepStrictEqual(parsed, itinerary);
    assert.deepStrictEqual(result.structuredContent, itinerary);
    assert.strictEqual(capturedArgs.hotelOsmId, 101);
    assert.deepStrictEqual(capturedArgs.interests, ['museums', 'local_food']);
    assert.strictEqual(capturedArgs.days, 2);
  });

  it('should reject missing hotel_osm_id', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('build_itinerary', {}, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /hotel_osm_id is required/);
  });

  it('should return an error when hotel is not found', async () => {
    const db = createMockDb({ buildItinerary: async () => null });
    const result = await executeToolHandler('build_itinerary', { hotel_osm_id: 999 }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /Hotel not found/);
  });

  it('should expose build_itinerary schema', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    const tool = tools.find(t => t.name === 'build_itinerary');
    assert.ok(tool);
    assert.deepStrictEqual(tool.inputSchema.required, ['hotel_osm_id']);
    assert.ok(tool.inputSchema.properties.interests.items.enum.includes('museums'));
    assert.strictEqual(tool.inputSchema.properties.days.default, 3);
  });
});

// =============================================================================
// plan_dining
// =============================================================================

describe('executeToolHandler: plan_dining', () => {
  it('should return structured dining plan content', async () => {
    let capturedArgs;
    const diningPlan = {
      city: 'Tokyo',
      days: 2,
      budget: 'moderate',
      plan: [{ day: 1, meals: [] }, { day: 2, meals: [] }],
    };
    const db = createMockDb({
      planDining: async (args) => {
        capturedArgs = args;
        return diningPlan;
      },
    });

    const result = await executeToolHandler('plan_dining', {
      city_name: 'Tokyo',
      country_code: 'JP',
      days: 2,
      dietary: ['vegetarian'],
      budget: 'moderate',
      variety_preference: 'high',
    }, db);
    const parsed = parseResponse(result);

    assert.deepStrictEqual(parsed, diningPlan);
    assert.deepStrictEqual(result.structuredContent, diningPlan);
    assert.strictEqual(capturedArgs.cityName, 'Tokyo');
    assert.strictEqual(capturedArgs.countryCode, 'JP');
    assert.deepStrictEqual(capturedArgs.dietary, ['vegetarian']);
    assert.strictEqual(capturedArgs.varietyPreference, 'high');
  });

  it('should reject missing city_name', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('plan_dining', {}, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /city_name is required/);
  });

  it('should return an error when dining city is not found', async () => {
    const db = createMockDb({ planDining: async () => null });
    const result = await executeToolHandler('plan_dining', { city_name: 'Atlantis' }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /City not found/);
  });

  it('should expose plan_dining schema', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    const tool = tools.find(t => t.name === 'plan_dining');
    assert.ok(tool);
    assert.deepStrictEqual(tool.inputSchema.required, ['city_name']);
    assert.ok(tool.inputSchema.properties.dietary.items.enum.includes('vegetarian'));
    assert.ok(tool.inputSchema.properties.dietary.items.enum.includes('pescatarian'));
    assert.ok(tool.inputSchema.properties.budget.enum.includes('moderate'));
    assert.strictEqual(tool.inputSchema.properties.variety_preference.default, 'balanced');
  });
});

// =============================================================================
// search_restaurants
// =============================================================================

describe('executeToolHandler: search_restaurants', () => {
  it('should search restaurants', async () => {
    const pois = [{ osm_id: 2, osm_name: 'Pizza Place' }];
    const db = createMockDb({ searchPOIs: async () => pois });
    const result = await executeToolHandler('search_restaurants', { city_name: 'NYC', country_code: 'US' }, db);
    const parsed = parseResponse(result);
    assert.deepStrictEqual(parsed, pois);
  });

  it('should filter by type when provided', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_restaurants', { city_name: 'NYC', country_code: 'US', type: 'cafe' }, db);
    assert.deepStrictEqual(capturedArgs.poiTypes, ['cafe']);
  });

  it('should pass cuisine filters for restaurants', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_restaurants', {
      city_name: 'Bangkok',
      country_code: 'TH',
      cuisine: ['sushi', 'japanese'],
    }, db);
    assert.deepStrictEqual(capturedArgs.cuisine, ['sushi', 'japanese']);
  });

  it('should accept a single cuisine string for restaurants', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_restaurants', {
      city_name: 'Bangkok',
      country_code: 'TH',
      cuisine: 'thai',
    }, db);
    assert.strictEqual(capturedArgs.cuisine, 'thai');
  });

  it('should pass dietary filters for restaurants', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_restaurants', {
      city_name: 'Berlin',
      country_code: 'DE',
      dietary: ['vegan', 'gluten_free'],
    }, db);
    assert.deepStrictEqual(capturedArgs.dietary, ['vegan', 'gluten_free']);
  });

  it('should pass price level filters for restaurants', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_restaurants', {
      city_name: 'Paris',
      country_code: 'FR',
      price_level: 2,
    }, db);
    assert.strictEqual(capturedArgs.priceLevel, 2);
  });

  it('should pass occasion filters for restaurants', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_restaurants', {
      city_name: 'NYC',
      country_code: 'US',
      occasion: 'date_night',
    }, db);
    assert.strictEqual(capturedArgs.occasion, 'date_night');
  });

  it('should reject unsupported restaurant occasions', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('search_restaurants', {
      city_name: 'NYC',
      country_code: 'US',
      occasion: 'surprise_me',
    }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /Unsupported occasion: surprise_me/);
  });

  it('should pass open_now and open_at filters for restaurants', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_restaurants', {
      city_name: 'Bangkok',
      country_code: 'TH',
      open_now: true,
      open_at: '2026-05-18T20:00:00Z',
    }, db);
    assert.strictEqual(capturedArgs.openNow, true);
    assert.strictEqual(capturedArgs.openAt, '2026-05-18T20:00:00Z');
  });

  it('search_restaurants_ui should return structuredContent', async () => {
    const pois = [{ osm_id: 2 }];
    const db = createMockDb({ searchPOIs: async () => pois });
    const result = await executeToolHandler('search_restaurants_ui', { city_name: 'NYC', country_code: 'US' }, db);
    assert.ok(result.structuredContent);
    assert.strictEqual(result.structuredContent.count, 1);
  });

  it('should expose open_at schema on restaurant tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_restaurants', 'search_restaurants_ui']) {
      const tool = tools.find(t => t.name === toolName);
      const schema = tool.inputSchema.properties.open_at;
      assert.ok(schema, `${toolName} should expose open_at`);
      assert.strictEqual(schema.type, 'string');
    }
  });

  it('should expose price_level schema on restaurant tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_restaurants', 'search_restaurants_ui']) {
      const tool = tools.find(t => t.name === toolName);
      const schema = tool.inputSchema.properties.price_level;
      assert.ok(schema, `${toolName} should expose price_level`);
      assert.ok(schema.oneOf[0].enum.includes(2));
      assert.ok(schema.oneOf[1].enum.includes('moderate'));
    }
  });

  it('should expose occasion schema on restaurant tools', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    for (const toolName of ['search_restaurants', 'search_restaurants_ui']) {
      const tool = tools.find(t => t.name === toolName);
      const schema = tool.inputSchema.properties.occasion;
      assert.strictEqual(schema.type, 'string');
      assert.ok(schema.enum.includes('business_dinner'));
      assert.ok(schema.enum.includes('casual_lunch'));
      assert.ok(schema.enum.includes('date_night'));
      assert.ok(schema.enum.includes('family_meal'));
      assert.ok(schema.enum.includes('quick_bite'));
      assert.ok(schema.enum.includes('late_night'));
    }
  });
});

// =============================================================================
// get_dining_budget
// =============================================================================

describe('executeToolHandler: get_dining_budget', () => {
  it('should return dining budget estimates', async () => {
    let capturedArgs;
    const budget = { city: 'Paris', sample_size: 10, data_quality: 'limited' };
    const db = createMockDb({
      getDiningBudget: async (args) => { capturedArgs = args; return budget; },
    });
    const result = await executeToolHandler('get_dining_budget', {
      city_name: 'Paris',
      country_code: 'FR',
      cuisine: 'french',
    }, db);
    assert.deepStrictEqual(parseResponse(result), budget);
    assert.deepStrictEqual(capturedArgs, {
      cityName: 'Paris',
      countryCode: 'FR',
      state: undefined,
      cuisine: 'french',
    });
  });

  it('should return an error when city is not found', async () => {
    const db = createMockDb({ getDiningBudget: async () => null });
    const result = await executeToolHandler('get_dining_budget', { city_name: 'Atlantis' }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /City not found/);
  });

  it('should expose get_dining_budget schema', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    const tool = tools.find(t => t.name === 'get_dining_budget');
    assert.ok(tool);
    assert.deepStrictEqual(tool.inputSchema.required, ['city_name']);
    assert.ok(tool.inputSchema.properties.cuisine);
  });
});

// =============================================================================
// find_food_districts
// =============================================================================

describe('executeToolHandler: find_food_districts', () => {
  it('should return food districts with structured content', async () => {
    let capturedArgs;
    const districts = {
      city: 'Bangkok',
      country_code: 'TH',
      districts: [{ name: 'Sukhumvit', restaurant_count: 12 }],
    };
    const db = createMockDb({
      findFoodDistricts: async (args) => { capturedArgs = args; return districts; },
    });

    const result = await executeToolHandler('find_food_districts', {
      city_name: 'Bangkok',
      country_code: 'TH',
      min_restaurants: 6,
      limit: 200,
    }, db);

    assert.deepStrictEqual(parseResponse(result), districts);
    assert.deepStrictEqual(result.structuredContent, districts);
    assert.deepStrictEqual(capturedArgs, {
      cityName: 'Bangkok',
      countryCode: 'TH',
      state: undefined,
      radiusKm: 15,
      minRestaurants: 6,
      limit: 100,
    });
  });

  it('should return an error when food district city is not found', async () => {
    const db = createMockDb({ findFoodDistricts: async () => null });
    const result = await executeToolHandler('find_food_districts', { city_name: 'Atlantis' }, db);
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /City not found/);
  });

  it('should expose find_food_districts schema', () => {
    const tools = getToolsConfig('https://mcp.example.com');
    const tool = tools.find(t => t.name === 'find_food_districts');
    assert.ok(tool);
    assert.deepStrictEqual(tool.inputSchema.required, ['city_name']);
    assert.ok(tool.inputSchema.properties.min_restaurants);
    assert.ok(tool.inputSchema.properties.radius_km);
  });
});

// =============================================================================
// search_pois
// =============================================================================

describe('executeToolHandler: search_pois', () => {
  it('should search all POI types', async () => {
    const pois = [{ osm_id: 3, osm_name: 'Museum' }];
    const db = createMockDb({ searchPOIs: async () => pois });
    const result = await executeToolHandler('search_pois', { city_name: 'Paris', country_code: 'FR' }, db);
    const parsed = parseResponse(result);
    assert.deepStrictEqual(parsed, pois);
  });

  it('should pass poi_type filter', async () => {
    let capturedArgs;
    const db = createMockDb({
      searchPOIs: async (args) => { capturedArgs = args; return []; },
    });
    await executeToolHandler('search_pois', { city_name: 'Paris', country_code: 'FR', poi_type: 'museum' }, db);
    assert.strictEqual(capturedArgs.poiType, 'museum');
  });

  it('search_pois_ui should return structuredContent', async () => {
    const db = createMockDb({ searchPOIs: async () => [{ osm_id: 3 }] });
    const result = await executeToolHandler('search_pois_ui', { city_name: 'Paris', country_code: 'FR' }, db);
    assert.ok(result.structuredContent);
  });

  it('should sanitize external URLs in structured search results', async () => {
    const db = createMockDb({
      searchPOIs: async () => [{ osm_id: 3, photo_url: 'javascript:alert(1)', google_website: 'https://example.com' }],
    });
    const result = await executeToolHandler('search_pois_ui', { city_name: 'Paris', country_code: 'FR' }, db);
    assert.strictEqual(result.structuredContent.results[0].photo_url, null);
    assert.strictEqual(result.structuredContent.results[0].google_website, 'https://example.com/');
  });
});

// =============================================================================
// get_poi_details
// =============================================================================

describe('executeToolHandler: get_poi_details', () => {
  it('should return error when no osm_id or google_place_id', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('get_poi_details', {}, db);
    const parsed = parseResponse(result);
    assert.ok(parsed.error);
  });

  it('should return error when POI not found', async () => {
    const db = createMockDb({ getPOIDetails: async () => null });
    const result = await executeToolHandler('get_poi_details', { osm_id: 999 }, db);
    const parsed = parseResponse(result);
    assert.strictEqual(parsed.error, 'POI not found');
  });

  it('should return POI details by osm_id', async () => {
    const poi = { osm_id: 123, osm_name: 'Test Hotel', poi_type: 'hotel' };
    const db = createMockDb({ getPOIDetails: async () => poi });
    const result = await executeToolHandler('get_poi_details', { osm_id: 123 }, db);
    const parsed = parseResponse(result);
    assert.strictEqual(parsed.osm_id, 123);
  });

  it('should return POI details by google_place_id', async () => {
    const poi = { osm_id: 123, google_place_id: 'ChIJ123' };
    const db = createMockDb({ getPOIDetails: async () => poi });
    const result = await executeToolHandler('get_poi_details', { google_place_id: 'ChIJ123' }, db);
    const parsed = parseResponse(result);
    assert.ok(parsed.google_place_id);
  });

  it('get_poi_details_ui should return structuredContent with _html', async () => {
    const poi = {
      osm_id: 123, osm_name: 'Test Hotel', poi_type: 'hotel',
      osm_latitude: 40.7, osm_longitude: -73.9,
    };
    const db = createMockDb({
      getPOIDetails: async () => poi,
      searchPOIsNearCoordinates: async () => [],
    });
    const result = await executeToolHandler('get_poi_details_ui', { osm_id: 123 }, db);
    assert.ok(result.structuredContent);
    assert.ok(result.structuredContent._html);
  });
});

// =============================================================================
// get_nearby_pois
// =============================================================================

describe('executeToolHandler: get_nearby_pois', () => {
  it('should return error when no osm_id', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('get_nearby_pois', {}, db);
    assert.strictEqual(result.isError, true);
    const parsed = parseResponse(result);
    assert.ok(parsed.error);
  });

  it('should return error when source POI not found', async () => {
    const db = createMockDb({ getPOIDetails: async () => null });
    const result = await executeToolHandler('get_nearby_pois', { osm_id: 999 }, db);
    assert.strictEqual(result.isError, true);
  });

  it('should return nearby POIs', async () => {
    const source = { osm_id: 1, osm_name: 'Hotel', poi_type: 'hotel', osm_latitude: 40.7, osm_longitude: -73.9 };
    const nearby = [{ osm_id: 2, osm_name: 'Restaurant' }];
    const db = createMockDb({
      getPOIDetails: async () => source,
      searchPOIsNearCoordinates: async () => nearby,
    });
    const result = await executeToolHandler('get_nearby_pois', { osm_id: 1 }, db);
    const parsed = parseResponse(result);
    assert.strictEqual(parsed.count, 1);
    assert.ok(parsed.nearby);
    assert.ok(parsed.source);
  });

  it('should enforce max radius of 10 and max limit of 20', async () => {
    let capturedRadius, capturedLimit;
    const source = { osm_id: 1, osm_name: 'Hotel', poi_type: 'hotel', osm_latitude: 40.7, osm_longitude: -73.9 };
    const db = createMockDb({
      getPOIDetails: async () => source,
      searchPOIsNearCoordinates: async (_lat, _lon, r, _types, l) => {
        capturedRadius = r;
        capturedLimit = l;
        return [];
      },
    });
    await executeToolHandler('get_nearby_pois', { osm_id: 1, radius_km: 50, limit: 100 }, db);
    assert.strictEqual(capturedRadius, 10);
    assert.strictEqual(capturedLimit, 20);
  });

  it('should accept custom result_types', async () => {
    let capturedTypes;
    const source = { osm_id: 1, osm_name: 'Hotel', poi_type: 'hotel', osm_latitude: 40.7, osm_longitude: -73.9 };
    const db = createMockDb({
      getPOIDetails: async () => source,
      searchPOIsNearCoordinates: async (_lat, _lon, _r, types) => {
        capturedTypes = types;
        return [];
      },
    });
    await executeToolHandler('get_nearby_pois', { osm_id: 1, result_types: ['museum', 'cafe'] }, db);
    assert.deepStrictEqual(capturedTypes, ['museum', 'cafe']);
  });

  it('get_nearby_pois_ui should return structuredContent with _html', async () => {
    const source = { osm_id: 1, osm_name: 'Hotel', poi_type: 'hotel', osm_latitude: 40.7, osm_longitude: -73.9 };
    const db = createMockDb({
      getPOIDetails: async () => source,
      searchPOIsNearCoordinates: async () => [{ osm_id: 2, osm_name: 'Cafe' }],
    });
    const result = await executeToolHandler('get_nearby_pois_ui', { osm_id: 1 }, db);
    assert.ok(result.structuredContent);
    assert.ok(result.structuredContent._html);
    assert.strictEqual(result.structuredContent.count, 1);
  });
});

// =============================================================================
// get_stats
// =============================================================================

describe('executeToolHandler: get_stats', () => {
  it('should return stats', async () => {
    const stats = { total_pois: 1000, total_cities: 500 };
    const db = createMockDb({ getStats: async () => stats });
    const result = await executeToolHandler('get_stats', {}, db);
    const parsed = parseResponse(result);
    assert.strictEqual(parsed.total_pois, 1000);
  });
});

// =============================================================================
// whoami
// =============================================================================

describe('executeToolHandler: whoami', () => {
  it('should return unauthenticated when no user', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('whoami', {}, db);
    const parsed = parseResponse(result);
    assert.strictEqual(parsed.authenticated, false);
  });

  it('should return user info when authenticated', async () => {
    const db = createMockDb();
    const user = { id: 1, email: 'test@example.com', name: 'Test User', picture_url: null, config: {}, created_at: '2024-01-01', last_login_at: null };
    const result = await executeToolHandler('whoami', {}, db, { user });
    const parsed = parseResponse(result);
    assert.strictEqual(parsed.authenticated, true);
    assert.strictEqual(parsed.email, 'test@example.com');
    // Null fields should be stripped
    assert.strictEqual(parsed.picture_url, undefined);
    assert.strictEqual(parsed.last_login_at, undefined);
  });

  it('should include parsed preferences when authenticated', async () => {
    const db = createMockDb();
    const user = {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      config: {
        currency: 'THB',
        language: 'th',
        home_location: '{"city_name":"Bangkok","country_code":"TH"}',
      },
    };
    const result = await executeToolHandler('whoami', {}, db, { user });
    const parsed = parseResponse(result);
    assert.deepStrictEqual(parsed.preferences, {
      currency: 'THB',
      language: 'th',
      home_location: { city_name: 'Bangkok', country_code: 'TH' },
    });
  });
});

// =============================================================================
// user preferences
// =============================================================================

describe('executeToolHandler: user preferences', () => {
  const user = { id: 1, email: 'test@example.com', config: { currency: 'EUR' } };

  it('should require authentication for get_user_preferences', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('get_user_preferences', {}, db);
    assert.strictEqual(result.isError, true);
  });

  it('should get user preferences', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('get_user_preferences', {}, db, { user });
    const parsed = parseResponse(result);
    assert.deepStrictEqual(parsed, { currency: 'EUR' });
  });

  it('should save normalized user preferences', async () => {
    const writes = [];
    const db = createMockDb({
      setUserConfig: async (userId, key, value) => writes.push({ userId, key, value }),
    });

    const result = await executeToolHandler('set_user_preferences', {
      currency: 'usd',
      language: 'en-us',
      home_location: { city_name: 'New York', country_code: 'us' },
    }, db, { user: { id: 1, email: 'test@example.com', config: {} } });
    const parsed = parseResponse(result);

    assert.strictEqual(parsed.success, true);
    assert.deepStrictEqual(parsed.preferences, {
      currency: 'USD',
      language: 'en-US',
      home_location: { city_name: 'New York', country_code: 'US' },
    });
    assert.deepStrictEqual(writes, [
      { userId: 1, key: 'currency', value: 'USD' },
      { userId: 1, key: 'language', value: 'en-US' },
      { userId: 1, key: 'home_location', value: '{"city_name":"New York","country_code":"US"}' },
    ]);
  });

  it('should reject invalid preference values', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('set_user_preferences', { currency: 'US' }, db, { user });
    assert.strictEqual(result.isError, true);
    assert.match(parseResponse(result).error, /3-letter/);
  });
});

// =============================================================================
// favorites
// =============================================================================

describe('executeToolHandler: favorites', () => {
  const user = { id: 1, email: 'test@example.com' };

  describe('add_favorite', () => {
    it('should require authentication', async () => {
      const db = createMockDb();
      const result = await executeToolHandler('add_favorite', { osm_id: 123 }, db);
      assert.strictEqual(result.isError, true);
    });

    it('should add favorite successfully', async () => {
      const db = createMockDb({ addFavorite: async () => true });
      const result = await executeToolHandler('add_favorite', { osm_id: 123 }, db, { user });
      const parsed = parseResponse(result);
      assert.strictEqual(parsed.success, true);
    });

    it('should return error when POI not found', async () => {
      const db = createMockDb({ addFavorite: async () => false });
      const result = await executeToolHandler('add_favorite', { osm_id: 999 }, db, { user });
      assert.strictEqual(result.isError, true);
    });
  });

  describe('remove_favorite', () => {
    it('should require authentication', async () => {
      const db = createMockDb();
      const result = await executeToolHandler('remove_favorite', { osm_id: 123 }, db);
      assert.strictEqual(result.isError, true);
    });

    it('should remove favorite', async () => {
      const db = createMockDb({ removeFavorite: async () => true });
      const result = await executeToolHandler('remove_favorite', { osm_id: 123 }, db, { user });
      const parsed = parseResponse(result);
      assert.strictEqual(parsed.success, true);
    });

    it('should handle not-found favorite', async () => {
      const db = createMockDb({ removeFavorite: async () => false });
      const result = await executeToolHandler('remove_favorite', { osm_id: 999 }, db, { user });
      const parsed = parseResponse(result);
      assert.strictEqual(parsed.success, false);
      assert.ok(parsed.message.includes('not found'));
    });
  });

  describe('list_favorites', () => {
    it('should require authentication', async () => {
      const db = createMockDb();
      const result = await executeToolHandler('list_favorites', {}, db);
      assert.strictEqual(result.isError, true);
    });

    it('should list favorites', async () => {
      const favs = [{ osm_id: 1, osm_name: 'Hotel' }];
      const db = createMockDb({ listFavorites: async () => favs });
      const result = await executeToolHandler('list_favorites', {}, db, { user });
      const parsed = parseResponse(result);
      assert.strictEqual(parsed.count, 1);
      assert.deepStrictEqual(parsed.favorites, favs);
    });

    it('should pass filter parameters', async () => {
      let capturedOpts;
      const db = createMockDb({
        listFavorites: async (_userId, opts) => { capturedOpts = opts; return []; },
      });
      await executeToolHandler('list_favorites', {
        city_name: 'NYC', country_code: 'US', poi_types: ['hotel'],
      }, db, { user });
      assert.strictEqual(capturedOpts.cityName, 'NYC');
      assert.strictEqual(capturedOpts.countryCode, 'US');
      assert.deepStrictEqual(capturedOpts.poiTypes, ['hotel']);
    });
  });
});

// =============================================================================
// unknown tool
// =============================================================================

describe('executeToolHandler: unknown', () => {
  it('should return error for unknown tool', async () => {
    const db = createMockDb();
    const result = await executeToolHandler('nonexistent_tool', {}, db);
    assert.strictEqual(result.isError, true);
    const parsed = parseResponse(result);
    assert.ok(parsed.error.includes('Unknown tool'));
  });
});

// =============================================================================
// handleReadResource
// =============================================================================

describe('handleReadResource', () => {
  it('should handle info://version', async () => {
    const db = createMockDb();
    const result = await handleReadResource('info://version', db, render);
    assert.ok(result.contents);
    assert.strictEqual(result.contents[0].uri, 'info://version');
    assert.strictEqual(result.contents[0].mimeType, 'application/json');
    const parsed = JSON.parse(result.contents[0].text);
    assert.ok('version' in parsed || 'gitHash' in parsed || 'name' in parsed);
  });

  it('should handle info://random-poi', async () => {
    const db = createMockDb({ getServerBaseUrl: async () => 'https://mcp.example.com' });
    const result = await handleReadResource('info://random-poi', db, render);
    const parsed = JSON.parse(result.contents[0].text);
    assert.ok(parsed.url.includes('/preview/poi/random'));
    assert.ok(parsed.url.startsWith('https://mcp.example.com'));
  });

  it('should handle info://random-poi with trailing slash', async () => {
    const db = createMockDb({ getServerBaseUrl: async () => 'https://mcp.example.com/' });
    const result = await handleReadResource('info://random-poi', db, render);
    const parsed = JSON.parse(result.contents[0].text);
    // Should not have double slashes
    assert.ok(!parsed.url.includes('//preview'));
  });

  it('should handle samples://queries', async () => {
    const db = createMockDb();
    const result = await handleReadResource('samples://queries', db, render);
    assert.strictEqual(result.contents[0].mimeType, 'application/json');
    const parsed = JSON.parse(result.contents[0].text);
    assert.ok(parsed.examples);
    assert.ok(Array.isArray(parsed.examples));
    assert.ok(parsed.workflow_tips);
  });

  it('should handle ui://widget/poi-details.html', async () => {
    const db = createMockDb({ getServerBaseUrl: async () => 'https://mcp.example.com' });
    const result = await handleReadResource('ui://widget/poi-details.html', db, render);
    assert.strictEqual(result.contents[0].mimeType, MCP_APP_HTML_MIME_TYPE);
    assert.ok(result.contents[0].text.includes('<'));
    assert.strictEqual(result.contents[0]._meta['openai/widgetDomain'], 'https://mcp.example.com');
  });

  it('should handle ui://widget/search-results.html', async () => {
    const db = createMockDb({ getServerBaseUrl: async () => 'https://mcp.example.com' });
    const result = await handleReadResource('ui://widget/search-results.html', db, render);
    assert.strictEqual(result.contents[0].mimeType, MCP_APP_HTML_MIME_TYPE);
    assert.strictEqual(result.contents[0]._meta['openai/widgetDomain'], 'https://mcp.example.com');
  });

  it('should handle ui://widget/nearby-pois.html', async () => {
    const db = createMockDb({ getServerBaseUrl: async () => 'https://mcp.example.com' });
    const result = await handleReadResource('ui://widget/nearby-pois.html', db, render);
    assert.strictEqual(result.contents[0].mimeType, MCP_APP_HTML_MIME_TYPE);
    assert.strictEqual(result.contents[0]._meta['openai/widgetDomain'], 'https://mcp.example.com');
  });

  it('should handle ui://host/poi/{osm_id} for existing POI', async () => {
    const poi = {
      osm_id: 123, osm_name: 'Test Hotel', poi_type: 'hotel',
      osm_latitude: 40.7, osm_longitude: -73.9,
    };
    const db = createMockDb({
      getServerBaseUrl: async () => 'https://mcp.example.com',
      getPOIDetails: async () => poi,
      searchPOIsNearCoordinates: async () => [],
    });
    const result = await handleReadResource('ui://mcp.example.com/poi/123', db, render);
    assert.strictEqual(result.contents[0].mimeType, MCP_APP_HTML_MIME_TYPE);
    assert.ok(result.contents[0].text.includes('Test Hotel'));
    assert.strictEqual(result.contents[0]._meta['openai/widgetDomain'], 'https://mcp.example.com');
  });

  it('should handle ui://host/poi/{osm_id} for missing POI', async () => {
    const db = createMockDb({
      getServerBaseUrl: async () => 'https://mcp.example.com',
      getPOIDetails: async () => null,
    });
    const result = await handleReadResource('ui://mcp.example.com/poi/999', db, render);
    assert.strictEqual(result.contents[0].mimeType, MCP_APP_HTML_MIME_TYPE);
    assert.ok(result.contents[0].text.includes('Not Found') || result.contents[0].text.includes('999'));
    assert.strictEqual(result.contents[0]._meta['openai/widgetDomain'], 'https://mcp.example.com');
  });

  it('should throw for unknown URI', async () => {
    const db = createMockDb();
    await assert.rejects(
      () => handleReadResource('unknown://something', db, render),
      /Unknown resource/,
    );
  });
});
