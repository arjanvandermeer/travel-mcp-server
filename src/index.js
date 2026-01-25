#!/usr/bin/env node

/**
 * MCP Server with PostgreSQL backend
 * Provides travel information tools using GeoNames and OSM data
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TravelDatabase } from './database.js';
import * as telemetry from './telemetry.js';
import { render } from './templates/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Debug logging - writes to file since stdio is used for MCP protocol
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', 'mcp-debug.log');

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] [${level}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] [${level}] ${message}`;

  // Write to log file
  fs.appendFileSync(LOG_FILE, logLine + '\n');

  // Also write to stderr for immediate visibility
  console.error(logLine);
}

log('INFO', 'MCP Server starting...');
log('INFO', 'Log file', LOG_FILE);

let db;
try {
  db = new TravelDatabase();
  log('INFO', 'TravelDatabase instance created');
} catch (err) {
  log('ERROR', 'Failed to create TravelDatabase', err.message);
  process.exit(1);
}

const server = new Server(
  {
    name: 'travel-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('INFO', 'ListTools request received');
  return {
    tools: [
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
        description: 'Search for hotels by name AND/OR location. Supports: (1) name only, (2) location only (city or coordinates), or (3) both combined. Examples: "marriott", "hotels in Bangkok", "palace hotel in Bangkok", coordinates near a location.',
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
        description: 'Get detailed information about a specific POI (hotel, restaurant, attraction, etc.) including Google Places enrichment data (ratings, reviews, photos, verified hours). Automatically triggers background enrichment from Google Places API if not already enriched.',
        inputSchema: {
          type: 'object',
          properties: {
            osm_id: {
              type: 'number',
              description: 'The OSM ID of the POI to get details for',
            },
          },
          required: ['osm_id'],
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
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log('INFO', `Tool call received: ${name}`, args);

  // Add breadcrumb for debugging
  telemetry.addBreadcrumb(`Tool call: ${name}`, 'mcp.tool', args);

  return telemetry.withTransaction(`mcp.tool.${name}`, 'mcp.request', async () => {
    try {
      let result;

      switch (name) {
        case 'search_cities': {
          const cities = await db.searchCities(args.query, args.country_code, args.limit || 10);
          log('INFO', `search_cities returned ${cities.length} results`);
          result = cities;
          break;
        }

        case 'search_hotels': {
          const hotels = await db.searchPOIs({
            name: args.query,
            cityName: args.city_name,
            countryCode: args.country_code,
            latitude: args.latitude,
            longitude: args.longitude,
            radius: args.radius_km,
            poiType: 'hotel',
            limit: args.limit || 50,
          });
          log('INFO', `search_hotels returned ${hotels.length} results`);
          result = hotels;
          break;
        }

        case 'search_restaurants': {
          const foodTypes = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'];
          const types = args.type ? [args.type] : foodTypes;

          const restaurants = await db.searchPOIs({
            name: args.query,
            cityName: args.city_name,
            countryCode: args.country_code,
            latitude: args.latitude,
            longitude: args.longitude,
            radius: args.radius_km,
            poiTypes: types,
            limit: args.limit || 50,
          });
          log('INFO', `search_restaurants returned ${restaurants.length} results`);
          result = restaurants;
          break;
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
          log('INFO', `search_pois returned ${pois.length} results`);
          result = pois;
          break;
        }

        case 'get_poi_details': {
          const poi = await db.getPOIDetails(args.osm_id);
          log('INFO', `get_poi_details returned ${poi ? 'found' : 'not found'}`);

          if (!poi) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: 'POI not found', osm_id: args.osm_id }, null, 2),
                },
              ],
            };
          }
          result = poi;
          break;
        }

        case 'get_stats': {
          const stats = await db.getStats();
          log('INFO', 'get_stats returned successfully');
          result = stats;
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      log('ERROR', `Tool ${name} failed`, { error: error.message, stack: error.stack });
      telemetry.captureException(error, { tool: name, args });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });
});

// List available resources (MCP Apps)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  log('INFO', 'ListResources request received');
  return {
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
    // Resource templates allow parameterized URIs
    resourceTemplates: [
      {
        uriTemplate: 'ui://poi/{osm_id}',
        name: 'POI Detail Page',
        description: 'Rich interactive page for a specific POI (hotel, restaurant, etc.)',
        mimeType: 'text/html+skybridge',
      },
    ],
  };
});

// Read resource content (MCP Apps)
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  log('INFO', `ReadResource request received: ${uri}`);

  // Test widget
  if (uri === 'ui://test-widget') {
    const html = render('test-widget', {
      title: 'Travel MCP Server',
      message: 'MCP Apps UI is working!',
    });

    return {
      contents: [
        {
          uri,
          mimeType: 'text/html+skybridge',
          text: html,
        },
      ],
    };
  }

  // POI detail page: ui://poi/{osm_id}
  const poiMatch = uri.match(/^ui:\/\/poi\/(\d+)$/);
  if (poiMatch) {
    const osmId = parseInt(poiMatch[1], 10);
    log('INFO', `Fetching POI details for osm_id: ${osmId}`);

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

    // Parse opening hours if available
    const opening_hours = poi.google_opening_hours
      ? JSON.parse(poi.google_opening_hours)
      : null;

    // Build rich HTML page using template
    const html = render('poi-details', {
      ...poi,
      opening_hours,
    });

    return {
      contents: [
        {
          uri,
          mimeType: 'text/html+skybridge',
          text: html,
        },
      ],
    };
  }

  // Random POI: ui://poi/random
  if (uri === 'ui://poi/random') {
    log('INFO', 'Fetching random POI');

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

    // Parse opening hours if available
    const opening_hours = poi.google_opening_hours
      ? JSON.parse(poi.google_opening_hours)
      : null;

    const html = render('poi-details', {
      ...poi,
      opening_hours,
    });

    return {
      contents: [{ uri, mimeType: 'text/html+skybridge', text: html }],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Start server
async function main() {
  // Test database connection before starting
  log('INFO', 'Testing database connection...');
  try {
    await db.testConnection();
    log('INFO', 'Database connection successful');
  } catch (err) {
    // Handle AggregateError (multiple connection attempts failed)
    const errorMsg = err.code || err.message || (err.errors ? err.errors.map(e => e.code || e.message).join(', ') : 'Unknown error');
    log('ERROR', 'Database connection failed', { error: errorMsg, code: err.code });
    console.error(`FATAL: Cannot connect to database: ${errorMsg}`);
    console.error('Make sure PostgreSQL is running (docker start travel-postgres or brew services start postgresql@16)');
    process.exit(1);
  }

  // Initialize telemetry (after database is ready to load config)
  log('INFO', 'Initializing telemetry...');
  try {
    const telemetryConfig = await db.getTelemetryConfig();
    await telemetry.initTelemetry(telemetryConfig);
    if (telemetry.isEnabled()) {
      log('INFO', 'Telemetry initialized successfully');
      telemetry.setTag('server.type', 'stdio');
    } else {
      log('INFO', 'Telemetry is disabled (no SENTRY_DSN configured)');
    }
  } catch (err) {
    log('WARN', 'Failed to initialize telemetry', err.message);
    // Continue without telemetry
  }

  log('INFO', 'Creating StdioServerTransport...');
  const transport = new StdioServerTransport();

  log('INFO', 'Connecting server to transport...');
  await server.connect(transport);

  log('INFO', 'Travel MCP Server (PostgreSQL) running on stdio');
  console.error('Travel MCP Server (PostgreSQL) running on stdio');
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  log('INFO', 'SIGTERM received, shutting down...');
  await telemetry.flush();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log('INFO', 'SIGINT received, shutting down...');
  await telemetry.flush();
  process.exit(0);
});

main().catch(async (error) => {
  log('ERROR', 'Server startup failed', { error: error.message, stack: error.stack });
  telemetry.captureException(error, { context: 'server_startup' });
  await telemetry.flush();
  console.error('Server error:', error);
  process.exit(1);
});
