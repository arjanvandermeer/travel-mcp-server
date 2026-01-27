#!/usr/bin/env node

/**
 * MCP Server with Streamable HTTP transport
 * Provides travel information tools over HTTP
 *
 * Usage:
 *   node src/index-http.js [port]
 *
 * Default port: 3000
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TravelDatabase } from './database.js';
import * as telemetry from './telemetry.js';
import { render } from './templates/index.js';
import { toolsConfig, resourcesConfig, executeToolHandler, handleReadResource, renderPOIPreview } from './tools-config.js';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parse } from 'url';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: toolsConfig };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Add breadcrumb for debugging
  telemetry.addBreadcrumb(`Tool call: ${name}`, 'mcp.tool', args);

  return telemetry.withTransaction(`mcp.tool.${name}`, 'mcp.request', async () => {
    try {
      return await executeToolHandler(name, args, db, {
        previewUrlBase: `http://localhost:${PORT}`,
      });
    } catch (error) {
      telemetry.captureException(error, { tool: name, args });
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });
});

// List available resources (MCP Apps)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return resourcesConfig;
});

// Read resource content (MCP Apps)
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  return handleReadResource(uri, db, render);
});

// Create HTTP server with Streamable HTTP transport
async function main() {
  // Test database connection first
  try {
    await db.testConnection();
    console.error('Database connection successful');
  } catch (err) {
    console.error('FATAL: Cannot connect to database:', err.message);
    console.error('Make sure PostgreSQL is running');
    process.exit(1);
  }

  // Initialize telemetry
  try {
    const telemetryConfig = await db.getTelemetryConfig();
    await telemetry.initTelemetry(telemetryConfig);
    if (telemetry.isEnabled()) {
      console.error('Telemetry initialized successfully');
      telemetry.setTag('server.type', 'http');
    }
  } catch (err) {
    console.warn('Failed to initialize telemetry:', err.message);
  }

  // Create the transport once
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  // Connect the MCP server to the transport
  await server.connect(transport);
  console.error('MCP server connected to transport');

  const httpServer = http.createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Log all incoming requests
    console.error(`[${req.method}] ${pathname}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check endpoint
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        server: 'travel-mcp-server',
        version: '1.0.0',
        transport: 'streamable-http',
        endpoints: {
          mcp: '/mcp',
          health: '/health',
          preview: '/preview/poi/{osm_id}',
        },
      }));
      return;
    }

    // Preview endpoints - serve rendered HTML directly in browser
    if (pathname === '/preview/test-widget') {
      const html = render('test-widget', {
        title: 'Travel MCP Server',
        message: 'MCP Apps UI is working!',
      });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // Demo page - static HTML with sample data
    if (pathname === '/preview/demo') {
      const demoPath = path.join(__dirname, 'templates', 'demo.html');
      const html = fs.readFileSync(demoPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (pathname === '/preview/poi/random') {
      try {
        const poi = await db.getRandomPOI();
        if (!poi) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>No POIs found</h1>');
          return;
        }
        const html = renderPOIPreview(poi, render);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        console.error('Error rendering random POI:', err);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
      }
      return;
    }

    const poiPreviewMatch = pathname.match(/^\/preview\/poi\/(\d+)$/);
    if (poiPreviewMatch) {
      try {
        const osmId = parseInt(poiPreviewMatch[1], 10);
        const poi = await db.getPOIDetails(osmId);
        if (!poi) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(`<h1>POI not found</h1><p>OSM ID: ${osmId}</p>`);
          return;
        }
        const html = renderPOIPreview(poi, render);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        console.error('Error rendering POI:', err);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
      }
      return;
    }

    // MCP endpoint - handles all MCP requests
    if (pathname === '/mcp' || pathname === '/') {
      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error('Error handling MCP request:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not Found',
      message: `Path ${pathname} not found. POST to /mcp for MCP or GET /health for status.`,
    }));
  });

  httpServer.listen(PORT, () => {
    console.error(`Travel MCP Server (Streamable HTTP) running on http://localhost:${PORT}`);
    console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.error(`Health check: http://localhost:${PORT}/health`);
    console.error(`Preview: http://localhost:${PORT}/preview/poi/{osm_id}`);
    console.error(`Preview random: http://localhost:${PORT}/preview/poi/random`);
    console.error(`Template demo: http://localhost:${PORT}/preview/demo`);
  });
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.error('SIGTERM received, shutting down...');
  await telemetry.flush();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.error('SIGINT received, shutting down...');
  await telemetry.flush();
  process.exit(0);
});

main().catch(async (error) => {
  console.error('Server error:', error);
  telemetry.captureException(error, { context: 'server_startup' });
  await telemetry.flush();
  process.exit(1);
});
