#!/usr/bin/env node

/**
 * MCP Server with PostgreSQL backend
 * Provides travel information tools using GeoNames and OSM data
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TravelDatabase } from './database-postgres.js';

const db = new TravelDatabase();

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
              description: 'Search radius in kilometers when using coordinates (default: 5)',
              default: 5,
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
        description: 'Search for restaurants by name AND/OR location. Supports: (1) name only, (2) location only (city or coordinates), or (3) both combined. Examples: "palace restaurant", "restaurants in Bangkok", "palace restaurant in Bangkok".',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional restaurant name to search for (fuzzy matching)',
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
              description: 'Search radius in kilometers when using coordinates (default: 5)',
              default: 5,
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
              description: 'Search radius in kilometers when using coordinates (default: 5)',
              default: 5,
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
        const result = await db.unifiedSearchPOIs({
          query: args.query,
          cityName: args.city_name,
          countryCode: args.country_code,
          latitude: args.latitude,
          longitude: args.longitude,
          radiusKm: args.radius_km || 5,
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
        const result = await db.unifiedSearchPOIs({
          query: args.query,
          cityName: args.city_name,
          countryCode: args.country_code,
          latitude: args.latitude,
          longitude: args.longitude,
          radiusKm: args.radius_km || 5,
          poiType: 'restaurant',
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
        const result = await db.unifiedSearchPOIs({
          query: args.query,
          cityName: args.city_name,
          countryCode: args.country_code,
          latitude: args.latitude,
          longitude: args.longitude,
          radiusKm: args.radius_km || 5,
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Travel MCP Server (PostgreSQL) running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
