#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { HotelDatabase } from './database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Log errors to file for debugging
function logError(message, error = null) {
  const logPath = join(__dirname, '../mcp-server.log');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}${error ? '\n' + error.stack : ''}\n`;
  try {
    writeFileSync(logPath, logMessage, { flag: 'a' });
  } catch (e) {
    // Silently fail if we can't write logs
  }
}

// Initialize database with absolute path
try {
  const dbPath = join(__dirname, '../data/hotels.db');
  logError(`Initializing database at: ${dbPath}`);
  var db = new HotelDatabase(dbPath);
  logError('Database initialized successfully');
} catch (error) {
  logError('Failed to initialize database', error);
  process.exit(1);
}

// Create MCP server
const server = new Server(
  {
    name: 'hotel-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Tool: search_cities
 * Search for cities by name
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_cities',
        description: 'Search for cities by name in the GeoNames database. Returns city information including coordinates, population, and timezone.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'City name or partial name to search for',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_city_by_id',
        description: 'Get detailed information about a city by its GeoNames ID',
        inputSchema: {
          type: 'object',
          properties: {
            geoname_id: {
              type: 'number',
              description: 'GeoNames ID of the city',
            },
          },
          required: ['geoname_id'],
        },
      },
      {
        name: 'find_cities_near_coordinates',
        description: 'Find cities near a specific latitude/longitude coordinate',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude coordinate',
            },
            longitude: {
              type: 'number',
              description: 'Longitude coordinate',
            },
            radius_km: {
              type: 'number',
              description: 'Search radius in kilometers (default: 50)',
              default: 50,
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 20)',
              default: 20,
            },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'find_cities_in_polygon',
        description: 'Find cities within a polygon defined by coordinate vertices. Useful for finding cities within a specific geographic area or boundary.',
        inputSchema: {
          type: 'object',
          properties: {
            polygon: {
              type: 'array',
              description: 'Array of [latitude, longitude] coordinate pairs defining the polygon vertices. The polygon will be automatically closed (no need to repeat the first point at the end).',
              items: {
                type: 'array',
                items: { type: 'number' },
                minItems: 2,
                maxItems: 2,
              },
              minItems: 3,
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 100)',
              default: 100,
            },
          },
          required: ['polygon'],
        },
      },
      {
        name: 'search_hotels',
        description: 'Search for hotels by name, city, or address (requires OSM data to be imported)',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Hotel name, city, or address to search for',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 20)',
              default: 20,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_hotels_near_coordinates',
        description: 'Find hotels near a specific latitude/longitude coordinate (requires OSM data to be imported)',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude coordinate',
            },
            longitude: {
              type: 'number',
              description: 'Longitude coordinate',
            },
            radius_km: {
              type: 'number',
              description: 'Search radius in kilometers (default: 10)',
              default: 10,
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 50)',
              default: 50,
            },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_database_stats',
        description: 'Get statistics about the database (number of cities, hotels, etc.)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_cities': {
        const results = db.searchCities(args.query, args.limit || 10);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_city_by_id': {
        const city = db.getCityByGeonameId(args.geoname_id);
        if (!city) {
          return {
            content: [
              {
                type: 'text',
                text: `City with GeoNames ID ${args.geoname_id} not found`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(city, null, 2),
            },
          ],
        };
      }

      case 'find_cities_near_coordinates': {
        const results = db.getCitiesNearCoordinates(
          args.latitude,
          args.longitude,
          args.radius_km || 50,
          args.limit || 20
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'find_cities_in_polygon': {
        const results = db.getCitiesInPolygon(
          args.polygon,
          args.limit || 100
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'search_hotels': {
        const results = db.searchHotels(args.query, args.limit || 20);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'find_hotels_near_coordinates': {
        const results = db.getHotelsNearCoordinates(
          args.latitude,
          args.longitude,
          args.radius_km || 10,
          args.limit || 50
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_database_stats': {
        const stats = db.getStats();
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
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool ${name}: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  try {
    logError('Starting MCP server...');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logError('MCP server connected successfully');
  } catch (error) {
    logError('Error in main()', error);
    throw error;
  }
}

main().catch((error) => {
  logError('Fatal error in main', error);
  console.error('Fatal error:', error);
  process.exit(1);
});