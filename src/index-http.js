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
import { getToolsConfig, getResourcesConfig, executeToolHandler, handleReadResource, renderPOIPreview, renderNearbyWidget, getNearbyTypes, fetchNearbyForPOI, promptsConfig, getPromptMessages } from './tools-config.js';
import { versionInfo, getVersionString } from './version.js';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'url';
import { ApiRouter, parseCookies } from './api-router.js';
import { registerCountryRoutes } from './api/countries.js';
import { registerSearchRoutes } from './api/search.js';
import { registerAutocompleteRoutes } from './api/autocomplete.js';
import { registerPOIRoutes } from './api/poi.js';
import { registerFavoritesRoutes } from './api/favorites.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerHomepageRoutes } from './api/homepage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Obfuscate email for logging — masks the local part before @.
 * "arjanvdm@gmail.com" → "a******m@gmail.com"
 */
function obfuscateEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}

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
  if (!auth?.startsWith('Bearer ')) {
    console.error('[Auth] No Bearer token provided');
    return null;
  }

  const token = auth.slice(7);
  const tokenPrefix = token.slice(0, 8);
  const tokenLength = token.length;
  console.error(`[Auth] Token received: ${tokenPrefix}... (${tokenLength} chars)`);

  // Basic token validation - catch obviously malformed tokens
  if (tokenLength < 10) {
    console.error(`[Auth] Token too short: ${tokenLength} chars`);
    telemetry.incrementCounter('auth.failure', 1, { reason: 'token_too_short' });
    telemetry.captureMessage('Auth failed: token too short', 'warning', {
      reason: 'token_too_short',
      tokenLength,
      tokenPrefix,
    });
    return null;
  }

  // Track auth attempt
  telemetry.incrementCounter('auth.attempts', 1);
  telemetry.addBreadcrumb('Auth attempt started', 'auth', { tokenPrefix, tokenLength });
  const authStartTime = Date.now();

  try {
    // First try database lookup (Phase 1 tokens)
    console.error('[Auth] Trying database token lookup...');
    const dbUser = await db.getUserByToken(token);
    if (dbUser) {
      const authDuration = Date.now() - authStartTime;
      console.error(`[Auth] DB auth success: ${obfuscateEmail(dbUser.email)} (${authDuration}ms)`);

      // Telemetry: successful DB auth
      telemetry.incrementCounter('auth.success', 1, { method: 'database' });
      telemetry.recordDistribution('auth.latency', authDuration, { tags: { method: 'database', status: 'success' }, unit: 'millisecond' });
      telemetry.setUser({ id: dbUser.id.toString(), email: dbUser.email, username: dbUser.name });
      telemetry.setTag('user.id', dbUser.id.toString());
      telemetry.setTag('auth.method', 'database');
      telemetry.captureMessage(`Auth success: user ${dbUser.id}`, 'info', {
        method: 'database',
        userId: dbUser.id,
        email: dbUser.email,
        duration: authDuration,
      });

      return dbUser;
    }

    console.error('[Auth] DB lookup failed, trying OAuth introspection...');
    telemetry.addBreadcrumb('DB token lookup failed, trying OAuth', 'auth');

    // Try OAuth introspection (Phase 2 tokens)
    // Get OAuth issuer from database config (preferred) or fall back to env var
    const oauthIssuer = await db.getConfigCached('oauth_issuer') || process.env.OAUTH_ISSUER;
    const introspectionUrl = process.env.OAUTH_INTROSPECTION_URL ||
      (oauthIssuer ? `${oauthIssuer}/introspect` : null);
    console.error(`[Auth] OAuth issuer: ${oauthIssuer || 'not configured'}`);
    console.error(`[Auth] Introspection URL: ${introspectionUrl || 'not configured'}`);

    if (introspectionUrl) {
      const introspectStartTime = Date.now();
      const response = await fetch(introspectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      const introspectDuration = Date.now() - introspectStartTime;
      telemetry.recordDistribution('auth.oauth_introspect.latency', introspectDuration, { unit: 'millisecond' });

      console.error(`[Auth] Introspection response: ${response.status}`);
      if (response.ok) {
        const data = await response.json();
        console.error(`[Auth] Introspection data: active=${data.active}, email=${data.email ? obfuscateEmail(data.email) : 'none'}`);

        if (data.active) {
          // Auto-provision user in database (creates if new, updates if existing)
          const user = await db.upsertGoogleUser(data.sub, data.email, data.name, data.picture);
          const authDuration = Date.now() - authStartTime;
          console.error(`[Auth] OAuth auth success: ${obfuscateEmail(user.email)} (${authDuration}ms)`);

          // Telemetry: successful OAuth auth
          telemetry.incrementCounter('auth.success', 1, { method: 'oauth' });
          telemetry.recordDistribution('auth.latency', authDuration, { tags: { method: 'oauth', status: 'success' }, unit: 'millisecond' });
          telemetry.setUser({ id: user.id.toString(), email: user.email, username: user.name });
          telemetry.setTag('user.id', user.id.toString());
          telemetry.setTag('auth.method', 'oauth');
          telemetry.setTag('user.oauth', 'true');
          telemetry.captureMessage(`Auth success: user ${user.id}`, 'info', {
            method: 'oauth',
            userId: user.id,
            email: user.email,
            duration: authDuration,
            introspectDuration,
          });

          return user;
        } else {
          const authDuration = Date.now() - authStartTime;
          console.error(`[Auth] Token not active (${authDuration}ms)`);
          // Determine specific reason from introspection response
          // - If no sub/email: token was never issued (forged/fake)
          // - If has sub but exp < now: token expired
          // - If has sub and no exp issue: token was revoked or otherwise invalidated
          let inactiveReason;
          if (data.error) {
            inactiveReason = data.error;
          } else if (!data.sub && !data.email) {
            inactiveReason = 'not_found'; // Token was never issued - likely forged
          } else if (data.exp && data.exp < Date.now() / 1000) {
            inactiveReason = 'expired';
          } else {
            inactiveReason = 'revoked'; // Has user data but inactive - likely revoked
          }

          const severity = inactiveReason === 'not_found' ? 'error' : 'warning';
          telemetry.incrementCounter('auth.failure', 1, { reason: 'token_inactive', method: 'oauth', inactive_reason: inactiveReason });
          telemetry.recordDistribution('auth.latency', authDuration, { tags: { method: 'oauth', status: 'failure' }, unit: 'millisecond' });
          telemetry.captureMessage(`Auth failed: token not active (${inactiveReason})`, severity, {
            reason: 'token_inactive',
            inactiveReason,
            tokenPrefix,
            tokenLength,
            duration: authDuration,
            // Include any context from introspection (will be empty for forged tokens)
            hasSub: !!data.sub,
            hasEmail: !!data.email,
            hasExp: !!data.exp,
            introspectionError: data.error,
            introspectionErrorDesc: data.error_description,
          });
        }
      } else {
        const authDuration = Date.now() - authStartTime;
        const errorText = await response.text();
        console.error(`[Auth] Introspection error: ${response.status} - ${errorText.slice(0, 100)}`);
        telemetry.incrementCounter('auth.failure', 1, { reason: 'introspection_error', method: 'oauth' });
        telemetry.recordDistribution('auth.latency', authDuration, { tags: { method: 'oauth', status: 'failure' }, unit: 'millisecond' });
        telemetry.captureMessage(`Auth failed: introspection error (${response.status})`, 'warning', {
          reason: 'introspection_error',
          httpStatus: response.status,
          errorText: errorText.slice(0, 200),
          tokenPrefix,
          duration: authDuration,
        });
      }
    } else {
      console.error('[Auth] No introspection URL configured - cannot validate OAuth token');
      telemetry.incrementCounter('auth.failure', 1, { reason: 'no_introspection_url' });
      telemetry.captureMessage('Auth failed: no introspection URL configured', 'warning', {
        reason: 'no_introspection_url',
        tokenPrefix,
      });
    }

    console.error('[Auth] Auth failed: invalid token');
    telemetry.incrementCounter('auth.failure', 1, { reason: 'invalid_token' });
    return null;
  } catch (err) {
    const authDuration = Date.now() - authStartTime;
    console.error(`[Auth] Auth exception: ${err.message}`);

    // Telemetry: exception during auth
    telemetry.incrementCounter('auth.failure', 1, { reason: 'exception' });
    telemetry.recordDistribution('auth.latency', authDuration, { tags: { status: 'error' }, unit: 'millisecond' });
    telemetry.captureException(err, {
      context: 'auth_validation',
      tokenPrefix,
      duration: authDuration,
    });
    telemetry.captureMessage(`Auth failed: ${err.message}`, 'error', {
      reason: 'exception',
      error: err.message,
      tokenPrefix,
      duration: authDuration,
    });

    return null;
  }
}

/**
 * Create a new MCP Server instance with all handlers configured
 * @param {object|null} user - Authenticated user or null for anonymous
 */
/**
 * Create MCP server with mutable user reference
 * @param {Object} userRef - Object with 'current' property holding the user (can be updated mid-session)
 */
function createMCPServer(userRef = { current: null }) {
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
        // Pass user context to tool handler (dynamically read from ref)
        return await executeToolHandler(name, args, db, { user: userRef.current });
      } catch (error) {
        telemetry.captureException(error, { tool: name, args, userId: userRef.current?.id });
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
    try {
      return await handleReadResource(uri, db, render);
    } catch (error) {
      console.error(`ReadResource failed: ${uri}`, error.message);
      telemetry.captureException(error, { resource: uri });
      return {
        contents: [{ uri, mimeType: 'text/plain', text: `Error: ${error.message}` }],
      };
    }
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

  // Set up API router for /api/v1/* and /auth/* routes
  const apiRouter = new ApiRouter();
  registerCountryRoutes(apiRouter);
  registerSearchRoutes(apiRouter);
  registerAutocompleteRoutes(apiRouter);
  registerPOIRoutes(apiRouter);
  registerFavoritesRoutes(apiRouter);
  registerAuthRoutes(apiRouter);
  registerHomepageRoutes(apiRouter);

  // Static file MIME types
  const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
  };

  const WEB_DIR = path.join(__dirname, '..', 'web');

  const httpServer = http.createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Log all incoming requests (except health checks to reduce noise)
    if (pathname !== '/health') {
      console.error(`[${req.method}] ${pathname}`);
    }

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
      const serverBaseUrl = await db.getServerBaseUrl() || 'http://localhost:3000';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        resource: serverBaseUrl,
        authorization_servers: [process.env.OAUTH_ISSUER || 'https://travel-mcp-oauth.cloudflare-com-91b.workers.dev'],
        scopes_supported: ['openid', 'profile', 'email'],
        bearer_methods_supported: ['header'],
      }));
      return;
    }

    // Random POI preview endpoint
    if (pathname === '/preview/poi/random') {
      try {
        let poi = await db.getRandomPOI();
        if (!poi) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>No POIs found</h1>');
          return;
        }
        const user = await getUserFromRequest(req);
        if (user) {
          [poi] = await db.addFavoriteStatus([poi], user.id);
        }
        const { nearbyPois, nearbyTitle } = await fetchNearbyForPOI(poi, db, user?.id);
        const html = renderPOIPreview(poi, render, nearbyPois, nearbyTitle);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        console.error('Error rendering random POI:', err);
        telemetry.captureException(err, { context: 'preview_random_poi' });
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Internal Server Error</h1>');
      }
      return;
    }

    // Nearby POIs preview endpoint
    const nearbyMatch = pathname.match(/^\/preview\/poi\/(\d+)\/nearby$/);
    if (nearbyMatch) {
      try {
        const osmId = parseInt(nearbyMatch[1], 10);
        const sourcePoi = await db.getPOIDetails(osmId);
        if (!sourcePoi) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(`<h1>POI not found</h1><p>OSM ID: ${osmId}</p>`);
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const typesParam = url.searchParams.get('types');
        const radiusParam = parseFloat(url.searchParams.get('radius')) || 1.5;
        const limitParam = parseInt(url.searchParams.get('limit'), 10) || 5;

        const resultTypes = typesParam
          ? typesParam.split(',').map(t => t.trim())
          : getNearbyTypes(sourcePoi.poi_type);

        const nearbyPois = await db.searchPOIsNearCoordinates(
          sourcePoi.osm_latitude,
          sourcePoi.osm_longitude,
          Math.min(radiusParam, 10),
          resultTypes,
          Math.min(limitParam, 20),
          null,
          [sourcePoi.osm_id],
        );

        const html = renderNearbyWidget(sourcePoi, nearbyPois, render);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        console.error('Error rendering nearby POIs:', err);
        telemetry.captureException(err, { context: 'preview_nearby_pois' });
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Internal Server Error</h1>');
      }
      return;
    }

    const poiPreviewMatch = pathname.match(/^\/preview\/poi\/(\d+)$/);
    if (poiPreviewMatch) {
      try {
        const osmId = parseInt(poiPreviewMatch[1], 10);
        let poi = await db.getPOIDetails(osmId);
        if (!poi) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(`<h1>POI not found</h1><p>OSM ID: ${osmId}</p>`);
          return;
        }
        const user = await getUserFromRequest(req);
        if (user) {
          [poi] = await db.addFavoriteStatus([poi], user.id);
        }
        const { nearbyPois: poiNearby, nearbyTitle: poiNearbyTitle } = await fetchNearbyForPOI(poi, db, user?.id);
        const html = renderPOIPreview(poi, render, poiNearby, poiNearbyTitle);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        console.error('Error rendering POI:', err);
        telemetry.captureException(err, { context: 'preview_poi', osmId: parseInt(poiPreviewMatch[1], 10) });
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Internal Server Error</h1>');
      }
      return;
    }

    // API routes (/api/v1/* and /auth/*)
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
      // Extract user from session cookie (web frontend) or Bearer token (API clients)
      const cookies = parseCookies(req);
      let user;
      if (cookies.session) {
        // Create a fake request with Authorization header for getUserFromRequest
        const fakeReq = { headers: { authorization: `Bearer ${cookies.session}` } };
        user = await getUserFromRequest(fakeReq);
      } else {
        user = await getUserFromRequest(req);
      }

      const handled = await apiRouter.handle(req, res, { db, user });
      if (handled) return;
      // If no route matched, fall through to 404
    }

    // Static file serving for web frontend
    if (req.method === 'GET' && !pathname.startsWith('/mcp')) {
      // Serve index.html for SPA routes (no extension = SPA route)
      let filePath;
      if (pathname === '/' || !path.extname(pathname)) {
        filePath = path.join(WEB_DIR, 'index.html');
      } else {
        // Prevent directory traversal: resolve full path and verify it's within WEB_DIR
        filePath = path.resolve(WEB_DIR, pathname.slice(1));
        if (!filePath.startsWith(WEB_DIR)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
      }

      // Check if file exists
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const ext = path.extname(filePath);
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      } catch {
        // File not found — fall through to MCP or 404
      }
    }

    // MCP endpoint - handles all MCP requests with multi-session support
    if (pathname === '/mcp') {
      try {
        // Check for existing session
        const sessionId = req.headers['mcp-session-id'];

        if (sessionId && sessions.has(sessionId)) {
          // Existing session - check if auth has changed
          const session = sessions.get(sessionId);
          const newUser = await getUserFromRequest(req);

          // Update user if authentication changed (anonymous -> authenticated or different user)
          if (newUser && (!session.userRef.current || session.userRef.current.email !== newUser.email)) {
            const wasAnonymous = !session.userRef.current;
            session.userRef.current = newUser;
            console.error(`Session ${sessionId} authenticated: ${obfuscateEmail(newUser.email)}`);

            // Telemetry: mid-session authentication upgrade
            telemetry.incrementCounter('session.auth_upgrade', 1, { from: wasAnonymous ? 'anonymous' : 'different_user' });
            telemetry.captureMessage(`Session authenticated mid-stream: user ${newUser.id}`, 'info', {
              sessionId,
              userId: newUser.id,
              wasAnonymous,
            });
          }

          telemetry.incrementCounter('session.requests', 1, { type: 'existing' });
          await session.transport.handleRequest(req, res);
        } else {
          // No session ID or invalid/expired session - create new session
          // Check for authentication (optional - null means anonymous)
          const user = await getUserFromRequest(req);
          const userRef = { current: user };

          const newSessionId = crypto.randomUUID();
          const server = createMCPServer(userRef);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
          });

          // Connect server to transport
          await server.connect(transport);

          // Store session with mutable user reference
          sessions.set(newSessionId, { server, transport, createdAt: Date.now(), userRef });

          if (sessionId) {
            console.error(`Session expired, created new: ${newSessionId} (total: ${sessions.size})${user ? ` [${obfuscateEmail(user.email)}]` : ''}`);
            // Telemetry: session expired and recreated
            telemetry.incrementCounter('session.expired', 1);
            telemetry.captureMessage('Session expired, created new', 'info', {
              oldSessionId: sessionId,
              newSessionId,
              totalSessions: sessions.size,
              authenticated: !!user,
              userId: user?.id,
            });
          } else {
            console.error(`New session created: ${newSessionId} (total: ${sessions.size})${user ? ` [${obfuscateEmail(user.email)}]` : ''}`);
            // Telemetry: new session created
            telemetry.incrementCounter('session.created', 1, { authenticated: user ? 'true' : 'false' });
            telemetry.captureMessage('New session created', 'info', {
              sessionId: newSessionId,
              totalSessions: sessions.size,
              authenticated: !!user,
              userId: user?.id,
            });
          }

          // Track active sessions gauge
          telemetry.recordGauge('session.active', sessions.size);
          telemetry.incrementCounter('session.requests', 1, { type: 'new' });

          // Handle the request
          await transport.handleRequest(req, res);
        }
      } catch (err) {
        console.error('Error handling MCP request:', err);
        telemetry.incrementCounter('mcp.request_errors', 1);
        telemetry.captureException(err, { context: 'mcp_request_handler', pathname });
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
    let expiredCount = 0;
    for (const [sessionId, session] of sessions) {
      if (now - session.createdAt > maxAge) {
        const wasAuthenticated = !!session.userRef?.current;
        sessions.delete(sessionId);
        expiredCount++;
        console.error(`Session expired: ${sessionId} (remaining: ${sessions.size})`);

        // Telemetry: session cleanup
        telemetry.incrementCounter('session.cleanup_expired', 1, { wasAuthenticated: wasAuthenticated ? 'true' : 'false' });
      }
    }
    // Update active sessions gauge after cleanup
    if (expiredCount > 0) {
      telemetry.recordGauge('session.active', sessions.size);
      telemetry.captureMessage(`Session cleanup: ${expiredCount} expired`, 'info', {
        expiredCount,
        remainingSessions: sessions.size,
      });
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
    console.error(`Web API: /api/v1/*`);
    console.error(`Web auth: /auth/*`);
    console.error(`Web frontend: / (serves web/ directory)`);

    // Warm expensive caches in background (countries query is slow on cold DB)
    db.listCountriesWithData()
      .then(rows => console.error(`Cache warm-up: ${rows.length} countries loaded`))
      .catch(err => console.error('Cache warm-up failed (will retry on first request):', err.message));
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
