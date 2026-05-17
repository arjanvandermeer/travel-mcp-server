/**
 * MCP Tools Configuration
 * Single source of truth for tool definitions and handlers
 * Used by both stdio (index.js) and HTTP (index-http.js) servers
 */

import { render } from './templates/index.js';
import * as telemetry from './telemetry.js';
import { normalizeUserPreferenceInput, saveUserPreferences, userPreferencesFromConfig } from './user-preferences.js';
import { NEARBY_RADIUS_DEFAULT_KM, NEARBY_RADIUS_MAX_KM, NEARBY_LIMIT_DEFAULT, NEARBY_LIMIT_MAX } from './config.js';
import { validateCoordinates, validateLimit } from './validation.js';
import { accommodationTypes, fetchNearbyForPOI, foodTypes, getNearbyTypes, renderNearbyWidget, renderPOIPreview } from './poi-view-utils.js';

export { getPromptMessages, promptsConfig } from './prompts-config.js';
export { getResourcesConfig, handleReadResource } from './resources-config.js';
export { accommodationTypes, attractionTypes, fetchNearbyForPOI, foodTypes, getNearbyTitle, getNearbyTypes, isOpenNow, renderNearbyWidget, renderPOIPreview } from './poi-view-utils.js';

const hotelIntents = ['remote_work', 'family', 'romantic', 'budget', 'accessible', 'pet_friendly'];

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
        brand: {
          type: 'string',
          description: 'Filter by hotel brand, matched against OSM brand/operator tags and known aliases. Example: "DoubleTree".',
        },
        chain: {
          type: 'string',
          description: 'Filter by hotel chain and known sub-brands. Example: "Hilton" also matches Conrad, Waldorf Astoria, DoubleTree, and other Hilton brands.',
        },
        intent: {
          type: 'string',
          enum: hotelIntents,
          description: 'Intent-based hotel search. Maps to explainable OSM filters: remote_work, family, romantic, budget, accessible, pet_friendly.',
        },
        accommodation_type: {
          oneOf: [
            { type: 'string', enum: accommodationTypes },
            { type: 'array', items: { type: 'string', enum: accommodationTypes } },
          ],
          description: 'Filter by accommodation type(s). Examples: "guest_house", ["hostel", "bed_and_breakfast"].',
        },
        open_now: {
          type: 'boolean',
          description: 'If true, only return hotels that are currently open/accepting guests. Uses Google Places hours when available and OSM opening_hours as fallback. POIs without hours data are excluded.',
        },
        open_at: {
          type: 'string',
          description: 'ISO datetime to return only hotels open/accepting guests at that time. Uses Google Places hours when available and OSM opening_hours as fallback.',
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
        brand: { type: 'string', description: 'Hotel brand filter.' },
        chain: { type: 'string', description: 'Hotel chain filter including known sub-brands.' },
        intent: { type: 'string', enum: hotelIntents, description: 'Intent-based hotel search: remote_work, family, romantic, budget, accessible, pet_friendly.' },
        accommodation_type: {
          oneOf: [
            { type: 'string', enum: accommodationTypes },
            { type: 'array', items: { type: 'string', enum: accommodationTypes } },
          ],
          description: 'Accommodation type filter. OR logic.',
        },
        open_now: { type: 'boolean', description: 'Only return currently open hotels.' },
        open_at: { type: 'string', description: 'ISO datetime to return only hotels open at that time.' },
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
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
          description: 'Filter by cuisine type(s). Examples: "thai", ["italian", "pizza"], ["sushi", "japanese"]. Matches against OSM cuisine data. Multiple values use OR logic (matches any).',
        },
        dietary: {
          oneOf: [
            { type: 'string', enum: ['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'organic', 'lactose_free'] },
            { type: 'array', items: { type: 'string', enum: ['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'organic', 'lactose_free'] } },
          ],
          description: 'Filter by dietary restriction support. Multiple values use AND logic (must support all). Based on OSM dietary tags.',
        },
        price_level: {
          oneOf: [
            { type: 'number', enum: [0, 1, 2, 3, 4] },
            { type: 'string', enum: ['free', 'inexpensive', 'moderate', 'expensive', 'very_expensive'] },
          ],
          description: 'Filter by Google Places price level: 0/free, 1/inexpensive, 2/moderate, 3/expensive, 4/very_expensive. Requires Google enrichment data.',
        },
        open_now: {
          type: 'boolean',
          description: 'If true, only return restaurants that are currently open. Uses Google Places hours when available and OSM opening_hours as fallback. POIs without hours data are excluded.',
        },
        open_at: {
          type: 'string',
          description: 'ISO datetime to return only restaurants open at that time. Uses Google Places hours when available and OSM opening_hours as fallback.',
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
        cuisine: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
          description: 'Cuisine filter (e.g., "thai" or ["thai", "italian"]). OR logic.',
        },
        dietary: {
          oneOf: [
            { type: 'string', enum: ['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'organic', 'lactose_free'] },
            { type: 'array', items: { type: 'string', enum: ['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'organic', 'lactose_free'] } },
          ],
          description: 'Dietary restriction filter. AND logic.',
        },
        price_level: {
          oneOf: [
            { type: 'number', enum: [0, 1, 2, 3, 4] },
            { type: 'string', enum: ['free', 'inexpensive', 'moderate', 'expensive', 'very_expensive'] },
          ],
          description: 'Google Places price level filter.',
        },
        open_now: { type: 'boolean', description: 'Only return currently open restaurants.' },
        open_at: { type: 'string', description: 'ISO datetime to return only restaurants open at that time.' },
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
    name: 'get_dining_budget',
    description: 'Estimate per-person dining costs for a city using Google Places restaurant price-level data. Optionally filter by cuisine. Returns sample size, data quality, price-level distribution, and USD low/median/high estimates when enough data exists.',
    inputSchema: {
      type: 'object',
      properties: {
        city_name: { type: 'string', description: 'City name to estimate dining costs for.' },
        country_code: { type: 'string', description: 'Optional 2-letter country code (e.g., "FR", "TH").' },
        state: { type: 'string', description: 'Optional state/province code or full name.' },
        cuisine: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
          description: 'Optional cuisine filter. Examples: "thai", ["italian", "pizza"].',
        },
      },
      required: ['city_name'],
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
    description: 'Check authentication status and get current user info, including saved travel preferences. Returns user details if authenticated, or { authenticated: false } for anonymous sessions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_user_preferences',
    description: 'Get the authenticated user travel preferences for currency, language, and home location. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_user_preferences',
    description: 'Save authenticated user travel preferences. Supports currency, language, and home location. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        currency: {
          type: 'string',
          description: 'Preferred 3-letter ISO 4217 currency code, e.g. USD, EUR, THB.',
        },
        language: {
          type: 'string',
          description: 'Preferred BCP 47 language tag, e.g. en, en-US, th.',
        },
        home_location: {
          type: 'object',
          description: 'Home location as city/country and optionally coordinates.',
          properties: {
            city_name: { type: 'string', description: 'Home city name.' },
            country_code: { type: 'string', description: '2-letter country code, e.g. US, NL, TH.' },
            state: { type: 'string', description: 'Optional state or region.' },
            latitude: { type: 'number', description: 'Home latitude. Must be paired with longitude.' },
            longitude: { type: 'number', description: 'Home longitude. Must be paired with latitude.' },
          },
        },
      },
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

function normalizeStringList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(v => String(v).trim()).filter(Boolean);
}

function resolveAccommodationTypes(value) {
  const requested = normalizeStringList(value);
  if (requested.length === 0) {
    return { types: accommodationTypes };
  }

  const invalid = requested.filter(type => !accommodationTypes.includes(type));
  if (invalid.length > 0) {
    return {
      error: `Invalid accommodation_type: ${invalid.join(', ')}. Valid values: ${accommodationTypes.join(', ')}`,
    };
  }

  return { types: requested };
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
      const accommodationTypeFilter = resolveAccommodationTypes(args.accommodation_type);
      if (accommodationTypeFilter.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: accommodationTypeFilter.error }, null, 2) }],
        };
      }
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
        poiTypes: accommodationTypeFilter.types,
        amenities: args.amenities,
        brand: args.brand,
        chain: args.chain,
        intent: args.intent,
        openNow: args.open_now || false,
        openAt: args.open_at,
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
        priceLevel: args.price_level,
        openNow: args.open_now || false,
        openAt: args.open_at,
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

    case 'get_dining_budget': {
      try {
        const budget = await db.getDiningBudget({
          cityName: args.city_name,
          countryCode: args.country_code,
          state: args.state,
          cuisine: args.cuisine,
        });
        if (!budget) {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: 'City not found' }, null, 2) }],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(budget, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
        };
      }
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
        preferences: userPreferencesFromConfig(user.config),
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

    case 'get_user_preferences': {
      const user = options.user;
      if (!user) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Authentication required. Please provide a valid token.' }, null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(userPreferencesFromConfig(user.config), null, 2) }],
      };
    }

    case 'set_user_preferences': {
      const user = options.user;
      if (!user) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Authentication required. Please provide a valid token.' }, null, 2) }],
          isError: true,
        };
      }

      try {
        const preferences = normalizeUserPreferenceInput(args);
        await saveUserPreferences(db, user.id, preferences);
        user.config = {
          ...user.config,
          ...Object.fromEntries(Object.entries(preferences).map(([key, value]) => [
            key,
            key === 'home_location' ? JSON.stringify(value) : value,
          ])),
        };
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, preferences }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }, null, 2) }],
          isError: true,
        };
      }
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
