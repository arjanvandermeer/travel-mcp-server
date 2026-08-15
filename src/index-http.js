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

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TravelDatabase } from './database.js';
import * as telemetry from './telemetry.js';
import { createTravelMCPServer } from './mcp-server-factory.js';
import { versionInfo } from './version.js';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import { ApiRouter } from './api-router.js';
import { registerSearchRoutes } from './api/search.js';
import { registerPOIRoutes } from './api/poi.js';
import { registerFavoritesRoutes } from './api/favorites.js';
import {
  SESSION_MAX_AGE_MS,
  SESSION_CLEANUP_INTERVAL_MS,
  SESSION_MAX_ACTIVE,
  SESSION_CREATE_WINDOW_MS,
  SESSION_CREATE_MAX_PER_WINDOW,
  AUTH_TOKEN_MIN_LENGTH,
  OAUTH_INTROSPECTION_CACHE_TTL_MS,
} from './config.js';
import { obfuscateEmail } from './log-utils.js';

let db;
try {
  db = new TravelDatabase();
} catch (err) {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
}
const PORT = process.argv[2] ? parseInt(process.argv[2]) : 3000;

// Store active sessions: sessionId -> { server, transport, user }
const sessions = new Map();
const sessionCreationBuckets = new Map();

// Cache OAuth introspection results: token -> { user, expiry }
const introspectionCache = new Map();

function authCacheKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function assetVersion() {
  return encodeURIComponent([versionInfo.gitCommitShort || versionInfo.version, versionInfo.buildTime].filter(Boolean).join('-'));
}

function renderHomepage() {
  const file = new URL('../public/index.html', import.meta.url);
  return fs.readFileSync(file, 'utf8')
    .replace('href="/home.css"', `href="/home.css?v=${assetVersion()}"`)
    .replace('src="/home.js"', `src="/home.js?v=${assetVersion()}"`);
}

function renderPoiPage() {
  const file = new URL('../web/index.html', import.meta.url);
  const html = fs.readFileSync(file, 'utf8');
  const currentAssetVersion = assetVersion();
  const commitLabel = versionInfo.gitCommitShort || versionInfo.version || 'local';
  const commitUrl = versionInfo.gitCommit
    ? `https://github.com/arjanvandermeer/travel-mcp-server/commit/${versionInfo.gitCommit}`
    : 'https://github.com/arjanvandermeer/travel-mcp-server';

  return html
    .replace('href="/css/style.css"', `href="/css/style.css?v=${currentAssetVersion}"`)
    .replace('href="/css/dossier.css"', `href="/css/dossier.css?v=${currentAssetVersion}"`)
    .replace('src="/js/app.js"', `src="/js/app.js?v=${currentAssetVersion}"`)
    .replaceAll('__APP_COMMIT__', commitLabel)
    .replaceAll('__APP_COMMIT_URL__', commitUrl);
}

function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function canCreateSession(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const cutoff = now - SESSION_CREATE_WINDOW_MS;
  const bucket = (sessionCreationBuckets.get(key) || []).filter(timestamp => timestamp > cutoff);
  if (bucket.length >= SESSION_CREATE_MAX_PER_WINDOW) {
    sessionCreationBuckets.set(key, bucket);
    return false;
  }
  bucket.push(now);
  sessionCreationBuckets.set(key, bucket);
  return true;
}

function deleteSession(sessionId, reason = 'deleted') {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  telemetry.incrementCounter('session.deleted', 1, {
    reason,
    wasAuthenticated: session?.userRef?.current ? 'true' : 'false',
  });
}

function cleanupExpiredSessions() {
  const maxAge = SESSION_MAX_AGE_MS;
  const now = Date.now();
  let expiredCount = 0;
  for (const [sessionId, session] of sessions) {
    if (now - (session.lastAccessedAt || session.createdAt) > maxAge) {
      deleteSession(sessionId, 'expired');
      expiredCount++;
      console.error(`Session expired: ${sessionId} (remaining: ${sessions.size})`);
    }
  }
  if (expiredCount > 0) {
    telemetry.recordGauge('session.active', sessions.size);
    telemetry.captureLog('Session cleanup expired sessions', 'info', {
      expiredCount,
      remainingSessions: sessions.size,
    }, {
      breadcrumbCategory: 'session',
    });
  }
  return expiredCount;
}

function cleanupSessionCreationBuckets() {
  const cutoff = Date.now() - SESSION_CREATE_WINDOW_MS;
  for (const [key, timestamps] of sessionCreationBuckets) {
    const active = timestamps.filter(timestamp => timestamp > cutoff);
    if (active.length > 0) {
      sessionCreationBuckets.set(key, active);
    } else {
      sessionCreationBuckets.delete(key);
    }
  }
}

function ensureSessionCapacity(incomingAuthenticated) {
  if (sessions.size < SESSION_MAX_ACTIVE) return true;

  const ordered = [...sessions.entries()].sort((a, b) =>
    (a[1].lastAccessedAt || a[1].createdAt) - (b[1].lastAccessedAt || b[1].createdAt)
  );
  let victim = ordered.find(([, session]) => !session.userRef?.current);
  if (!victim && incomingAuthenticated) {
    victim = ordered[0];
  }
  if (!victim) return false;

  deleteSession(victim[0], 'capacity');
  telemetry.recordGauge('session.active', sessions.size);
  return true;
}

/**
 * Extract user from Authorization header
 * Returns null for anonymous requests (which is fine - auth is optional)
 * Supports both Phase 1 (database tokens) and Phase 2 (OAuth tokens via introspection)
 */
async function getUserFromRequest(req) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return null;
  }

  const token = auth.slice(7);
  const tokenLength = token.length;

  // Basic token validation - catch obviously malformed tokens
  if (tokenLength < AUTH_TOKEN_MIN_LENGTH) {
    console.error('[Auth] Token too short');
    telemetry.incrementCounter('auth.failure', 1, { reason: 'token_too_short' });
    telemetry.captureLog('Auth failed: token too short', 'warn', {
      reason: 'token_too_short',
    }, {
      breadcrumbCategory: 'auth',
    });
    return null;
  }

  // Check introspection cache
  const cacheKey = authCacheKey(token);
  const cached = introspectionCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    console.error(`[Auth] Cache hit for ${obfuscateEmail(cached.user.email)}`);
    telemetry.incrementCounter('auth.cache_hit', 1);
    telemetry.setUser({ id: cached.user.id.toString(), email: obfuscateEmail(cached.user.email), username: cached.user.name });
    telemetry.setTag('user.id', cached.user.id.toString());
    return cached.user;
  }

  // Track auth attempt
  telemetry.incrementCounter('auth.attempts', 1);
  telemetry.addBreadcrumb('Auth attempt started', 'auth');
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
      telemetry.setUser({ id: dbUser.id.toString(), email: obfuscateEmail(dbUser.email), username: dbUser.name });
      telemetry.setTag('user.id', dbUser.id.toString());
      telemetry.setTag('auth.method', 'database');
      telemetry.addBreadcrumb('Auth success', 'auth', {
        method: 'database',
        userId: dbUser.id,
        duration: authDuration,
      });

      introspectionCache.set(cacheKey, { user: dbUser, expiry: Date.now() + OAUTH_INTROSPECTION_CACHE_TTL_MS });
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
          telemetry.setUser({ id: user.id.toString(), email: obfuscateEmail(user.email), username: user.name });
          telemetry.setTag('user.id', user.id.toString());
          telemetry.setTag('auth.method', 'oauth');
          telemetry.setTag('user.oauth', 'true');
          telemetry.addBreadcrumb('Auth success', 'auth', {
            method: 'oauth',
            userId: user.id,
            duration: authDuration,
            introspectDuration,
          });

          introspectionCache.set(cacheKey, { user, expiry: Date.now() + OAUTH_INTROSPECTION_CACHE_TTL_MS });
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
          telemetry.captureLog('Auth failed: token not active', severity, {
            reason: 'token_inactive',
            inactiveReason,
            duration: authDuration,
            // Include any context from introspection (will be empty for forged tokens)
            hasSub: !!data.sub,
            hasEmail: !!data.email,
            hasExp: !!data.exp,
            introspectionError: data.error,
            introspectionErrorDesc: data.error_description,
          }, {
            breadcrumbCategory: 'auth',
          });
        }
      } else {
        const authDuration = Date.now() - authStartTime;
        const errorText = await response.text();
        console.error(`[Auth] Introspection error: ${response.status} - ${errorText.slice(0, 100)}`);
        telemetry.incrementCounter('auth.failure', 1, { reason: 'introspection_error', method: 'oauth' });
        telemetry.recordDistribution('auth.latency', authDuration, { tags: { method: 'oauth', status: 'failure' }, unit: 'millisecond' });
        telemetry.captureLog('Auth failed: introspection error', 'warn', {
          reason: 'introspection_error',
          httpStatus: response.status,
          errorText: errorText.slice(0, 200),
          duration: authDuration,
        }, {
          breadcrumbCategory: 'auth',
        });
      }
    } else {
      console.error('[Auth] No introspection URL configured - cannot validate OAuth token');
      telemetry.incrementCounter('auth.failure', 1, { reason: 'no_introspection_url' });
      telemetry.captureLog('Auth failed: no introspection URL configured', 'warn', {
        reason: 'no_introspection_url',
      }, {
        breadcrumbCategory: 'auth',
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
      duration: authDuration,
    });
    telemetry.captureLog('Auth validation threw', 'error', {
      reason: 'exception',
      error: err.message,
      duration: authDuration,
    }, {
      breadcrumbCategory: 'auth',
    });

    return null;
  }
}

/**
 * Create MCP server with mutable user reference
 * @param {Object} userRef - Object with 'current' property holding the user (can be updated mid-session)
 */
function createMCPServer(userRef = { current: null }) {
  return createTravelMCPServer({ db, userRef });
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

  // Initialize Google Places explicitly after the database connection is known-good.
  try {
    await db.initializeGooglePlaces();
    console.error('Google Places client initialized');
  } catch (err) {
    console.warn('Failed to initialize Google Places client:', err.message);
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

  // Set up the public REST API.
  const apiRouter = new ApiRouter();
  registerSearchRoutes(apiRouter);
  registerPOIRoutes(apiRouter);
  registerFavoritesRoutes(apiRouter);
  const openApiSpecUrl = new URL('../doc/openapi.yaml', import.meta.url);
  const homepageAssets = new Map([
    ['/', { file: new URL('../public/index.html', import.meta.url), contentType: 'text/html; charset=utf-8', cacheControl: 'no-store, max-age=0', isHomepage: true }],
    ['/home.css', { file: new URL('../public/home.css', import.meta.url), contentType: 'text/css; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/home.js', { file: new URL('../public/home.js', import.meta.url), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/css/style.css', { file: new URL('../web/css/style.css', import.meta.url), contentType: 'text/css; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/css/dossier.css', { file: new URL('../web/css/dossier.css', import.meta.url), contentType: 'text/css; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/js/api.js', { file: new URL('../web/js/api.js', import.meta.url), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/js/app.js', { file: new URL('../web/js/app.js', import.meta.url), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/js/constants.js', { file: new URL('../web/js/constants.js', import.meta.url), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/js/format-store.js', { file: new URL('../web/js/format-store.js', import.meta.url), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/js/map-utils.js', { file: new URL('../web/js/map-utils.js', import.meta.url), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/js/proximity.js', { file: new URL('../web/js/proximity.js', import.meta.url), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' }],
    ['/favicon.ico', { file: new URL('../web/favicon.ico', import.meta.url), contentType: 'image/x-icon', cacheControl: 'public, max-age=86400' }],
    ['/favicon.png', { file: new URL('../web/favicon.png', import.meta.url), contentType: 'image/png', cacheControl: 'public, max-age=86400' }],
  ]);

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // Log all incoming requests (except health checks to reduce noise)
    if (pathname !== '/health') {
      console.error(`[${req.method}] ${pathname}`);
    }

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, MCP-Protocol-Version, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const homepageAsset = homepageAssets.get(pathname) || (/^\/poi\/\d+$/.test(pathname)
      ? { file: new URL('../web/index.html', import.meta.url), contentType: 'text/html; charset=utf-8', cacheControl: 'no-store, max-age=0', isPoiPage: true }
      : null);
    if ((req.method === 'GET' || req.method === 'HEAD') && homepageAsset) {
      res.writeHead(200, {
        'Content-Type': homepageAsset.contentType,
        'Cache-Control': homepageAsset.cacheControl,
        'Content-Security-Policy': homepageAsset.isPoiPage
          ? "default-src 'self'; connect-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
          : "default-src 'self'; connect-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        'Referrer-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      if (homepageAsset.isPoiPage) {
        res.end(renderPoiPage());
        return;
      }
      if (homepageAsset.isHomepage) {
        res.end(renderHomepage());
        return;
      }
      fs.createReadStream(homepageAsset.file).pipe(res);
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/openapi.yaml') {
      res.writeHead(200, {
        'Content-Type': 'application/yaml',
        'Cache-Control': 'no-store, max-age=0',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(openApiSpecUrl).pipe(res);
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
          rest: '/api/v1/*',
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
        authorization_servers: [await db.getConfigCached('oauth_issuer') || process.env.OAUTH_ISSUER],
        scopes_supported: ['openid', 'profile', 'email'],
        bearer_methods_supported: ['header'],
      }));
      return;
    }

    // REST API routes are bearer-token authenticated where required.
    if (pathname.startsWith('/api/')) {
      const user = await getUserFromRequest(req);
      const handled = await apiRouter.handle(req, res, { db, user });
      if (handled) return;
      // If no route matched, fall through to 404
    }

    // MCP endpoint - handles all MCP requests with multi-session support
    if (pathname === '/mcp') {
      try {
        // Check for existing session
        const sessionId = req.headers['mcp-session-id'];

        if (sessionId && sessions.has(sessionId)) {
          // Existing session - check if auth has changed
          const session = sessions.get(sessionId);
          session.lastAccessedAt = Date.now();
          const newUser = await getUserFromRequest(req);
          const currentUser = session.userRef.current;

          if (currentUser && !newUser) {
            telemetry.incrementCounter('session.auth_rejected', 1, { reason: 'missing_or_invalid_token' });
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication required for this MCP session' }));
            return;
          }

          if (currentUser && newUser && currentUser.id !== newUser.id) {
            telemetry.incrementCounter('session.auth_rejected', 1, { reason: 'user_mismatch' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'MCP session is bound to a different authenticated user' }));
            return;
          }

          // Update user if authentication changed (anonymous -> authenticated or different user)
          if (newUser && (!session.userRef.current || session.userRef.current.email !== newUser.email)) {
            const wasAnonymous = !session.userRef.current;
            session.userRef.current = newUser;
            console.error(`Session ${sessionId} authenticated: ${obfuscateEmail(newUser.email)}`);

            // Telemetry: mid-session authentication upgrade
            telemetry.incrementCounter('session.auth_upgrade', 1, { from: wasAnonymous ? 'anonymous' : 'different_user' });
            telemetry.addBreadcrumb('Session authenticated mid-stream', 'session', {
              sessionId,
              userId: newUser.id,
              wasAnonymous,
            });
          }

          telemetry.incrementCounter('session.requests', 1, { type: 'existing' });
          await session.transport.handleRequest(req, res);
        } else {
          // No session ID or invalid/expired session - create new session
          cleanupExpiredSessions();
          if (!canCreateSession(req)) {
            telemetry.incrementCounter('session.create_rejected', 1, { reason: 'rate_limit' });
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Too many MCP sessions created. Try again shortly.' }));
            return;
          }

          // Check for authentication (optional - null means anonymous)
          const user = await getUserFromRequest(req);
          if (!ensureSessionCapacity(!!user)) {
            telemetry.incrementCounter('session.create_rejected', 1, { reason: 'capacity' });
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Too many active MCP sessions. Try again later.' }));
            return;
          }
          const userRef = { current: user };

          const newSessionId = crypto.randomUUID();
          const server = createMCPServer(userRef);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
          });

          // Connect server to transport
          await server.connect(transport);

          // Store session with mutable user reference
          sessions.set(newSessionId, { server, transport, createdAt: Date.now(), lastAccessedAt: Date.now(), userRef });

          if (sessionId) {
            console.error(`Session expired, created new: ${newSessionId} (total: ${sessions.size})${user ? ` [${obfuscateEmail(user.email)}]` : ''}`);
            // Telemetry: session expired and recreated
            telemetry.incrementCounter('session.expired', 1);
            telemetry.addBreadcrumb('Session expired, created new', 'session', {
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
            telemetry.addBreadcrumb('New session created', 'session', {
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
    cleanupExpiredSessions();
    cleanupSessionCreationBuckets();
  }, SESSION_CLEANUP_INTERVAL_MS);

  // Clean up expired introspection cache entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    let evictedCount = 0;
    for (const [token, entry] of introspectionCache) {
      if (entry.expiry <= now) {
        introspectionCache.delete(token);
        evictedCount++;
      }
    }
    if (evictedCount > 0) {
      console.error(`[Auth] Introspection cache cleanup: ${evictedCount} evicted, ${introspectionCache.size} remaining`);
    }
  }, OAUTH_INTROSPECTION_CACHE_TTL_MS);

  httpServer.listen(PORT, () => {
    console.error(`Travel MCP Server (Streamable HTTP) running on port ${PORT}`);
    console.error(`Version: ${versionInfo.version} (${versionInfo.gitCommitShort})`);
    console.error(`Multi-session support: enabled`);
    console.error(`MCP endpoint: /mcp`);
    console.error(`Health check: /health`);
    console.error(`REST API: /api/v1/*`);
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
