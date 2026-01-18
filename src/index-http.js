#!/usr/bin/env node

/**
 * MCP Server with HTTP/SSE transport
 * Provides travel information tools over HTTP with Server-Sent Events
 *
 * Usage:
 *   node src/index-http.js [port]
 *
 * Default port: 3000
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TravelDatabase } from './database.js';
import http from 'http';
import { parse } from 'url';

const db = new TravelDatabase();
const PORT = process.argv[2] ? parseInt(process.argv[2]) : 3000;

const server = new Server(
  {
    name: 'travel-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
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

  try {
    switch (name) {
      case 'search_cities': {
        const cities = await db.searchCities(args.query, args.country_code, args.limit || 10);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(cities, null, 2),
            },
          ],
        };
      }

      case 'search_hotels': {
        const result = await db.searchPOIs({
          name: args.query,
          cityName: args.city_name,
          countryCode: args.country_code,
          latitude: args.latitude,
          longitude: args.longitude,
          radius: args.radius_km,
          poiType: 'hotel',
          limit: args.limit || 50,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'search_restaurants': {
        // Define all food & drink types
        const foodTypes = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'];

        // Use specific type if provided, otherwise search all food types
        const types = args.type ? [args.type] : foodTypes;

        const result = await db.searchPOIs({
          name: args.query,
          cityName: args.city_name,
          countryCode: args.country_code,
          latitude: args.latitude,
          longitude: args.longitude,
          radius: args.radius_km,
          poiTypes: types,
          limit: args.limit || 50,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'search_pois': {
        const result = await db.searchPOIs({
          name: args.query,
          cityName: args.city_name,
          countryCode: args.country_code,
          latitude: args.latitude,
          longitude: args.longitude,
          radius: args.radius_km,
          poiType: args.poi_type,
          limit: args.limit || 50,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_poi_details': {
        const poi = await db.getPOIDetails(args.osm_id);

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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(poi, null, 2),
            },
          ],
        };
      }

      case 'get_stats': {
        const stats = await db.getStats();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
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

// Create HTTP server with SSE support
async function main() {
  // Store active transport (only one at a time for now)
  let activeTransport = null;

  const httpServer = http.createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check endpoint
    if (pathname === '/health' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        server: 'travel-mcp-server',
        version: '1.0.0',
        transport: 'http-sse',
        endpoints: {
          sse: '/sse',
          health: '/health',
          message: '/message',
        },
      }));
      return;
    }

    // SSE endpoint - establishes SSE connection
    if (pathname === '/sse' && req.method === 'GET') {
      console.log('New SSE connection established');

      const transport = new SSEServerTransport('/message', res);
      activeTransport = transport;

      await server.connect(transport);

      // Handle connection close
      req.on('close', () => {
        console.log('SSE connection closed');
        activeTransport = null;
      });

      return;
    }

    // Message endpoint - handles POST requests from SSE client
    if (pathname === '/message' && req.method === 'POST') {
      if (!activeTransport) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Service Unavailable',
          message: 'No active SSE connection. Connect to /sse first.',
        }));
        return;
      }

      // Let the transport handle the POST message
      await activeTransport.handlePostMessage(req, res);
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not Found',
      message: `Path ${pathname} not found. Try /sse for SSE connection or /health for status.`,
    }));
  });

  httpServer.listen(PORT, () => {
    console.log(`Travel MCP Server (HTTP/SSE) running on http://localhost:${PORT}`);
    console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
