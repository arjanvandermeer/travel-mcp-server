#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { HotelDatabase } from './database.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new HotelDatabase();

// Create MCP server
const server = new Server(
  {
    name: 'hotel-info',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_cities',
        description: 'Search for cities by name. Supports multi-language search via alternate names (e.g., "Londres" finds London).',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'City name to search for (in any language)',
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
        description: 'Find cities within a specified radius of geographic coordinates',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude in decimal degrees',
            },
            longitude: {
              type: 'number',
              description: 'Longitude in decimal degrees',
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
        name: 'search_countries',
        description: 'Search for countries by name or ISO code',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Country name or ISO code',
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
        description: 'Search for hotels by name or location',
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
        description: 'Find hotels within a specified radius of geographic coordinates',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude in decimal degrees',
            },
            longitude: {
              type: 'number',
              description: 'Longitude in decimal degrees',
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
        description: 'Get statistics about the database contents',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool execution
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
        const result = db.getCityByGeonameId(args.geoname_id);
        return {
          content: [
            {
              type: 'text',
              text: result ? JSON.stringify(result, null, 2) : 'City not found',
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

      case 'search_countries': {
        const results = db.searchCountries(args.query, args.limit || 10);
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

// SSE endpoint
app.get('/sse', async (req, res) => {
  console.log('New SSE connection');
  const transport = new SSEServerTransport('/message', res);
  await server.connect(transport);
});

// POST endpoint for messages
app.post('/message', express.json(), async (req, res) => {
  // This is handled by the SSE transport
  res.status(200).send();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: db.getStats() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Hotel MCP Server (HTTP) running on http://localhost:${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('\nTo use with Claude Desktop, add to config:');
  console.log(`{
  "mcpServers": {
    "hotel-info": {
      "url": "http://localhost:${PORT}/sse"
    }
  }
}`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nClosing database...');
  db.close();
  process.exit(0);
});
