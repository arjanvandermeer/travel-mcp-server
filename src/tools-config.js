/**
 * MCP Tools Configuration
 * Single source of truth for tool definitions and handlers
 * Used by both stdio (index.js) and HTTP (index-http.js) servers
 */

import { versionInfo } from './version.js';
import { render } from './templates/index.js';
import * as telemetry from './telemetry.js';
import { NEARBY_RADIUS_DEFAULT_KM, NEARBY_RADIUS_MAX_KM, NEARBY_LIMIT_DEFAULT, NEARBY_LIMIT_MAX } from './config.js';
import { validateCoordinates, validateLimit } from './validation.js';
import { accommodationTypes, fetchNearbyForPOI, foodTypes, getNearbyTypes, renderNearbyWidget, renderPOIPreview } from './poi-view-utils.js';

export { accommodationTypes, attractionTypes, fetchNearbyForPOI, foodTypes, getNearbyTitle, getNearbyTypes, isOpenNow, renderNearbyWidget, renderPOIPreview } from './poi-view-utils.js';

// =============================================================================
// MCP Prompts Configuration
// =============================================================================

/**
 * Prompt templates for common use cases
 * These help users discover and quickly use the server's capabilities
 */
export const promptsConfig = [
  {
    name: 'find_hotels_in_city',
    description: 'Search for hotels in a specific city',
    arguments: [
      {
        name: 'city',
        description: 'City name (e.g., "New York")',
        required: true,
      },
      {
        name: 'country_code',
        description: 'Two-letter country code (e.g., "US")',
        required: true,
      },
    ],
  },
  {
    name: 'find_restaurants_nearby',
    description: 'Find restaurants near a specific location using coordinates',
    arguments: [
      {
        name: 'latitude',
        description: 'Latitude coordinate',
        required: true,
      },
      {
        name: 'longitude',
        description: 'Longitude coordinate',
        required: true,
      },
      {
        name: 'radius_km',
        description: 'Search radius in kilometers (default: 1)',
        required: false,
      },
    ],
  },
  {
    name: 'find_attractions',
    description: 'Search for tourist attractions and points of interest',
    arguments: [
      {
        name: 'city',
        description: 'City name (e.g., "New York")',
        required: true,
      },
      {
        name: 'country_code',
        description: 'Two-letter country code (e.g., "US")',
        required: true,
      },
    ],
  },
  {
    name: 'explore_area',
    description: 'Explore all points of interest in an area - hotels, restaurants, and attractions',
    arguments: [
      {
        name: 'city',
        description: 'City name (e.g., "New York")',
        required: true,
      },
      {
        name: 'country_code',
        description: 'Two-letter country code (e.g., "US")',
        required: true,
      },
    ],
  },
  {
    name: 'find_near_landmark',
    description: 'Find restaurants or hotels near a specific landmark using two-step coordinate lookup',
    arguments: [
      {
        name: 'landmark',
        description: 'Landmark name (e.g., "Empire State Building", "Central Park")',
        required: true,
      },
      {
        name: 'search_type',
        description: 'What to search for: "restaurants", "hotels", or "both"',
        required: true,
      },
      {
        name: 'brand',
        description: 'Optional brand/chain name (e.g., "Starbucks", "Marriott")',
        required: false,
      },
    ],
  },
];

/**
 * Generate prompt messages based on prompt name and arguments
 * Returns the actual prompt content to send to the LLM
 */
export function getPromptMessages(name, args = {}) {
  switch (name) {
    case 'find_hotels_in_city':
      return {
        description: `Find hotels in ${args.city || 'the specified city'}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please search for hotels in ${args.city || 'New York'}, ${args.country_code || 'US'}. Show me the top results with their ratings and addresses.

Example: The Conrad New York Downtown on Vesey Street is a luxury hotel in Lower Manhattan.`,
            },
          },
        ],
      };

    case 'find_restaurants_nearby':
      return {
        description: `Find restaurants near coordinates (${args.latitude}, ${args.longitude})`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please search for restaurants near latitude ${args.latitude || '40.7580'} and longitude ${args.longitude || '-73.9855'} within ${args.radius_km || '1'} km. Show me the top results with their cuisine type and ratings.

Example: The Rainbow Room at 30 Rockefeller Plaza is an iconic fine dining restaurant in Midtown Manhattan.`,
            },
          },
        ],
      };

    case 'find_attractions':
      return {
        description: `Find tourist attractions in ${args.city || 'the specified city'}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please search for tourist attractions and points of interest in ${args.city || 'New York'}, ${args.country_code || 'US'}. Include museums, monuments, and landmarks.

Example: The Statue of Liberty on Liberty Island is one of the most famous attractions in New York.`,
            },
          },
        ],
      };

    case 'explore_area':
      return {
        description: `Explore ${args.city || 'the specified city'} - hotels, restaurants, and attractions`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please help me explore ${args.city || 'New York'}, ${args.country_code || 'US'}. I'd like to see:
1. Top hotels (e.g., Conrad New York Downtown on Vesey Street)
2. Best restaurants (e.g., The Rainbow Room at Rockefeller Center)
3. Must-see attractions (e.g., Statue of Liberty on Liberty Island)

Please search for each category and give me a summary of the best options.`,
            },
          },
        ],
      };

    case 'find_near_landmark':
      return {
        description: `Find ${args.search_type || 'places'}${args.brand ? ` (${args.brand})` : ''} near ${args.landmark || 'the landmark'}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please find ${args.brand ? args.brand + ' ' : ''}${args.search_type || 'restaurants'} near ${args.landmark || 'Empire State Building'}.

IMPORTANT: Use this two-step workflow:
1. First, use search_pois to find "${args.landmark || 'Empire State Building'}" and get its coordinates (osm_latitude, osm_longitude)
2. Then, use search_${args.search_type === 'hotels' ? 'hotels' : 'restaurants'} with those coordinates${args.brand ? ` and query="${args.brand}"` : ''}

This approach ensures accurate results by first resolving the landmark location, then searching nearby.`,
            },
          },
        ],
      };

    default:
      return {
        description: 'Unknown prompt',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Unknown prompt: ${name}. Available prompts: find_hotels_in_city, find_restaurants_nearby, find_attractions, explore_area, find_near_landmark`,
            },
          },
        ],
      };
  }
}

// Base tool definitions
const baseToolsConfig = [
  {
    name: 'search_cities',
    description: 'Search for cities. REQUIRES either country_code OR coordinates (latitude + longitude). Valid combinations: (1) query + country_code, (2) query + country_code + state, (3) query + lat/long, (4) country_code only, (5) country_code + state, (6) lat/long only. Returns city info with coordinates, population, timezone, country and state/province. Example: search for "New York" with country_code "US" to find New York City.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional city name to search for. If omitted, returns cities in the specified country/state or near coordinates.',
        },
        country_code: {
          type: 'string',
          description: '2-letter country code (e.g., "TH", "US"). Required if not using coordinates.',
        },
        state: {
          type: 'string',
          description: 'Optional state/province code (e.g., "NY", "CA") or full name (e.g., "New York", "California"). Works for US states and other countries with admin1 divisions.',
        },
        latitude: {
          type: 'number',
          description: 'Latitude coordinate. Required with longitude if not using country_code.',
        },
        longitude: {
          type: 'number',
          description: 'Longitude coordinate. Required with latitude if not using country_code.',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers when using coordinates (default: 50, max: 100)',
          default: 50,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10, max: 100)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'search_hotels',
    description: 'Search for accommodations (hotels, hostels, guesthouses, motels, resorts, apartments, B&Bs). Returns JSON results with coordinates, ratings, and details. REQUIRES either location (city_name or coordinates) OR query. Supports amenity filtering (e.g., wifi, pool, parking) and open_now. WORKFLOW TIP: To find hotels near a landmark, first use search_pois to get the landmark coordinates, then use search_hotels with those lat/long coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional hotel/brand name to search for (fuzzy matching). Works with brand names like "Marriott", "Hilton", "Holiday Inn" as well as specific hotel names.',
        },
        city_name: {
          type: 'string',
          description: 'City name to search in. Use with country_code to narrow results.',
        },
        country_code: {
          type: 'string',
          description: '2-letter country code (e.g., "TH", "US"). Used with city_name.',
        },
        state: {
          type: 'string',
          description: 'Optional state/province code (e.g., "NY") or full name. Use with country_code.',
        },
        latitude: {
          type: 'number',
          description: 'Latitude coordinate (must be used WITH longitude)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude coordinate (must be used WITH latitude)',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers when using coordinates (default: 15, max: 50)',
          default: 15,
        },
        amenities: {
          type: 'array',
          items: { type: 'string', enum: ['wifi', 'pool', 'parking', 'breakfast', 'air_conditioning', 'pet_friendly', 'restaurant', 'spa', 'gym', 'bar', 'elevator'] },
          description: 'Filter by required amenities. Multiple values use AND logic (must have all). Based on OSM tags. Examples: ["wifi", "pool"], ["breakfast", "parking"].',
        },
        open_now: {
          type: 'boolean',
          description: 'If true, only return hotels that are currently open/accepting guests (based on Google Places hours). POIs without hours data are excluded.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50, max: 100)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'search_hotels_ui',
    description: 'Search for accommodations with interactive UI card. Same as search_hotels but renders results in a clickable card interface. Supports amenity and open_now filters.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Hotel/brand name to search (fuzzy). Works with chains like "Marriott", "Hilton".' },
        city_name: { type: 'string', description: 'City name to search in. Use with country_code.' },
        country_code: { type: 'string', description: '2-letter country code (e.g., "TH", "US").' },
        state: { type: 'string', description: 'Optional state/province code or full name.' },
        latitude: { type: 'number', description: 'Latitude coordinate (must be used WITH longitude)' },
        longitude: { type: 'number', description: 'Longitude coordinate (must be used WITH latitude)' },
        radius_km: { type: 'number', description: 'Search radius in km (default: 15, max: 50)', default: 15 },
        amenities: { type: 'array', items: { type: 'string', enum: ['wifi', 'pool', 'parking', 'breakfast', 'air_conditioning', 'pet_friendly', 'restaurant', 'spa', 'gym', 'bar', 'elevator'] }, description: 'Amenity filter. AND logic.' },
        open_now: { type: 'boolean', description: 'Only return currently open hotels.' },
        limit: { type: 'number', description: 'Max results (default: 50, max: 100)', default: 50 },
      },
    },
    _meta: {
      ui: { resourceUri: 'ui://widget/search-results.html' },
      'openai/toolInvocation/invoking': 'Searching...',
      'openai/toolInvocation/invoked': 'Results ready.',
    },
  },
  {
    name: 'search_restaurants',
    description: 'Search for food & drink (restaurants, cafes, bars, fast food, coffee shops, etc.). Returns JSON results with coordinates, ratings, cuisine, and details. REQUIRES either location (city_name or coordinates) OR query. Valid combinations: (1) query only - global name search, (2) city_name + country_code, (3) city_name + country_code + state, (4) lat/long - search near coordinates, (5) query + any location - combine name filter with location. Supports cuisine filtering (e.g., "thai", "italian"), dietary restrictions (e.g., "vegan", "halal"), and open_now to find currently open places. WORKFLOW TIP: To find a chain restaurant near a landmark, first use search_pois to get the landmark coordinates, then use search_restaurants with those lat/long coordinates and query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional restaurant/brand name to search for (fuzzy matching). Works with chain brands like "Starbucks", "McDonald\'s", "Chipotle" as well as specific restaurant names like "Rainbow Room".',
        },
        city_name: {
          type: 'string',
          description: 'City name to search in. Use with country_code to narrow results.',
        },
        country_code: {
          type: 'string',
          description: '2-letter country code (e.g., "TH", "US"). Used with city_name.',
        },
        state: {
          type: 'string',
          description: 'Optional state/province code (e.g., "NY") or full name. Use with country_code.',
        },
        latitude: {
          type: 'number',
          description: 'Latitude coordinate (must be used WITH longitude)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude coordinate (must be used WITH latitude)',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers when using coordinates (default: 15, max: 50)',
          default: 15,
        },
        type: {
          type: 'string',
          description: 'Optional type filter: "restaurant", "cafe", "bar", "pub", "fast_food", "food_court". If not specified, searches all food & drink types.',
          enum: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'],
        },
        cuisine: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by cuisine type(s). Examples: ["thai"], ["italian", "pizza"], ["sushi", "japanese"], ["indian"], ["mexican"]. Matches against OSM cuisine data. Multiple values use OR logic (matches any).',
        },
        dietary: {
          type: 'array',
          items: { type: 'string', enum: ['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'organic', 'lactose_free'] },
          description: 'Filter by dietary restriction support. Multiple values use AND logic (must support all). Based on OSM dietary tags.',
        },
        open_now: {
          type: 'boolean',
          description: 'If true, only return restaurants that are currently open (based on Google Places opening hours data). POIs without hours data are excluded.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50, max: 100)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'search_restaurants_ui',
    description: 'Search for food & drink with interactive UI card. Same as search_restaurants but renders results in a clickable card interface. Supports cuisine, dietary, and open_now filters.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Restaurant/brand name to search (fuzzy). Works with chains like "Starbucks", "McDonald\'s", "Chipotle".' },
        city_name: { type: 'string', description: 'City name to search in. Use with country_code.' },
        country_code: { type: 'string', description: '2-letter country code (e.g., "TH", "US").' },
        state: { type: 'string', description: 'Optional state/province code or full name.' },
        latitude: { type: 'number', description: 'Latitude coordinate (must be used WITH longitude)' },
        longitude: { type: 'number', description: 'Longitude coordinate (must be used WITH latitude)' },
        radius_km: { type: 'number', description: 'Search radius in km (default: 15, max: 50)', default: 15 },
        type: { type: 'string', description: 'Type filter', enum: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'] },
        cuisine: { type: 'array', items: { type: 'string' }, description: 'Cuisine filter (e.g., ["thai", "italian"]). OR logic.' },
        dietary: { type: 'array', items: { type: 'string', enum: ['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'organic', 'lactose_free'] }, description: 'Dietary restriction filter. AND logic.' },
        open_now: { type: 'boolean', description: 'Only return currently open restaurants.' },
        limit: { type: 'number', description: 'Max results (default: 50, max: 100)', default: 50 },
      },
    },
    _meta: {
      ui: { resourceUri: 'ui://widget/search-results.html' },
      'openai/toolInvocation/invoking': 'Searching...',
      'openai/toolInvocation/invoked': 'Results ready.',
    },
  },
  {
    name: 'search_pois',
    description: 'Search for Points of Interest (attractions, monuments, museums, landmarks, buildings, etc.). Returns JSON results with coordinates (osm_latitude, osm_longitude), ratings, and details. REQUIRES either location (city_name or coordinates) OR query. Valid combinations: (1) query only - global name search, (2) city_name + country_code, (3) city_name + country_code + state, (4) lat/long - search near coordinates, (5) query + any location. IMPORTANT: Use this tool to get coordinates of landmarks, then use those coordinates with search_hotels or search_restaurants to find places nearby. Example workflow: search_pois(query="Empire State Building") returns coordinates, then search_restaurants(latitude=40.748, longitude=-73.985, query="Starbucks") finds nearby Starbucks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'POI/landmark name to search for (fuzzy matching). Use this to find landmarks like "Empire State Building", "Central Park", "Times Square" and get their coordinates for subsequent searches.',
        },
        city_name: {
          type: 'string',
          description: 'City name to search in. Use with country_code to narrow results.',
        },
        country_code: {
          type: 'string',
          description: '2-letter country code (e.g., "TH", "US"). Used with city_name.',
        },
        state: {
          type: 'string',
          description: 'Optional state/province code (e.g., "NY") or full name. Use with country_code.',
        },
        latitude: {
          type: 'number',
          description: 'Latitude coordinate (must be used WITH longitude)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude coordinate (must be used WITH latitude)',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers when using coordinates (default: 15, max: 50)',
          default: 15,
        },
        poi_type: {
          type: 'string',
          description: 'Optional POI type filter: attraction, monument, museum, viewpoint, cafe, bar, place_of_worship, etc.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50, max: 100)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'search_pois_ui',
    description: 'Search for Points of Interest with interactive UI card. Same as search_pois but renders results in a clickable card interface. Use this to find landmarks and get their coordinates for subsequent hotel/restaurant searches nearby.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Landmark/POI name to search (fuzzy). Use to get coordinates of places like "Empire State Building", "Central Park".' },
        city_name: { type: 'string', description: 'City name to search in. Use with country_code.' },
        country_code: { type: 'string', description: '2-letter country code (e.g., "TH", "US").' },
        state: { type: 'string', description: 'Optional state/province code or full name.' },
        latitude: { type: 'number', description: 'Latitude coordinate (must be used WITH longitude)' },
        longitude: { type: 'number', description: 'Longitude coordinate (must be used WITH latitude)' },
        radius_km: { type: 'number', description: 'Search radius in km (default: 15, max: 50)', default: 15 },
        poi_type: { type: 'string', description: 'POI type filter: attraction, monument, museum, viewpoint, etc.' },
        limit: { type: 'number', description: 'Max results (default: 50, max: 100)', default: 50 },
      },
    },
    _meta: {
      ui: { resourceUri: 'ui://widget/search-results.html' },
      'openai/toolInvocation/invoking': 'Searching...',
      'openai/toolInvocation/invoked': 'Results ready.',
    },
  },
  {
    name: 'get_poi_details',
    description: 'Get detailed information about a specific POI (hotel, restaurant, attraction, etc.) including Google Places enrichment data (ratings, reviews, photos, verified hours). Returns JSON. Automatically triggers background enrichment from Google Places API if not already enriched. Provide either osm_id OR google_place_id.',
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
    name: 'get_poi_details_ui',
    description: 'Get POI details with interactive UI card. Same as get_poi_details but renders in a rich detail page.',
    inputSchema: {
      type: 'object',
      properties: {
        osm_id: { type: 'number', description: 'The OSM ID of the POI' },
        google_place_id: { type: 'string', description: 'The Google Places ID of the POI' },
      },
    },
    _meta: {
      ui: { resourceUri: 'ui://widget/poi-details.html' },
      'openai/toolInvocation/invoking': 'Loading details...',
      'openai/toolInvocation/invoked': 'Details ready.',
    },
  },
  {
    name: 'get_nearby_pois',
    description: 'Get POIs near a given POI. For hotels/accommodation returns nearby restaurants by default; for restaurants/food returns nearby hotels. Override with result_types parameter.',
    inputSchema: {
      type: 'object',
      properties: {
        osm_id: { type: 'number', description: 'The OSM ID of the source POI to find nearby places for' },
        result_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override which POI types to return (e.g., ["restaurant", "cafe"]). If omitted, defaults based on source POI type.',
        },
        radius_km: { type: 'number', description: 'Search radius in km (default: 1.5, max: 10)' },
        limit: { type: 'number', description: 'Max results (default: 10, max: 20)' },
      },
      required: ['osm_id'],
    },
  },
  {
    name: 'get_nearby_pois_ui',
    description: 'Get nearby POIs with interactive UI. Same as get_nearby_pois but renders as horizontal scrollable cards.',
    inputSchema: {
      type: 'object',
      properties: {
        osm_id: { type: 'number', description: 'The OSM ID of the source POI' },
        result_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override which POI types to show nearby',
        },
        radius_km: { type: 'number', description: 'Search radius in km (default: 1.5, max: 10)' },
        limit: { type: 'number', description: 'Max results (default: 10, max: 20)' },
      },
      required: ['osm_id'],
    },
    _meta: {
      ui: { resourceUri: 'ui://widget/nearby-pois.html' },
      'openai/toolInvocation/invoking': 'Finding nearby places...',
      'openai/toolInvocation/invoked': 'Nearby places ready.',
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
  {
    name: 'whoami',
    description: 'Check authentication status and get current user info. Returns user details if authenticated, or { authenticated: false } for anonymous sessions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // =========================================================================
  // Favorites (requires authentication)
  // =========================================================================
  {
    name: 'add_favorite',
    description: 'Add a POI (hotel, restaurant, attraction) to your favorites. Requires authentication. Returns the saved favorite with full POI details.',
    inputSchema: {
      type: 'object',
      properties: {
        osm_id: {
          type: 'number',
          description: 'The OSM ID of the POI to add to favorites',
        },
        notes: {
          type: 'string',
          description: 'Optional notes about this favorite (e.g., "Great rooftop bar", "Book corner room")',
        },
      },
      required: ['osm_id'],
    },
  },
  {
    name: 'remove_favorite',
    description: 'Remove a POI from your favorites. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        osm_id: {
          type: 'number',
          description: 'The OSM ID of the POI to remove from favorites',
        },
      },
      required: ['osm_id'],
    },
  },
  {
    name: 'list_favorites',
    description: 'List your saved favorites with optional filters. Requires authentication. Returns full POI details for each favorite. Can filter by location (city or coordinates) and/or POI type.',
    inputSchema: {
      type: 'object',
      properties: {
        city_name: {
          type: 'string',
          description: 'Filter favorites by city name',
        },
        country_code: {
          type: 'string',
          description: '2-letter country code (e.g., "US", "TH"). Required with city_name.',
        },
        state: {
          type: 'string',
          description: 'Optional state/province filter (e.g., "NY", "California")',
        },
        latitude: {
          type: 'number',
          description: 'Center latitude for radius search (use with longitude)',
        },
        longitude: {
          type: 'number',
          description: 'Center longitude for radius search (use with latitude)',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in km when using coordinates (default: 50)',
          default: 50,
        },
        poi_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by POI types (e.g., ["restaurant", "hotel", "cafe"])',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 100, max: 100)',
          default: 100,
        },
      },
    },
  },
];

/**
 * Get tools configuration with dynamic widget domain for UI tools
 * Adds CSP and domain to any tool that has ui.resourceUri
 * @param {string} widgetDomain - Full URL from server_base_url config
 * @returns {Array} - Tools config with CSP/domain added to UI tools
 */
export function getToolsConfig(widgetDomain) {
  return baseToolsConfig.map(tool => {
    // If tool has ui.resourceUri, add CSP and domain
    if (tool._meta?.ui?.resourceUri) {
      const csp = {
        connectDomains: ['https://chatgpt.com', widgetDomain],
        resourceDomains: [widgetDomain, 'https://*.oaistatic.com'],
        frameDomains: [],
      };
      return {
        ...tool,
        _meta: {
          ...tool._meta,
          'openai/outputTemplate': tool._meta.ui.resourceUri,
          'openai/widgetDomain': widgetDomain,
          'openai/widgetCSP': {
            connect_domains: csp.connectDomains,
            resource_domains: csp.resourceDomains,
            frame_domains: csp.frameDomains,
          },
          ui: {
            ...tool._meta.ui,
            domain: widgetDomain,
            csp,
          },
        },
      };
    }
    return tool;
  });
}

// Resource definitions
/**
 * MCP Resources Configuration
 *
 * Resources use custom URI protocols to distinguish different content types:
 *
 * - info:// - Informational JSON resources (version info, config, links)
 * - ui://   - User interface resources (HTML pages for display)
 *
 * The ui:// protocol resources include the server host in the URI:
 *   ui://{host}/poi/{osm_id}
 *   Example: ui://travel.arjanvandermeer.com/poi/1313852747
 *
 * This allows MCP clients to:
 * 1. Recognize these as displayable content (not raw data)
 * 2. Match resources to the correct server in multi-server scenarios
 */

/**
 * Get resources configuration with dynamic widget domain
 * @param {string} widgetDomain - Full URL from server_base_url config (e.g., "https://travel.arjanvandermeer.com")
 * @returns {object} - MCP resources configuration
 */
export function getResourcesConfig(widgetDomain) {
  const buildWidgetMeta = (frameDomains = []) => buildOpenAIWidgetMeta(widgetDomain, frameDomains);

  return {
    // Static resources - fixed URIs that always return the same type of content
    resources: [
      {
        uri: 'info://version',
        name: 'Server Version',
        description: 'Returns server version info including git commit hash',
        mimeType: 'application/json',
      },
      {
        uri: 'info://random-poi',
        name: 'Random POI Preview',
        description: 'Returns a link to view a random POI in the browser',
        mimeType: 'application/json',
      },
      {
        uri: 'samples://queries',
        name: 'Sample Queries',
        description: 'Example queries to help you get started with the travel MCP server. Includes sample searches for hotels, restaurants, and attractions in New York City.',
        mimeType: 'application/json',
      },
    ],
    // Resource templates for ChatGPT Apps SDK widgets
    // These are referenced by tools via _meta.ui.resourceUri
    // MIME type text/html+skybridge signals ChatGPT to treat as a sandboxed widget
    resourceTemplates: [
      {
        uriTemplate: 'ui://widget/poi-details.html',
        name: 'POI Details Widget',
        description: 'Rich interactive page for a specific POI (hotel, restaurant, etc.)',
        mimeType: 'text/html+skybridge',
        _meta: buildWidgetMeta([]),
      },
      {
        uriTemplate: 'ui://widget/search-results.html',
        name: 'Search Results Widget',
        description: 'Interactive list of search results. Renders tool output as clickable cards.',
        mimeType: 'text/html+skybridge',
        _meta: buildWidgetMeta([]),
      },
      {
        uriTemplate: 'ui://widget/nearby-pois.html',
        name: 'Nearby POIs Widget',
        description: 'Horizontal scrollable cards showing nearby points of interest.',
        mimeType: 'text/html+skybridge',
        _meta: buildWidgetMeta([]),
      },
      {
        uriTemplate: 'ui://poi/{osm_id}',
        name: 'POI Detail Page (by ID)',
        description: 'POI detail page accessed by OSM ID - used when clicking search results.',
        mimeType: 'text/html+skybridge',
        _meta: buildWidgetMeta([]),
      },
    ],
  };
}

/**
 * Helper to build content response for search results
 *
 * Returns both:
 * - content: Text representation for model narration
 * - structuredContent: Structured data for UI rendering (ChatGPT Skybridge)
 *
 * ChatGPT uses structuredContent with the tool's _meta.ui.resourceUri template
 * to render interactive search results that users can click.
 */
export function buildSearchResponse(pois) {
  return {
    // Text content for model narration (summarizes results)
    content: [{ type: 'text', text: JSON.stringify(pois, null, 2) }],
    // Structured content for UI rendering (passed to window.openai.toolOutput)
    structuredContent: {
      results: pois,
      count: pois.length,
    },
  };
}

function buildOpenAIWidgetMeta(widgetDomain, frameDomains = []) {
  const csp = {
    connectDomains: ['https://chatgpt.com', widgetDomain],
    resourceDomains: [widgetDomain, 'https://*.oaistatic.com'],
    frameDomains,
  };

  return {
    'openai/widgetDomain': widgetDomain,
    'openai/widgetCSP': {
      connect_domains: csp.connectDomains,
      resource_domains: csp.resourceDomains,
      frame_domains: csp.frameDomains,
    },
    ui: {
      domain: widgetDomain,
      csp,
    },
  };
}

/**
 * Trigger background enrichment for search results (fire-and-forget)
 * Extracts osm_ids and calls batchEnrichPOIs
 */
function triggerBackgroundEnrichment(pois, db) {
  if (!pois || pois.length === 0) return;

  const osmIds = pois
    .filter(poi => poi.osm_id)
    .map(poi => poi.osm_id);

  if (osmIds.length > 0 && typeof db.batchEnrichPOIs === 'function') {
    // Fire-and-forget - don't await, don't block response
    db.batchEnrichPOIs(osmIds).catch(err => {
      console.error('Background batch enrichment error:', err.message);
      telemetry.captureException(err, { context: 'trigger_batch_enrichment' });
    });
  }
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
      const hasCountry = !!args.country_code;
      const hasCoords = args.latitude !== undefined && args.longitude !== undefined;

      if (!hasCountry && !hasCoords) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Either country_code OR coordinates (latitude + longitude) is required',
            }, null, 2),
          }],
        };
      }

      if (hasCoords) {
        const coords = validateCoordinates(args.latitude, args.longitude);
        if (!coords.valid) {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: coords.error }, null, 2) }],
          };
        }
        args.latitude = coords.lat;
        args.longitude = coords.lon;
      }

      const limit = validateLimit(args.limit, 10, 100);
      const cities = await db.searchCities({
        query: args.query,
        countryCode: args.country_code,
        state: args.state,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(cities, null, 2) }],
      };
    }

    case 'search_hotels':
    case 'search_hotels_ui': {
      if (args.latitude !== undefined && args.longitude !== undefined) {
        const coords = validateCoordinates(args.latitude, args.longitude);
        if (!coords.valid) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: coords.error }, null, 2) }] };
        }
        args.latitude = coords.lat;
        args.longitude = coords.lon;
      }
      const pois = await db.searchPOIs({
        name: args.query,
        cityName: args.city_name,
        countryCode: args.country_code,
        state: args.state,
        latitude: args.latitude,
        longitude: args.longitude,
        radius: args.radius_km,
        poiTypes: accommodationTypes,
        amenities: args.amenities,
        openNow: args.open_now || false,
        limit: validateLimit(args.limit, 50, 100),
        userId: options.user?.id,
      });
      triggerBackgroundEnrichment(pois, db);
      // UI version returns structuredContent for card rendering
      if (name === 'search_hotels_ui') {
        return buildSearchResponse(pois);
      }
      return { content: [{ type: 'text', text: JSON.stringify(pois, null, 2) }] };
    }

    case 'search_restaurants':
    case 'search_restaurants_ui': {
      if (args.latitude !== undefined && args.longitude !== undefined) {
        const coords = validateCoordinates(args.latitude, args.longitude);
        if (!coords.valid) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: coords.error }, null, 2) }] };
        }
        args.latitude = coords.lat;
        args.longitude = coords.lon;
      }
      const types = args.type ? [args.type] : foodTypes;
      const pois = await db.searchPOIs({
        name: args.query,
        cityName: args.city_name,
        countryCode: args.country_code,
        state: args.state,
        latitude: args.latitude,
        longitude: args.longitude,
        radius: args.radius_km,
        poiTypes: types,
        cuisine: args.cuisine,
        dietary: args.dietary,
        openNow: args.open_now || false,
        limit: validateLimit(args.limit, 50, 100),
        userId: options.user?.id,
      });
      triggerBackgroundEnrichment(pois, db);
      // UI version returns structuredContent for card rendering
      if (name === 'search_restaurants_ui') {
        return buildSearchResponse(pois);
      }
      return { content: [{ type: 'text', text: JSON.stringify(pois, null, 2) }] };
    }

    case 'search_pois':
    case 'search_pois_ui': {
      if (args.latitude !== undefined && args.longitude !== undefined) {
        const coords = validateCoordinates(args.latitude, args.longitude);
        if (!coords.valid) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: coords.error }, null, 2) }] };
        }
        args.latitude = coords.lat;
        args.longitude = coords.lon;
      }
      const pois = await db.searchPOIs({
        name: args.query,
        cityName: args.city_name,
        countryCode: args.country_code,
        state: args.state,
        latitude: args.latitude,
        longitude: args.longitude,
        radius: args.radius_km,
        poiType: args.poi_type,
        limit: validateLimit(args.limit, 50, 100),
        userId: options.user?.id,
      });
      triggerBackgroundEnrichment(pois, db);
      // UI version returns structuredContent for card rendering
      if (name === 'search_pois_ui') {
        return buildSearchResponse(pois);
      }
      return { content: [{ type: 'text', text: JSON.stringify(pois, null, 2) }] };
    }

    case 'get_poi_details':
    case 'get_poi_details_ui': {
      if (!args.osm_id && !args.google_place_id) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Either osm_id or google_place_id is required' }, null, 2),
            },
          ],
        };
      }

      const poi = await db.getPOIDetails(args.osm_id, args.google_place_id, options.user?.id);

      if (!poi) {
        return {
          isError: true,
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

      // UI version returns structuredContent with pre-rendered HTML for widget display
      if (name === 'get_poi_details_ui') {
        const { nearbyPois: detailNearby, nearbyTitle: detailNearbyTitle } = await fetchNearbyForPOI(poi, db, options.user?.id);
        return {
          content: [{ type: 'text', text: JSON.stringify(poi, null, 2) }],
          structuredContent: { ...poi, _html: renderPOIPreview(poi, render, detailNearby, detailNearbyTitle) },
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(poi, null, 2) }] };
    }

    case 'get_nearby_pois':
    case 'get_nearby_pois_ui': {
      if (!args.osm_id) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'osm_id is required' }, null, 2) }],
          isError: true,
        };
      }

      const sourcePoi = await db.getPOIDetails(args.osm_id, null, options.user?.id);
      if (!sourcePoi) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'POI not found', osm_id: args.osm_id }, null, 2) }],
          isError: true,
        };
      }

      const resultTypes = args.result_types || getNearbyTypes(sourcePoi.poi_type);
      const radiusKm = Math.min(args.radius_km || NEARBY_RADIUS_DEFAULT_KM, NEARBY_RADIUS_MAX_KM);
      const nearbyLimit = validateLimit(args.limit, NEARBY_LIMIT_DEFAULT, NEARBY_LIMIT_MAX);

      const nearbyPois = await db.searchPOIsNearCoordinates(
        sourcePoi.osm_latitude,
        sourcePoi.osm_longitude,
        radiusKm,
        resultTypes,
        nearbyLimit,
        options.user?.id,
        [sourcePoi.osm_id],
      );

      triggerBackgroundEnrichment(nearbyPois, db);

      if (name === 'get_nearby_pois_ui') {
        const html = renderNearbyWidget(sourcePoi, nearbyPois, render);
        return {
          content: [{ type: 'text', text: JSON.stringify(nearbyPois, null, 2) }],
          structuredContent: {
            source: { osm_id: sourcePoi.osm_id, name: sourcePoi.osm_name || sourcePoi.google_name },
            results: nearbyPois,
            count: nearbyPois.length,
            _html: html,
          },
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            source: { osm_id: sourcePoi.osm_id, name: sourcePoi.osm_name, poi_type: sourcePoi.poi_type },
            nearby: nearbyPois,
            count: nearbyPois.length,
            radius_km: radiusKm,
            result_types: resultTypes,
          }, null, 2),
        }],
      };
    }

    case 'get_stats': {
      const stats = await db.getStats();
      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      };
    }

    case 'whoami': {
      const user = options.user;
      if (!user) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ authenticated: false }, null, 2) }],
        };
      }
      // Build response, filtering out null/undefined values
      const response = {
        authenticated: true,
        id: user.id,
        email: user.email,
        name: user.name,
        picture_url: user.picture_url,
        config: user.config,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
      };
      Object.keys(response).forEach(key => {
        if (response[key] === null || response[key] === undefined) {
          delete response[key];
        }
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2),
        }],
      };
    }

    // =========================================================================
    // Favorites (requires authentication)
    // =========================================================================

    case 'add_favorite': {
      const user = options.user;
      if (!user) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Authentication required. Please provide a valid token.' }, null, 2) }],
          isError: true,
        };
      }
      const added = await db.addFavorite(user.id, args.osm_id, args.notes);
      if (!added) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'POI not found' }, null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
      };
    }

    case 'remove_favorite': {
      const user = options.user;
      if (!user) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Authentication required. Please provide a valid token.' }, null, 2) }],
          isError: true,
        };
      }
      const removed = await db.removeFavorite(user.id, args.osm_id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: removed, message: removed ? 'Favorite removed' : 'Favorite not found' }, null, 2) }],
      };
    }

    case 'list_favorites': {
      const user = options.user;
      if (!user) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Authentication required. Please provide a valid token.' }, null, 2) }],
          isError: true,
        };
      }
      const favorites = await db.listFavorites(user.id, {
        cityName: args.city_name,
        countryCode: args.country_code,
        state: args.state,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        poiTypes: args.poi_types,
        limit: Math.min(args.limit || 100, 100),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: favorites.length, favorites }, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2) }],
        isError: true,
      };
  }
}

/**
 * Handle reading a resource
 * @param {string} uri - Resource URI
 * @param {object} db - Database instance
 * @param {function} render - Template render function
 * @returns {object} - MCP resource contents
 */
export async function handleReadResource(uri, db, render) {
  const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
  const buildHtmlContent = (html, frameDomains = []) => ({
    uri,
    mimeType: 'text/html+skybridge',
    text: html,
    _meta: buildOpenAIWidgetMeta(widgetDomain, frameDomains),
  });

  // Version info
  if (uri === 'info://version') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(versionInfo, null, 2) }],
    };
  }

  // Random POI link
  if (uri === 'info://random-poi') {
    const serverBaseUrl = await db.getServerBaseUrl(); // Use cached version
    const baseUrl = serverBaseUrl ? serverBaseUrl.replace(/\/$/, '') : '';
    const previewUrl = `${baseUrl}/preview/poi/random`;
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ url: previewUrl }, null, 2) }],
    };
  }

  // Sample queries resource
  if (uri === 'samples://queries') {
    const samples = {
      description: 'Example queries to help you get started with the travel MCP server',
      workflow_tips: [
        {
          pattern: 'Find [chain/brand] near [landmark]',
          description: 'To find a chain restaurant or hotel near a landmark, use a two-step approach',
          steps: [
            'Step 1: Use search_pois to find the landmark and get its coordinates',
            'Step 2: Use search_restaurants or search_hotels with those coordinates + query for the brand name',
          ],
          example: {
            query: 'Find Starbucks near Empire State Building',
            step1: { tool: 'search_pois', args: { query: 'Empire State Building', city_name: 'New York', country_code: 'US' } },
            step1_result: 'Returns POI with osm_latitude: 40.748, osm_longitude: -73.985',
            step2: { tool: 'search_restaurants', args: { latitude: 40.748, longitude: -73.985, radius_km: 1, query: 'Starbucks' } },
            step2_result: 'Returns all Starbucks locations within 1km of Empire State Building',
          },
        },
        {
          pattern: 'Find [type] near [landmark]',
          description: 'Same two-step approach works for any type of place near any landmark',
          examples: [
            'Hotels near Central Park → search_pois("Central Park") → search_hotels(lat/long)',
            'Italian restaurants near Times Square → search_pois("Times Square") → search_restaurants(lat/long, query="Italian")',
            'Museums near Eiffel Tower → search_pois("Eiffel Tower") → search_pois(lat/long, poi_type="museum")',
          ],
        },
      ],
      examples: [
        {
          category: 'Hotels',
          description: 'Search for hotels in a city',
          tool: 'search_hotels',
          example_query: 'Find hotels in New York, US',
          example_args: { city_name: 'New York', country_code: 'US', limit: 10 },
          notable_result: 'The Conrad New York Downtown on Vesey Street is a luxury hotel in Lower Manhattan.',
        },
        {
          category: 'Hotel Chains',
          description: 'Search for a specific hotel brand',
          tool: 'search_hotels',
          example_query: 'Find Marriott hotels in Manhattan',
          example_args: { city_name: 'New York', country_code: 'US', query: 'Marriott', limit: 10 },
          note: 'The query parameter works with brand names like Marriott, Hilton, Holiday Inn, etc.',
        },
        {
          category: 'Restaurants',
          description: 'Search for restaurants near a location',
          tool: 'search_restaurants',
          example_query: 'Find restaurants near Rockefeller Center in Manhattan',
          example_args: { latitude: 40.7587, longitude: -73.9787, radius_km: 0.5, limit: 10 },
          notable_result: 'The Rainbow Room at 30 Rockefeller Plaza is an iconic fine dining restaurant in Midtown Manhattan.',
        },
        {
          category: 'Chain Restaurants',
          description: 'Search for a chain restaurant brand near coordinates',
          tool: 'search_restaurants',
          example_query: 'Find Starbucks near Empire State Building (after getting coordinates)',
          example_args: { latitude: 40.748, longitude: -73.985, radius_km: 1, query: 'Starbucks', limit: 10 },
          note: 'The query parameter works with chain brands like Starbucks, McDonald\'s, Chipotle, Subway, etc.',
        },
        {
          category: 'Attractions',
          description: 'Search for points of interest and tourist attractions',
          tool: 'search_pois',
          example_query: 'Find tourist attractions in New York, US',
          example_args: { city_name: 'New York', country_code: 'US', limit: 10 },
          notable_result: 'The Statue of Liberty on Liberty Island is one of the most famous attractions in New York.',
        },
        {
          category: 'Landmarks (for coordinates)',
          description: 'Get coordinates of a landmark to use in subsequent searches',
          tool: 'search_pois',
          example_query: 'Find Empire State Building to get its coordinates',
          example_args: { query: 'Empire State Building', city_name: 'New York', country_code: 'US' },
          note: 'Results include osm_latitude and osm_longitude - use these for nearby searches.',
        },
        {
          category: 'Cities',
          description: 'Search for cities in a country or region',
          tool: 'search_cities',
          example_query: 'Find cities in New York state, US',
          example_args: { country_code: 'US', state: 'New York', limit: 10 },
          notable_result: 'New York City is the most populous city in the United States.',
        },
        {
          category: 'POI Details',
          description: 'Get detailed information about a specific point of interest',
          tool: 'get_poi_details',
          example_query: 'Get details for a specific hotel or restaurant',
          example_args: { osm_id: 123456789 },
          note: 'Use an osm_id from search results to get full details including address, phone, website, and hours.',
        },
      ],
    };
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(samples, null, 2) }],
    };
  }

  // Widget: POI details template (used by get_poi_details tool)
  // URI: ui://widget/poi-details.html
  if (uri === 'ui://widget/poi-details.html') {
    // Return empty template - data is populated client-side via window.openai.toolOutput
    const html = render('poi-details', {});
    return {
      contents: [buildHtmlContent(html)],
    };
  }

  // Widget: Search results template (used by search_hotels, search_restaurants, search_pois)
  // URI: ui://widget/search-results.html
  if (uri === 'ui://widget/search-results.html') {
    // Return empty template - data is populated client-side via window.openai.toolOutput
    const html = render('search-results', {
      title: 'Search Results',
      count: 0,
      results: [],
    });
    return {
      contents: [buildHtmlContent(html)],
    };
  }

  // URI: ui://widget/nearby-pois.html
  if (uri === 'ui://widget/nearby-pois.html') {
    const html = render('nearby-pois', {
      title: 'Nearby Places',
      results: [],
      count: 0,
    });
    return {
      contents: [buildHtmlContent(html)],
    };
  }

  // POI detail page by ID: ui://{host}/poi/{osm_id}
  // Format: ui://travel.arjanvandermeer.com/poi/1313852747
  // Used when user clicks a search result - the host part is dynamic
  const poiMatch = uri.match(/^ui:\/\/[^/]+\/poi\/(\d+)$/);
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
        contents: [buildHtmlContent(errorHtml)],
      };
    }

    const { nearbyPois: resNearby, nearbyTitle: resNearbyTitle } = await fetchNearbyForPOI(poi, db);
    return {
      contents: [buildHtmlContent(renderPOIPreview(poi, render, resNearby, resNearbyTitle))],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
}
