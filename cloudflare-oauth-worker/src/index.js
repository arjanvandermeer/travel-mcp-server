/**
 * Cloudflare Worker OAuth Provider for Travel MCP Server
 *
 * Implements OAuth 2.1 with PKCE for MCP clients (ChatGPT, Claude, MCP Inspector).
 * Uses Google OAuth for user identity, issues tokens for the MCP server.
 */

// Google OAuth configuration
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Handle Google OAuth callback
 */
async function handleGoogleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const authSessionId = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code || !authSessionId) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Retrieve auth session
  const sessionData = await env.OAUTH_KV.get(`auth_session:${authSessionId}`);
  if (!sessionData) {
    return new Response('Session expired or invalid', { status: 400 });
  }

  const session = JSON.parse(sessionData);
  await env.OAUTH_KV.delete(`auth_session:${authSessionId}`);

  // Exchange code for Google tokens
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.OAUTH_ISSUER}/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    console.error('Google token exchange failed:', error);
    return new Response('Failed to exchange code', { status: 500 });
  }

  const googleTokens = await tokenResponse.json();

  // Get user info from Google
  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${googleTokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    return new Response('Failed to get user info', { status: 500 });
  }

  const userInfo = await userInfoResponse.json();

  // Generate authorization code for MCP client
  const authCode = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await env.OAUTH_KV.put(`auth_code:${authCode}`, JSON.stringify({
    ...session,
    user: {
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
    },
    createdAt: now,
  }), { expirationTtl: 300 }); // 5 minute expiry

  // Redirect back to MCP client with authorization code
  const redirectUrl = new URL(session.redirectUri);
  redirectUrl.searchParams.set('code', authCode);
  redirectUrl.searchParams.set('state', session.state);

  return Response.redirect(redirectUrl.toString(), 302);
}

/**
 * Handle token exchange (authorization_code -> access_token)
 */
async function handleTokenExchange(request, env) {
  const formData = await request.formData();
  const grantType = formData.get('grant_type');
  const code = formData.get('code');
  const codeVerifier = formData.get('code_verifier');
  const redirectUri = formData.get('redirect_uri');

  if (grantType !== 'authorization_code') {
    // Handle refresh token grant
    if (grantType === 'refresh_token') {
      return handleRefreshToken(formData, env);
    }
    return jsonResponse({ error: 'unsupported_grant_type' }, 400);
  }

  if (!code) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Missing code' }, 400);
  }

  // Retrieve authorization code data
  const codeData = await env.OAUTH_KV.get(`auth_code:${code}`);
  if (!codeData) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Code expired or invalid' }, 400);
  }

  const authData = JSON.parse(codeData);
  await env.OAUTH_KV.delete(`auth_code:${code}`);

  // Verify PKCE code_verifier
  if (authData.codeChallenge && authData.codeChallengeMethod === 'S256') {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    const computedChallenge = base64UrlEncode(hashArray);

    if (computedChallenge !== authData.codeChallenge) {
      return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
  }

  // Verify redirect_uri matches
  if (redirectUri && redirectUri !== authData.redirectUri) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' }, 400);
  }

  // Generate tokens
  const now = Math.floor(Date.now() / 1000);
  const accessToken = generateToken();
  const refreshToken = generateToken();

  const tokenPayload = {
    sub: authData.user.sub,
    email: authData.user.email,
    name: authData.user.name,
    picture: authData.user.picture,
    iat: now,
    exp: now + 3600 * 24 * 7, // 7 days
  };

  // Store tokens
  await env.OAUTH_KV.put(`token:${accessToken}`, JSON.stringify(tokenPayload), {
    expirationTtl: 3600 * 24 * 7,
  });

  await env.OAUTH_KV.put(`refresh:${refreshToken}`, JSON.stringify({
    user: authData.user,
    clientId: authData.clientId,
    scope: authData.scope,
  }), {
    expirationTtl: 3600 * 24 * 30, // 30 days
  });

  return jsonResponse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600 * 24 * 7,
    refresh_token: refreshToken,
    scope: authData.scope,
  });
}

/**
 * Handle refresh token grant
 */
async function handleRefreshToken(formData, env) {
  const refreshToken = formData.get('refresh_token');

  if (!refreshToken) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400);
  }

  const refreshData = await env.OAUTH_KV.get(`refresh:${refreshToken}`);
  if (!refreshData) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400);
  }

  const data = JSON.parse(refreshData);

  // Generate new access token
  const now = Math.floor(Date.now() / 1000);
  const newAccessToken = generateToken();

  const tokenPayload = {
    sub: data.user.sub,
    email: data.user.email,
    name: data.user.name,
    picture: data.user.picture,
    iat: now,
    exp: now + 3600 * 24 * 7,
  };

  await env.OAUTH_KV.put(`token:${newAccessToken}`, JSON.stringify(tokenPayload), {
    expirationTtl: 3600 * 24 * 7,
  });

  // Optionally rotate refresh token
  const newRefreshToken = generateToken();
  await env.OAUTH_KV.put(`refresh:${newRefreshToken}`, refreshData, {
    expirationTtl: 3600 * 24 * 30,
  });
  await env.OAUTH_KV.delete(`refresh:${refreshToken}`);

  return jsonResponse({
    access_token: newAccessToken,
    token_type: 'Bearer',
    expires_in: 3600 * 24 * 7,
    refresh_token: newRefreshToken,
    scope: data.scope,
  });
}

/**
 * Handle token introspection (for MCP server to validate tokens)
 */
async function handleIntrospection(request, env) {
  const formData = await request.formData();
  const token = formData.get('token');

  if (!token) {
    return jsonResponse({ active: false });
  }

  const tokenData = await env.OAUTH_KV.get(`token:${token}`);
  if (!tokenData) {
    return jsonResponse({ active: false });
  }

  const payload = JSON.parse(tokenData);
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp < now) {
    await env.OAUTH_KV.delete(`token:${token}`);
    return jsonResponse({ active: false });
  }

  return jsonResponse({
    active: true,
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    exp: payload.exp,
    iat: payload.iat,
    token_type: 'Bearer',
  });
}

/**
 * Handle Dynamic Client Registration (DCR)
 */
async function handleClientRegistration(request, env) {
  const body = await request.json();

  // Generate client credentials
  const clientId = crypto.randomUUID();
  const clientSecret = generateToken();

  const clientData = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: body.redirect_uris || [],
    client_name: body.client_name || 'MCP Client',
    token_endpoint_auth_method: body.token_endpoint_auth_method || 'client_secret_post',
    created_at: Date.now(),
  };

  // Store client registration
  await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(clientData), {
    expirationTtl: 3600 * 24 * 365, // 1 year
  });

  return jsonResponse({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0, // Never expires
    redirect_uris: clientData.redirect_uris,
    client_name: clientData.client_name,
    token_endpoint_auth_method: clientData.token_endpoint_auth_method,
  }, 201);
}

/**
 * OAuth Authorization Server Metadata (RFC 8414)
 */
function getAuthorizationServerMetadata(env) {
  const issuer = env.OAUTH_ISSUER;
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    introspection_endpoint: `${issuer}/introspect`,
    revocation_endpoint: `${issuer}/revoke`,
    scopes_supported: ['openid', 'profile', 'email'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: 'https://github.com/arjanvandermeer/travel-mcp-server',
  };
}

/**
 * Protected Resource Metadata (RFC 9728)
 */
function getProtectedResourceMetadata(env) {
  return {
    resource: env.MCP_SERVER_URL,
    authorization_servers: [env.OAUTH_ISSUER],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
  };
}

// Utility functions
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes) {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
    },
  });
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
        },
      });
    }

    try {
      // Well-known endpoints
      if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/openid-configuration') {
        return jsonResponse(getAuthorizationServerMetadata(env));
      }

      if (path === '/.well-known/oauth-protected-resource') {
        return jsonResponse(getProtectedResourceMetadata(env));
      }

      // OAuth endpoints
      if (path === '/authorize' && request.method === 'GET') {
        const clientId = url.searchParams.get('client_id') || '';
        const redirectUri = url.searchParams.get('redirect_uri') || '';
        const scope = url.searchParams.get('scope') || 'openid profile email';
        const state = url.searchParams.get('state') || '';
        const codeChallenge = url.searchParams.get('code_challenge') || '';
        const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';

        // Store auth session and redirect to Google
        const authSessionId = crypto.randomUUID();
        await env.OAUTH_KV.put(`auth_session:${authSessionId}`, JSON.stringify({
          clientId,
          redirectUri,
          scope,
          state,
          codeChallenge,
          codeChallengeMethod,
          createdAt: Date.now(),
        }), { expirationTtl: 600 });

        const googleAuthUrl = new URL(GOOGLE_AUTH_URL);
        googleAuthUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
        googleAuthUrl.searchParams.set('redirect_uri', `${env.OAUTH_ISSUER}/callback`);
        googleAuthUrl.searchParams.set('response_type', 'code');
        googleAuthUrl.searchParams.set('scope', 'openid email profile');
        googleAuthUrl.searchParams.set('state', authSessionId);
        googleAuthUrl.searchParams.set('access_type', 'offline');
        googleAuthUrl.searchParams.set('prompt', 'consent');

        return Response.redirect(googleAuthUrl.toString(), 302);
      }

      if (path === '/callback' && request.method === 'GET') {
        return handleGoogleCallback(request, env);
      }

      if (path === '/token' && request.method === 'POST') {
        return handleTokenExchange(request, env);
      }

      if (path === '/introspect' && request.method === 'POST') {
        return handleIntrospection(request, env);
      }

      if (path === '/register' && request.method === 'POST') {
        return handleClientRegistration(request, env);
      }

      if (path === '/revoke' && request.method === 'POST') {
        const formData = await request.formData();
        const token = formData.get('token');
        if (token) {
          await env.OAUTH_KV.delete(`token:${token}`);
          await env.OAUTH_KV.delete(`refresh:${token}`);
        }
        return new Response(null, { status: 200 });
      }

      // Health check
      if (path === '/health') {
        return jsonResponse({ status: 'ok', service: 'travel-mcp-oauth' });
      }

      // Home page with info
      if (path === '/') {
        return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>Travel MCP OAuth Server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Travel MCP OAuth Server</h1>
  <p>This is the OAuth 2.1 authorization server for the Travel MCP Server.</p>

  <h2>Endpoints</h2>
  <ul>
    <li><a href="/.well-known/oauth-authorization-server">Authorization Server Metadata</a></li>
    <li><code>GET /authorize</code> - Start OAuth flow</li>
    <li><code>POST /token</code> - Exchange code for token</li>
    <li><code>POST /register</code> - Dynamic Client Registration</li>
    <li><code>POST /introspect</code> - Token introspection</li>
    <li><code>POST /revoke</code> - Revoke token</li>
  </ul>

  <h2>For MCP Clients</h2>
  <p>Configure your MCP client with:</p>
  <pre>
Authorization Server: ${env.OAUTH_ISSUER}
Resource Server: ${env.MCP_SERVER_URL}
  </pre>

  <h2>Documentation</h2>
  <p>See the <a href="https://github.com/arjanvandermeer/travel-mcp-server">GitHub repository</a> for full documentation.</p>
</body>
</html>
        `, {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      console.error('OAuth error:', error);
      return jsonResponse({ error: 'server_error', error_description: 'Internal server error' }, 500);
    }
  },
};
