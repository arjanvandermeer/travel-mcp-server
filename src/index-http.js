#!/usr/bin/env node

// IMPORTANT: Import Sentry first for auto-instrumentation of pg, http, etc.
import './sentry-init.js';

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
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TravelDatabase } from './database.js';
import * as telemetry from './telemetry.js';
import { render } from './templates/index.js';
import { getToolsConfig, getResourcesConfig, executeToolHandler, handleReadResource, renderPOIPreview, promptsConfig, getPromptMessages } from './tools-config.js';
import { versionInfo, getVersionString } from './version.js';
import http from 'http';
import crypto from 'crypto';
import { parse } from 'url';

const db = new TravelDatabase();
const PORT = process.argv[2] ? parseInt(process.argv[2]) : 3000;

// Store active sessions: sessionId -> { server, transport, user }
const sessions = new Map();

/**
 * Extract user from Authorization header
 * Returns null for anonymous requests (which is fine - auth is optional)
 * Supports both Phase 1 (database tokens) and Phase 2 (OAuth tokens via introspection)
 */
async function getUserFromRequest(req) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;

  const token = auth.slice(7);
  try {
    // First try database lookup (Phase 1 tokens)
    const dbUser = await db.getUserByToken(token);
    if (dbUser) {
      console.error(`Authenticated user (DB): ${dbUser.email}`);
      telemetry.setTag('user.email', dbUser.email);
      telemetry.setTag('user.id', dbUser.id.toString());
      return dbUser;
    }

    // Try OAuth introspection (Phase 2 tokens)
    const introspectionUrl = process.env.OAUTH_INTROSPECTION_URL ||
      (process.env.OAUTH_ISSUER ? `${process.env.OAUTH_ISSUER}/introspect` : null);

    if (introspectionUrl) {
      const response = await fetch(introspectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.active) {
          console.error(`Authenticated user (OAuth): ${data.email}`);
          telemetry.setTag('user.email', data.email);
          telemetry.setTag('user.oauth', 'true');

          // Return OAuth user info (no DB id yet)
          return {
            id: null,
            email: data.email,
            name: data.name,
            picture_url: data.picture,
            google_id: data.sub,
            config: {},  // Default config for OAuth users
          };
        }
      }
    }

    return null;
  } catch (err) {
    console.error('Error validating token:', err.message);
    return null;
  }
}

/**
 * Create a new MCP Server instance with all handlers configured
 * @param {object|null} user - Authenticated user or null for anonymous
 */
function createMCPServer(user = null) {
  const server = new Server(
    {
      name: 'travel-mcp-server',
      version: getVersionString(),
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Get widget domain from database config for UI tools' CSP (cached)
    const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
    return { tools: getToolsConfig(widgetDomain) };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Add breadcrumb for debugging
    telemetry.addBreadcrumb(`Tool call: ${name}`, 'mcp.tool', args);

    return telemetry.withTransaction(`mcp.tool.${name}`, 'mcp.request', async () => {
      try {
        // Pass user context to tool handler (null for anonymous)
        return await executeToolHandler(name, args, db, { user });
      } catch (error) {
        telemetry.captureException(error, { tool: name, args, user: user?.email });
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  });

  // List available resources (MCP Apps)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // Get widget domain from database config (full URL required per OpenAI docs) (cached)
    const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
    return getResourcesConfig(widgetDomain);
  });

  // Read resource content (MCP Apps)
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    return handleReadResource(uri, db, render);
  });

  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: promptsConfig };
  });

  // Get prompt content
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return getPromptMessages(name, args);
  });

  return server;
}

// Create HTTP server with Streamable HTTP transport (multi-session support)
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

  const httpServer = http.createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Log all incoming requests
    console.error(`[${req.method}] ${pathname}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, MCP-Protocol-Version, Authorization');
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
        version: versionInfo.version,
        gitTag: versionInfo.gitTag,
        gitCommit: versionInfo.gitCommitShort,
        gitBranch: versionInfo.gitBranch,
        buildTime: versionInfo.buildTime,
        transport: 'streamable-http',
        activeSessions: sessions.size,
        endpoints: {
          mcp: '/mcp',
          health: '/health',
          preview: '/preview/poi/{osm_id}',
        },
      }));
      return;
    }

    // OAuth Protected Resource Metadata (RFC 9728)
    // Tells MCP clients which OAuth server to use for authentication
    if (pathname === '/.well-known/oauth-protected-resource') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        resource: process.env.SERVER_BASE_URL || 'https://mcp.arjanvandermeer.com',
        authorization_servers: [process.env.OAUTH_ISSUER || 'https://travel-mcp-oauth.cloudflare-com-91b.workers.dev'],
        scopes_supported: ['openid', 'profile', 'email'],
        bearer_methods_supported: ['header'],
      }));
      return;
    }

    // Random POI preview endpoint
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

    // MCP endpoint - handles all MCP requests with multi-session support
    if (pathname === '/mcp' || pathname === '/') {
      try {
        // Check for existing session
        const sessionId = req.headers['mcp-session-id'];

        if (sessionId && sessions.has(sessionId)) {
          // Existing session - route to its transport
          const session = sessions.get(sessionId);
          await session.transport.handleRequest(req, res);
        } else {
          // No session ID or invalid/expired session - create new session
          // Check for authentication (optional - null means anonymous)
          const user = await getUserFromRequest(req);

          const newSessionId = crypto.randomUUID();
          const server = createMCPServer(user);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
          });

          // Connect server to transport
          await server.connect(transport);

          // Store session with user context
          sessions.set(newSessionId, { server, transport, createdAt: Date.now(), user });

          if (sessionId) {
            console.error(`Session expired, created new: ${newSessionId} (total: ${sessions.size})${user ? ` [${user.email}]` : ''}`);
          } else {
            console.error(`New session created: ${newSessionId} (total: ${sessions.size})${user ? ` [${user.email}]` : ''}`);
          }

          // Handle the request
          await transport.handleRequest(req, res);
        }
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

  // Clean up stale sessions every 5 minutes
  setInterval(() => {
    const maxAge = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (now - session.createdAt > maxAge) {
        sessions.delete(sessionId);
        console.error(`Session expired: ${sessionId} (remaining: ${sessions.size})`);
      }
    }
  }, 5 * 60 * 1000);

  httpServer.listen(PORT, () => {
    console.error(`Travel MCP Server (Streamable HTTP) running on port ${PORT}`);
    console.error(`Version: ${versionInfo.version} (${versionInfo.gitCommitShort})`);
    console.error(`Multi-session support: enabled`);
    console.error(`MCP endpoint: /mcp`);
    console.error(`Health check: /health`);
    console.error(`Preview: /preview/poi/{osm_id}`);
    console.error(`Preview random: /preview/poi/random`);
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
