/**
 * MCP Tools Configuration
 * Single source of truth for tool definitions and handlers
 * Used by both stdio (index.js) and HTTP (index-http.js) servers
 */

// Shared constants
export const accommodationTypes = ['hotel', 'hostel', 'guest_house', 'motel', 'resort', 'apartment', 'bed_and_breakfast'];
export const foodTypes = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'];

// Tool definitions
export const toolsConfig = [
  {
    name: 'search_cities',
    description: 'Search for cities by name. Optionally filter by country code. Returns city information including coordinates, population, and timezone.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'City name to search for',
        },
        country_code: {
          type: 'string',
          description: 'Optional 2-letter country code (e.g., "TH", "US") to narrow results',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_hotels',
    description: 'Search for accommodations (hotels, hostels, guesthouses, motels, resorts, apartments, B&Bs) by name AND/OR location. Supports: (1) name only, (2) location only (city or coordinates), or (3) both combined.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional hotel name to search for (fuzzy matching)',
        },
        city_name: {
          type: 'string',
          description: 'Optional city name to search in (use with country_code to narrow results)',
        },
        country_code: {
          type: 'string',
          description: 'Optional 2-letter country code (e.g., "TH") - only used WITH city_name, not with coordinates',
        },
        latitude: {
          type: 'number',
          description: 'Optional latitude coordinate (must be used WITH longitude)',
        },
        longitude: {
          type: 'number',
          description: 'Optional longitude coordinate (must be used WITH latitude)',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers when using coordinates (default: 15)',
          default: 15,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'search_restaurants',
    description: 'Search for food & drink establishments (restaurants, cafes, bars, fast food, etc.) by name AND/OR location. Supports: (1) name only, (2) location only (city or coordinates), or (3) both combined. Examples: "starbucks", "restaurants in Bangkok", "starbucks in Bangkok".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional name to search for (fuzzy matching) - works for restaurants, cafes, bars, etc.',
        },
        city_name: {
          type: 'string',
          description: 'Optional city name to search in (use with country_code to narrow results)',
        },
        country_code: {
          type: 'string',
          description: 'Optional 2-letter country code (e.g., "TH") - only used WITH city_name, not with coordinates',
        },
        latitude: {
          type: 'number',
          description: 'Optional latitude coordinate (must be used WITH longitude)',
        },
        longitude: {
          type: 'number',
          description: 'Optional longitude coordinate (must be used WITH latitude)',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers when using coordinates (default: 15)',
          default: 15,
        },
        type: {
          type: 'string',
          description: 'Optional type filter: "restaurant", "cafe", "bar", "pub", "fast_food", "food_court". If not specified, searches all food & drink types.',
          enum: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'search_pois',
    description: 'Search for Points of Interest (attractions, monuments, museums, cafes, bars, etc.) by name AND/OR location. Supports: (1) name only, (2) location only, or (3) both combined. Examples: "democracy monument", "attractions in Bangkok", "grand palace in Bangkok".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional POI name to search for (fuzzy matching)',
        },
        city_name: {
          type: 'string',
          description: 'Optional city name to search in (use with country_code to narrow results)',
        },
        country_code: {
          type: 'string',
          description: 'Optional 2-letter country code (e.g., "TH") - only used WITH city_name, not with coordinates',
        },
        latitude: {
          type: 'number',
          description: 'Optional latitude coordinate (must be used WITH longitude)',
        },
        longitude: {
          type: 'number',
          description: 'Optional longitude coordinate (must be used WITH latitude)',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers when using coordinates (default: 15)',
          default: 15,
        },
        poi_type: {
          type: 'string',
          description: 'Optional POI type filter: attraction, monument, museum, viewpoint, cafe, bar, place_of_worship, etc.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'get_poi_details',
    description: 'Get detailed information about a specific POI (hotel, restaurant, attraction, etc.) including Google Places enrichment data (ratings, reviews, photos, verified hours). Automatically triggers background enrichment from Google Places API if not already enriched. Provide either osm_id OR google_place_id.',
    inputSchema: {
      type: 'object',
      properties: {
        osm_id: {
          type: 'number',
          description: 'The OSM ID of the POI to get details for',
        },
        google_place_id: {
          type: 'string',
          description: 'The Google Places ID of the POI to get details for',
        },
      },
    },
  },
  {
    name: 'get_stats',
    description: 'Get database statistics including counts of countries, cities, POIs by type, and coverage by region',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Resource definitions
export const resourcesConfig = {
  resources: [
    {
      uri: 'ui://test-widget',
      name: 'Test MCP Apps Widget',
      description: 'A simple test widget to verify MCP Apps infrastructure',
      mimeType: 'text/html+skybridge',
    },
    {
      uri: 'ui://poi/random',
      name: 'Random POI',
      description: 'Shows a random POI from the database (for testing)',
      mimeType: 'text/html+skybridge',
    },
  ],
  resourceTemplates: [
    {
      uriTemplate: 'ui://poi/{osm_id}',
      name: 'POI Detail Page',
      description: 'Rich interactive page for a specific POI (hotel, restaurant, etc.)',
      mimeType: 'text/html+skybridge',
    },
  ],
};

/**
 * Helper to build content response for search results
 */
function buildSearchResponse(pois) {
  return {
    content: [{ type: 'text', text: JSON.stringify(pois, null, 2) }],
  };
}

/**
 * Execute a tool handler
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {object} db - Database instance
 * @param {object} options - Optional settings (e.g., previewUrlBase for HTTP server)
 * @returns {object} - MCP response content
 */
export async function executeToolHandler(name, args, db, options = {}) {
  switch (name) {
    case 'search_cities': {
      const cities = await db.searchCities(args.query, args.country_code, args.limit || 10);
      return {
        content: [{ type: 'text', text: JSON.stringify(cities, null, 2) }],
      };
    }

    case 'search_hotels': {
      const pois = await db.searchPOIs({
        name: args.query,
        cityName: args.city_name,
        countryCode: args.country_code,
        latitude: args.latitude,
        longitude: args.longitude,
        radius: args.radius_km,
        poiTypes: accommodationTypes,
        limit: args.limit || 50,
      });
      return buildSearchResponse(pois);
    }

    case 'search_restaurants': {
      const types = args.type ? [args.type] : foodTypes;
      const pois = await db.searchPOIs({
        name: args.query,
        cityName: args.city_name,
        countryCode: args.country_code,
        latitude: args.latitude,
        longitude: args.longitude,
        radius: args.radius_km,
        poiTypes: types,
        limit: args.limit || 50,
      });
      return buildSearchResponse(pois);
    }

    case 'search_pois': {
      const pois = await db.searchPOIs({
        name: args.query,
        cityName: args.city_name,
        countryCode: args.country_code,
        latitude: args.latitude,
        longitude: args.longitude,
        radius: args.radius_km,
        poiType: args.poi_type,
        limit: args.limit || 50,
      });
      return buildSearchResponse(pois);
    }

    case 'get_poi_details': {
      if (!args.osm_id && !args.google_place_id) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Either osm_id or google_place_id is required' }, null, 2),
            },
          ],
        };
      }

      const poi = await db.getPOIDetails(args.osm_id, args.google_place_id);

      if (!poi) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'POI not found',
                osm_id: args.osm_id || null,
                google_place_id: args.google_place_id || null,
              }, null, 2),
            },
          ],
        };
      }

      // Add preview URL if base is provided (HTTP server)
      if (options.previewUrlBase) {
        poi.preview_url = `${options.previewUrlBase}/preview/poi/${poi.osm_id}`;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(poi, null, 2) }],
      };
    }

    case 'get_stats': {
      const stats = await db.getStats();
      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Render POI details HTML (shared logic for all POI rendering)
 * @param {object} poi - POI object from database
 * @param {function} render - Template render function
 * @returns {string} - Rendered HTML
 */
export function renderPOIPreview(poi, render) {
  const opening_hours = poi.google_opening_hours?.weekdayDescriptions || null;
  const photo_url = poi.google_photos?.[0]?.url || null;
  const address = poi.osm_address || poi.google_address || '';
  const address_lines = address.split(',').map(s => s.trim()).filter(Boolean);

  // Computed flags for template conditionals
  const is_food = foodTypes.includes(poi.poi_type);
  const is_accommodation = accommodationTypes.includes(poi.poi_type);

  // Parse cuisine (stored as "thai;international;fusion" in OSM)
  const cuisine_list = poi.osm_cuisine
    ? poi.osm_cuisine.split(/[;,]/).map(c => c.trim().replace(/_/g, ' ')).filter(Boolean)
    : null;

  return render('poi-details', { ...poi, opening_hours, photo_url, address_lines, is_food, is_accommodation, cuisine_list });
}

/**
 * Handle reading a resource
 * @param {string} uri - Resource URI
 * @param {object} db - Database instance
 * @param {function} render - Template render function
 * @returns {object} - MCP resource contents
 */
export async function handleReadResource(uri, db, render) {
  // Test widget
  if (uri === 'ui://test-widget') {
    const html = render('test-widget', {
      title: 'Travel MCP Server',
      message: 'MCP Apps UI is working!',
    });
    return {
      contents: [{ uri, mimeType: 'text/html+skybridge', text: html }],
    };
  }

  // POI detail page: ui://poi/{osm_id}
  const poiMatch = uri.match(/^ui:\/\/poi\/(\d+)$/);
  if (poiMatch) {
    const osmId = parseInt(poiMatch[1], 10);
    const poi = await db.getPOIDetails(osmId);

    if (!poi) {
      const errorHtml = render('error', {
        title: 'POI Not Found',
        message: `No POI found with OSM ID: ${osmId}`,
        code: osmId,
      });
      return {
        contents: [{ uri, mimeType: 'text/html+skybridge', text: errorHtml }],
      };
    }

    return {
      contents: [{ uri, mimeType: 'text/html+skybridge', text: renderPOIPreview(poi, render) }],
    };
  }

  // Random POI: ui://poi/random
  if (uri === 'ui://poi/random') {
    const poi = await db.getRandomPOI();

    if (!poi) {
      const errorHtml = render('error', {
        title: 'No POIs Found',
        message: 'No POIs available in the database',
        code: 'EMPTY_DB',
      });
      return {
        contents: [{ uri, mimeType: 'text/html+skybridge', text: errorHtml }],
      };
    }

    return {
      contents: [{ uri, mimeType: 'text/html+skybridge', text: renderPOIPreview(poi, render) }],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
}
