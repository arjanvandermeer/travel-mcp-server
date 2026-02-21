/**
 * Web auth flow endpoints
 * GET /auth/login    — redirect to OAuth provider
 * GET /auth/callback — handle OAuth callback, set session cookie
 * GET /auth/logout   — clear session cookie
 * GET /auth/me       — return current user info
 */

import crypto from 'crypto';
import { sendJson } from '../api-router.js';
import * as telemetry from '../telemetry.js';

// In-memory store for pending PKCE challenges (short-lived)
const pendingAuth = new Map();

// Clean up old pending auth entries every 5 minutes
setInterval(() => {
  const maxAge = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();
  for (const [state, entry] of pendingAuth) {
    if (now - entry.createdAt > maxAge) {
      pendingAuth.delete(state);
    }
  }
}, 5 * 60 * 1000);

/**
 * Generate PKCE code_verifier and code_challenge (S256)
 */
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function registerAuthRoutes(router) {
  router.get('/auth/login', async (req, res, { db }) => {
    try {
      const oauthIssuer = await db.getConfigCached('oauth_issuer') || process.env.OAUTH_ISSUER;
      if (!oauthIssuer) {
        sendJson(res, 500, { error: 'OAuth not configured' });
        return;
      }

      // Get or register client_id
      let clientId = await db.getConfigCached('web_oauth_client_id');
      if (!clientId) {
        // Dynamic client registration
        const serverBaseUrl = await db.getServerBaseUrl() || `http://localhost:${process.env.PORT || 3000}`;
        const regResponse = await fetch(`${oauthIssuer}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Travel Explorer Web',
            redirect_uris: [`${serverBaseUrl}/auth/callback`],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none', // Public client with PKCE
          }),
        });

        if (!regResponse.ok) {
          const errorText = await regResponse.text();
          console.error(`[Auth] Client registration failed: ${regResponse.status} ${errorText}`);
          sendJson(res, 500, { error: 'OAuth client registration failed' });
          return;
        }

        const regData = await regResponse.json();
        clientId = regData.client_id;
        await db.setConfig('web_oauth_client_id', clientId);
        console.error(`[Auth] Registered new OAuth client: ${clientId}`);
      }

      // Generate PKCE challenge
      const { verifier, challenge } = generatePKCE();
      const state = crypto.randomBytes(16).toString('hex');

      // Store PKCE verifier for the callback
      pendingAuth.set(state, { verifier, createdAt: Date.now() });

      const serverBaseUrl = await db.getServerBaseUrl() || `http://localhost:${process.env.PORT || 3000}`;
      const redirectUri = `${serverBaseUrl}/auth/callback`;

      const authorizeUrl = new URL(`${oauthIssuer}/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('scope', 'openid profile email');

      res.writeHead(302, { Location: authorizeUrl.toString() });
      res.end();
    } catch (err) {
      console.error('[Auth] Login error:', err.message);
      telemetry.captureException(err, { context: 'auth_login' });
      sendJson(res, 500, { error: 'Login failed' });
    }
  });

  router.get('/auth/callback', async (req, res, { db, query }) => {
    try {
      const { code, state } = query;
      if (!code || !state) {
        sendJson(res, 400, { error: 'Missing code or state' });
        return;
      }

      // Verify state and get PKCE verifier
      const pending = pendingAuth.get(state);
      if (!pending) {
        sendJson(res, 400, { error: 'Invalid or expired state' });
        return;
      }
      pendingAuth.delete(state);

      const oauthIssuer = await db.getConfigCached('oauth_issuer') || process.env.OAUTH_ISSUER;
      const clientId = await db.getConfigCached('web_oauth_client_id');
      const serverBaseUrl = await db.getServerBaseUrl() || `http://localhost:${process.env.PORT || 3000}`;
      const redirectUri = `${serverBaseUrl}/auth/callback`;

      // Exchange code for token
      const tokenResponse = await fetch(`${oauthIssuer}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: pending.verifier,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`[Auth] Token exchange failed: ${tokenResponse.status} ${errorText}`);
        sendJson(res, 500, { error: 'Token exchange failed' });
        return;
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // Set session cookie
      const isSecure = serverBaseUrl.startsWith('https');
      const cookieFlags = [
        `session=${accessToken}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${7 * 24 * 60 * 60}`, // 7 days
      ];
      if (isSecure) cookieFlags.push('Secure');

      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': cookieFlags.join('; '),
      });
      res.end();
    } catch (err) {
      console.error('[Auth] Callback error:', err.message);
      telemetry.captureException(err, { context: 'auth_callback' });
      sendJson(res, 500, { error: 'Authentication failed' });
    }
  });

  router.get('/auth/logout', async (req, res) => {
    // Clear the session cookie
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    });
    res.end();
  });

  router.get('/auth/me', async (req, res, { user }) => {
    if (user) {
      sendJson(res, 200, {
        authenticated: true,
        email: user.email,
        name: user.name,
        picture_url: user.picture_url,
      });
    } else {
      sendJson(res, 200, { authenticated: false });
    }
  });
}
