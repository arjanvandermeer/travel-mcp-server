# Cloudflare Worker OAuth Setup

This guide covers deploying the OAuth 2.1 authorization server on Cloudflare Workers for the Travel MCP Server.

## Overview

The Cloudflare Worker implements OAuth 2.1 with PKCE, enabling MCP clients (ChatGPT, Claude, MCP Inspector) to authenticate users via Google OAuth.

```
┌─────────────────────┐     ┌─────────────────────────────────────┐
│    MCP Client       │     │  Cloudflare Worker (OAuth Server)   │
│  (ChatGPT/Claude)   │     │                                     │
└─────────┬───────────┘     │  /.well-known/oauth-authorization-  │
          │                 │       server                        │
          │ 1. Discover     │  /authorize → Google OAuth          │
          ├────────────────►│  /callback  ← Google callback       │
          │                 │  /token     → Issue tokens          │
          │ 2. Authorize    │  /register  → Dynamic registration  │
          ├────────────────►│  /introspect → Validate tokens      │
          │                 │                                     │
          │ 3. Token        │  KV Storage:                        │
          │◄────────────────┤  - tokens, refresh tokens           │
          │                 │  - client registrations             │
          │                 │  - auth sessions                    │
          │                 └─────────────────────────────────────┘
          │
          │ 4. MCP Request + Bearer Token
          ▼
┌─────────────────────┐
│   MCP Server        │
│ mcp.arjanvandermeer │
│      .com           │
│                     │
│ Validates token via │
│ /introspect or DB   │
└─────────────────────┘
```

## Prerequisites

1. **Cloudflare Account** with Workers enabled (free tier works)
2. **Google Cloud Console** project with OAuth 2.0 credentials

## Deployment Options

Choose one:
- **[Option A: Cloudflare Dashboard](#option-a-deploy-via-cloudflare-dashboard)** - No local install, use web UI
- **[Option B: Wrangler CLI](#option-b-deploy-via-wrangler-cli)** - For CI/CD and local development

---

## Step 1: Set Up Google OAuth

### 1.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the **Google+ API** (for user info)

### 1.2 Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Travel MCP OAuth`
5. Authorized redirect URIs:
   - Development: `http://localhost:8787/callback`
   - Production: `https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/callback`
6. Save the **Client ID** and **Client Secret**

### 1.3 Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. User Type: **External** (or Internal for Google Workspace)
3. App name: `Travel MCP Server`
4. Support email: Your email
5. Scopes: Add `email`, `profile`, `openid`
6. Test users: Add your email (for testing before verification)

## Option A: Deploy via Cloudflare Dashboard

No local installation required - deploy entirely through the Cloudflare web UI.

### A.1 Create KV Namespace

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages → KV**
3. Click **Create a namespace**
4. Name: `OAUTH_KV`
5. Click **Add**

### A.2 Create the Worker

1. Go to **Workers & Pages → Create**
2. Click **Create Worker**
3. Name: `travel-mcp-oauth`
4. Click **Deploy** (creates placeholder)
5. Click **Edit Code**

### A.3 Paste the Code

Replace the default code with the contents of [`cloudflare-oauth-worker/src/index.js`](../cloudflare-oauth-worker/src/index.js) (JavaScript version for Dashboard).

### A.4 Configure Bindings & Variables

Go to your Worker → **Settings → Variables**:

**KV Namespace Bindings:**

| Variable name | KV Namespace |
|---------------|--------------|
| `OAUTH_KV` | Select your `OAUTH_KV` namespace |

**Environment Variables** (click "Encrypt" for secrets):

| Name | Value | Encrypt? |
|------|-------|----------|
| `GOOGLE_CLIENT_ID` | Your Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth client secret | Yes |
| `COOKIE_ENCRYPTION_KEY` | Run `openssl rand -hex 32` to generate | Yes |
| `MCP_SERVER_URL` | `https://mcp.arjanvandermeer.com` | No |
| `OAUTH_ISSUER` | `https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev` | No |

### A.5 Set Compatibility Settings

Go to **Settings → Compatibility**:
- Compatibility date: `2024-12-01`
- Compatibility flags: Add `nodejs_compat`

### A.6 Deploy

Click **Save and Deploy**

Continue to [Step 3: Verify Deployment](#step-3-verify-deployment).

---

## Option B: Deploy via Wrangler CLI

Use this option for CI/CD automation or local development.

### B.1 Install and Authenticate

```bash
cd cloudflare-oauth-worker
npm install
wrangler login
```

### B.2 Create KV Namespace

```bash
wrangler kv:namespace create "OAUTH_KV"
```

Copy the output ID and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "abc123..."  # Your actual ID
```

### B.3 Set Secrets

```bash
# Google OAuth credentials
wrangler secret put GOOGLE_CLIENT_ID
# Paste your Google Client ID

wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Google Client Secret

# Cookie encryption key (generate with: openssl rand -hex 32)
wrangler secret put COOKIE_ENCRYPTION_KEY
# Paste a 64-character hex string

# Your MCP server URL
wrangler secret put MCP_SERVER_URL
# e.g., https://mcp.arjanvandermeer.com
```

### B.4 Update Configuration

Edit `wrangler.toml`:

```toml
[vars]
OAUTH_ISSUER = "https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev"
```

### B.5 Deploy

```bash
wrangler deploy
```

---

## Step 3: Verify Deployment

### 3.1 Check Endpoints

```bash
# Authorization server metadata
curl https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/.well-known/oauth-authorization-server

# Health check
curl https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/health
```

Expected metadata response:
```json
{
  "issuer": "https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev",
  "authorization_endpoint": "https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/authorize",
  "token_endpoint": "https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/token",
  "registration_endpoint": "https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/register",
  "introspection_endpoint": "https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/introspect",
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  ...
}
```

## Step 4: Configure MCP Server

### 4.1 Update MCP Server Token Validation

The MCP server needs to validate tokens by calling the Worker's `/introspect` endpoint.

Add to your MCP server's environment:

```bash
OAUTH_INTROSPECTION_URL=https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/introspect
```

### 4.2 Token Validation Code

In `src/index-http.js`, update the auth middleware to support OAuth tokens:

```javascript
async function validateToken(token) {
  // First try database lookup (Phase 1 tokens)
  const dbUser = await db.validateToken(token);
  if (dbUser) return dbUser;

  // Try OAuth introspection (Phase 2 tokens)
  if (process.env.OAUTH_INTROSPECTION_URL) {
    const response = await fetch(process.env.OAUTH_INTROSPECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });

    const data = await response.json();
    if (data.active) {
      // Optionally sync user to database
      return {
        id: null,  // OAuth user, no DB ID yet
        email: data.email,
        name: data.name,
        picture_url: data.picture,
        google_id: data.sub,
        config: {},  // Default config for OAuth users
      };
    }
  }

  return null;
}
```

### 4.3 Protected Resource Metadata

Add `/.well-known/oauth-protected-resource` to your MCP server:

```javascript
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    resource: process.env.SERVER_BASE_URL || 'https://mcp.arjanvandermeer.com',
    authorization_servers: [process.env.OAUTH_ISSUER],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
  });
});
```

## Step 5: Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector \
  --transport streamable-http \
  --url https://mcp.arjanvandermeer.com/mcp \
  --oauth
```

The Inspector will:
1. Fetch `/.well-known/oauth-protected-resource` from your MCP server
2. Discover the authorization server
3. Initiate OAuth flow
4. Open browser for Google login
5. Exchange tokens and connect

## Step 6: Configure ChatGPT

In ChatGPT's MCP connector settings:

1. **MCP Server URL**: `https://mcp.arjanvandermeer.com/mcp`
2. **Authentication**: OAuth
3. ChatGPT will automatically discover endpoints via well-known metadata

## Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/oauth-authorization-server` | GET | OAuth server metadata (RFC 8414) |
| `/authorize` | GET | Start OAuth flow, redirects to Google |
| `/callback` | GET | Google OAuth callback handler |
| `/token` | POST | Exchange code for tokens |
| `/register` | POST | Dynamic Client Registration (RFC 7591) |
| `/introspect` | POST | Token introspection (RFC 7662) |
| `/revoke` | POST | Token revocation |
| `/health` | GET | Health check |

## Token Lifetimes

| Token Type | Lifetime | Notes |
|------------|----------|-------|
| Access Token | 7 days | Can be validated via /introspect |
| Refresh Token | 30 days | Rotated on each use |
| Authorization Code | 5 minutes | Single use |
| Auth Session | 10 minutes | Google OAuth state |

## Security Considerations

1. **PKCE Required**: All authorization requests must include `code_challenge` with S256 method
2. **State Parameter**: Prevents CSRF attacks
3. **Token Rotation**: Refresh tokens are rotated on each use
4. **Short-lived Codes**: Authorization codes expire in 5 minutes
5. **Cookie Encryption**: Session cookies are encrypted

## Troubleshooting

### "Invalid redirect_uri"
Ensure the callback URL in Google Console matches exactly:
- `https://travel-mcp-oauth.YOUR_SUBDOMAIN.workers.dev/callback`

### "Session expired"
The auth session lasts 10 minutes. Restart the OAuth flow.

### "PKCE verification failed"
Ensure your client sends the correct `code_verifier` that matches the original `code_challenge`.

### Logs
View Worker logs:
```bash
wrangler tail
```

## Custom Domain (Optional)

To use a custom domain like `auth.arjanvandermeer.com`:

1. Go to Cloudflare Dashboard → Workers → Your Worker → Triggers
2. Add Custom Domain
3. Update `OAUTH_ISSUER` in wrangler.toml
4. Update Google OAuth redirect URI
5. Redeploy

## Local Development (Optional)

Only needed if you want to test changes locally before deploying.

### Setup

```bash
cd cloudflare-oauth-worker
npm install
```

### Configure Local Secrets

Create `.dev.vars` file:

```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
COOKIE_ENCRYPTION_KEY=your-32-byte-hex-key
MCP_SERVER_URL=http://localhost:3000
OAUTH_ISSUER=http://localhost:8787
```

### Add Local Callback to Google

In Google Cloud Console, add to authorized redirect URIs:
- `http://localhost:8787/callback`

### Run Locally

```bash
npm run dev
```

This starts the worker at `http://localhost:8787`.

### Test OAuth Flow

```bash
# In another terminal, start local MCP server
npm run dev

# Open in browser
open "http://localhost:8787/authorize?client_id=test&redirect_uri=http://localhost:3000/callback&response_type=code&scope=openid%20profile%20email&state=test123&code_challenge=test&code_challenge_method=S256"
```

### View Logs

```bash
# Local logs appear in terminal
# Production logs:
wrangler tail
```
