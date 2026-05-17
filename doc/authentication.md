# Authentication

This document describes the authentication system for the travel-mcp-server.

## Why Authenticate?

Authentication is **completely optional**. The server works fully without authentication, and anonymous users have access to all tools and features.

However, authentication enables:

1. **API Limit Bypass** - Authenticated users can be granted unlimited Google Places API access (instead of the default daily limit)
2. **User Identification** - Track which user made requests (useful for debugging and analytics in Sentry)
3. **User Features** - Store favorites, preferences, and personalized recommendations

**Key Design Principle**: Authentication is transparent. If you don't provide a token, or provide an invalid token, the server simply treats you as anonymous. No errors, no access denied - just default rate limits.

## Authentication Options

The server supports two authentication methods:

| Method | Use Case | Setup Complexity |
|--------|----------|------------------|
| **Phase 1: Token Auth** | Admin-provisioned tokens for specific users | Simple (SQL only) |
| **Phase 2: OAuth 2.1** | Self-service login via Google for ChatGPT, Claude, etc. | Moderate (requires Cloudflare Worker) |

---

## Phase 1: Simple Token Auth

Phase 1 uses Bearer token authentication with manually provisioned tokens.

### How It Works

1. An admin creates a user and generates a token manually (via SQL)
2. The user includes the token in the `Authorization` header
3. The server validates the token and loads user config (e.g., unlimited API access)
4. If the token is invalid/missing, the request proceeds as anonymous

### Database Schema

```sql
-- User accounts
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE,      -- For OAuth
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    picture_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API tokens
CREATE TABLE user_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token VARCHAR(64) UNIQUE NOT NULL,  -- 32-byte hex string
    name VARCHAR(100),                  -- e.g., "Claude Desktop"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,               -- NULL = never expires
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP                -- Set to revoke
);

-- Per-user configuration
CREATE TABLE user_config (
    user_id INTEGER NOT NULL REFERENCES users(id),
    key VARCHAR(100) NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
);
```

### Creating a User and Token

```bash
# Generate a secure token
TOKEN=$(openssl rand -hex 32)
echo "Token: $TOKEN"

# Connect to database and create user
psql $DATABASE_URL
```

```sql
-- Create user
INSERT INTO users (email, name)
VALUES ('user@example.com', 'User Name')
RETURNING id;

-- Create token (use the id from above)
INSERT INTO user_tokens (user_id, token, name)
VALUES (1, '<token>', 'Claude Desktop');

-- Grant unlimited Google Places access
INSERT INTO user_config (user_id, key, value)
VALUES (1, 'google_places_limit', 'unlimited');
```

### Using the Token

**MCP Inspector (CLI)**:
```bash
npx @modelcontextprotocol/inspector \
  --transport streamable-http \
  --url https://<mcp-server-url>/mcp \
  --header "Authorization: Bearer <token>"
```

**curl**:
```bash
curl -X POST https://<mcp-server-url>/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{...},"id":1}'
```

**Any HTTP client**: Include the header `Authorization: Bearer <token>`

### What Happens With Invalid Tokens?

| Scenario | Result |
|----------|--------|
| No Authorization header | Anonymous session (default limits) |
| Invalid token format | Anonymous session |
| Token not in database | Anonymous session |
| Token expired | Anonymous session |
| Token revoked | Anonymous session |
| Database error | Anonymous session (logged) |
| Valid token | Authenticated session |

The server never returns 401/403 errors for auth issues - it gracefully falls back to anonymous access.

### Checking Authentication Status

Use the `whoami` tool to verify your authentication status:

**Anonymous response:**
```json
{ "authenticated": false }
```

**Authenticated response:**
```json
{
  "authenticated": true,
  "id": 1,
  "email": "user@example.com",
  "name": "User Name",
  "picture_url": null,
  "config": { "google_places_limit": "unlimited" },
  "created_at": "2025-02-01T00:00:00.000Z",
  "last_login_at": "2025-02-01T00:00:00.000Z"
}
```

### Server Logs

When a user authenticates successfully, the server logs:
```
Authenticated user: user@example.com
New session created: <uuid> (total: 1) [user@example.com]
```

Anonymous sessions show:
```
New session created: <uuid> (total: 1)
```

### Sentry Integration

For authenticated users, Sentry receives these tags:
- `user.email` - User's email address
- `user.id` - User's numeric ID

**Note**: Tokens are never sent to Sentry.

---

## Phase 2: OAuth 2.1 via Cloudflare Worker

Phase 2 implements OAuth 2.1 with PKCE using a Cloudflare Worker as the authorization server. This enables:

1. **Self-service authentication** - Users log in via Google without admin intervention
2. **ChatGPT integration** - ChatGPT's MCP connector auto-discovers and uses OAuth
3. **MCP Inspector OAuth** - Inspector's `--oauth` flag works automatically
4. **Dynamic Client Registration** - Clients register themselves (RFC 7591)

### Architecture

```
┌─────────────────────┐     ┌─────────────────────────────────────┐
│    MCP Client       │     │  Cloudflare Worker (OAuth Server)   │
│  (ChatGPT/Claude)   │     │  <oauth-worker-url>            │
└─────────┬───────────┘     └─────────────────┬───────────────────┘
          │                                   │
          │ 1. Discover auth server           │
          ├──────────────────────────────────►│
          │    /.well-known/oauth-protected-  │
          │         resource                  │
          │                                   │
          │ 2. Get auth server metadata       │
          ├──────────────────────────────────►│
          │    /.well-known/oauth-            │
          │         authorization-server      │
          │                                   │
          │ 3. Register client (DCR)          │
          ├──────────────────────────────────►│
          │    POST /register                 │
          │                                   │
          │ 4. Start OAuth flow               │
          ├──────────────────────────────────►│
          │    GET /authorize                 │
          │         ↓                         │
          │    Google OAuth login             │
          │         ↓                         │
          │    GET /callback                  │
          │                                   │
          │ 5. Exchange code for token        │
          ├──────────────────────────────────►│
          │    POST /token                    │
          │                                   │
          │◄──────────────────────────────────┤
          │    access_token, refresh_token    │
          │                                   │
          │ 6. MCP requests with token        │
          ├──────────────────────────────────►│
          ▼                                   │
┌─────────────────────┐                       │
│   MCP Server        │   7. Validate token   │
│ <mcp-server>   │◄──────────────────────┤
│                     │   POST /introspect    │
└─────────────────────┘                       │
```

### Runtime State And Scaling Assumptions

**Decision as of 2026-05-17:** the HTTP MCP server is designed and deployed as a single Node.js process. Do not run multiple active HTTP instances behind a load balancer unless sticky routing or an external session design is added first.

The following auth/session state is intentionally process-local:

| Store | File | Purpose | Failure behavior |
|-------|------|---------|------------------|
| `pendingAuth` | `src/api/auth.js` | Short-lived PKCE verifier/state for `/auth/login` -> `/auth/callback` web login | Restart or routing to another process invalidates the login state; the user must retry login |
| `sessions` | `src/index-http.js` | Streamable HTTP MCP session ID -> transport/server/user reference | Restart or routing to another process drops the MCP session; the client must create or reinitialize a session |
| `introspectionCache` | `src/index-http.js` | Token -> user cache for OAuth/database token validation | Cache miss is safe and revalidates against the database or OAuth introspection endpoint |

Operational requirements:

1. Run one HTTP MCP process per public `server_base_url`.
2. If a reverse proxy is present, route all requests for a given deployment to that process.
3. If multiple processes are introduced, use sticky sessions for `/mcp` keyed by `mcp-session-id`, and route `/auth/callback` to the same process that handled `/auth/login`.
4. Treat the OAuth introspection cache as an optimization only; the database and OAuth worker remain the sources of truth.

Before horizontal scaling, redesign these boundaries explicitly:

1. Move PKCE pending auth state to a shared store with TTL and one-time consume semantics.
2. Either keep MCP Streamable HTTP sessions sticky, or replace the in-process `sessions` map with a transport/session strategy that supports cross-process routing.
3. Keep introspection caches per-process or move them to a shared cache only if revocation latency, TTL, and invalidation behavior are documented.
4. Add integration coverage that exercises login callback routing, MCP session reuse, auth upgrade on an existing session, and token cache expiry across the chosen state boundary.

### Prerequisites

1. **Cloudflare Account** with Workers enabled (free tier works)
2. **Google Cloud Console** project with OAuth 2.0 credentials

### Step 1: Set Up Google OAuth

#### 1.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the **Google+ API** (for user info)

#### 1.2 Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Travel MCP OAuth`
5. Authorized redirect URIs:
   - Development: `http://localhost:8787/callback`
   - Production: `https://<oauth-worker-url>/callback`
6. Save the **Client ID** and **Client Secret**

#### 1.3 Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. User Type: **External** (or Internal for Google Workspace)
3. App name: `Travel MCP Server`
4. Support email: Your email
5. Scopes: Add `email`, `profile`, `openid`
6. Test users: Add your email (for testing before verification)

### Step 2: Deploy Cloudflare Worker

Choose one deployment method:

#### Option A: Deploy via Cloudflare Dashboard

No local installation required - deploy entirely through the Cloudflare web UI.

**A.1 Create KV Namespace**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages → KV**
3. Click **Create a namespace**
4. Name: `OAUTH_KV`
5. Click **Add**

**A.2 Create the Worker**

1. Go to **Workers & Pages → Create**
2. Click **Create Worker**
3. Name: `travel-mcp-oauth`
4. Click **Deploy** (creates placeholder)
5. Click **Edit Code**

**A.3 Paste the Code**

Replace the default code with the contents of [`cloudflare-oauth-worker/src/index.js`](../cloudflare-oauth-worker/src/index.js).

**A.4 Configure Bindings & Variables**

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
| `MCP_SERVER_URL` | `https://<mcp-server-url>` | No |
| `OAUTH_ISSUER` | `https://<oauth-worker-url>` | No |

**A.5 Set Compatibility Settings**

Go to **Settings → Compatibility**:
- Compatibility date: `2024-12-01`
- Compatibility flags: Add `nodejs_compat`

**A.6 Deploy**

Click **Save and Deploy**

#### Option B: Deploy via Wrangler CLI

Use this option for CI/CD automation or local development.

**B.1 Install and Authenticate**

```bash
cd cloudflare-oauth-worker
npm install
wrangler login
```

**B.2 Create KV Namespace**

```bash
wrangler kv:namespace create "OAUTH_KV"
```

Copy the output ID and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "abc123..."  # Your actual ID
```

**B.3 Set Secrets**

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
# e.g., https://<mcp-server-url>
```

**B.4 Update Configuration**

Edit `wrangler.toml`:

```toml
[vars]
OAUTH_ISSUER = "https://<oauth-worker-url>"
```

**B.5 Deploy**

```bash
wrangler deploy
```

### Step 3: Verify Deployment

```bash
# Authorization server metadata
curl https://<oauth-worker-url>/.well-known/oauth-authorization-server

# Health check
curl https://<oauth-worker-url>/health
```

Expected metadata response:
```json
{
  "issuer": "https://<oauth-worker-url>",
  "authorization_endpoint": "https://<oauth-worker-url>/authorize",
  "token_endpoint": "https://<oauth-worker-url>/token",
  "registration_endpoint": "https://<oauth-worker-url>/register",
  "introspection_endpoint": "https://<oauth-worker-url>/introspect",
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  ...
}
```

### Step 4: Configure MCP Server

#### 4.1 Add OAuth Issuer to Database

The MCP server reads configuration from the `app_config` database table. Add the OAuth issuer URL:

```sql
-- For each environment (local dev and production)
INSERT INTO app_config (key, value)
VALUES ('oauth_issuer', 'https://<oauth-worker-url>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

The MCP server automatically constructs the introspection URL as `{oauth_issuer}/introspect`.

#### 4.2 Token Validation

The MCP server (`src/index-http.js`) automatically handles OAuth token validation:

```javascript
async function validateToken(token) {
  // First try database lookup (Phase 1 tokens)
  const dbUser = await db.validateToken(token);
  if (dbUser) return dbUser;

  // Try OAuth introspection (Phase 2 tokens)
  const oauthIssuer = await db.getConfigCached('oauth_issuer');
  const introspectionUrl = oauthIssuer ? `${oauthIssuer}/introspect` : null;

  if (introspectionUrl) {
    const response = await fetch(introspectionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });

    const data = await response.json();
    if (data.active) {
      // User is auto-provisioned/updated in database
      return {
        email: data.email,
        name: data.name,
        picture_url: data.picture,
        google_id: data.sub,
      };
    }
  }

  return null;
}
```

#### 4.3 Protected Resource Metadata

The MCP server exposes `/.well-known/oauth-protected-resource`:

```javascript
app.get('/.well-known/oauth-protected-resource', async (req, res) => {
  const serverBaseUrl = await db.getServerBaseUrl();
  const oauthIssuer = await db.getConfigCached('oauth_issuer');
  res.json({
    resource: serverBaseUrl,
    authorization_servers: [oauthIssuer],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
  });
});
```

### Step 5: Test OAuth Flow

**MCP Inspector with OAuth:**
```bash
npx @modelcontextprotocol/inspector \
  --transport streamable-http \
  --url https://<mcp-server-url>/mcp \
  --oauth
```

The Inspector will:
1. Fetch `/.well-known/oauth-protected-resource` from your MCP server
2. Discover the authorization server
3. Initiate OAuth flow
4. Open browser for Google login
5. Exchange tokens and connect

After connection, call `whoami`. A successful OAuth connector session returns
`authenticated: true` plus the user's saved preferences. To validate preference
write access, call `set_user_preferences` with a currency, language, or
home_location, then call `get_user_preferences` and confirm the normalized
values are returned.

**ChatGPT Configuration:**

In ChatGPT's MCP connector settings:
1. **MCP Server URL**: `https://<mcp-server-url>/mcp`
2. **Authentication**: OAuth
3. ChatGPT will automatically discover endpoints via well-known metadata

Use the same validation sequence in ChatGPT: connect with OAuth, run `whoami`,
save preferences with `set_user_preferences`, and read them back with
`get_user_preferences`. Anonymous connector sessions should still be able to use
public search tools, but preference and favorites tools should report that
authentication is required.

### OAuth Endpoints Reference

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

### Token Lifetimes

| Token Type | Lifetime | Notes |
|------------|----------|-------|
| Access Token | 7 days | Can be validated via /introspect |
| Refresh Token | 30 days | Rotated on each use |
| Authorization Code | 5 minutes | Single use |
| Auth Session | 10 minutes | Google OAuth state |

### OAuth Security Considerations

1. **PKCE Required**: All authorization requests must include `code_challenge` with S256 method
2. **State Parameter**: Prevents CSRF attacks
3. **Token Rotation**: Refresh tokens are rotated on each use
4. **Short-lived Codes**: Authorization codes expire in 5 minutes
5. **Cookie Encryption**: Session cookies are encrypted

### Troubleshooting

**"Invalid redirect_uri"**
Ensure the callback URL in Google Console matches exactly:
- `https://<oauth-worker-url>/callback`

**"Session expired"**
The auth session lasts 10 minutes. Restart the OAuth flow.

**"PKCE verification failed"**
Ensure your client sends the correct `code_verifier` that matches the original `code_challenge`.

**View Worker logs:**
```bash
wrangler tail
```

### Custom Domain (Optional)

To use a custom domain like `auth.<your-domain>.com`:

1. Go to Cloudflare Dashboard → Workers → Your Worker → Triggers
2. Add Custom Domain
3. Update `OAUTH_ISSUER` in wrangler.toml
4. Update Google OAuth redirect URI
5. Redeploy

### Local Development (Optional)

Only needed if you want to test changes locally before deploying.

**Setup:**
```bash
cd cloudflare-oauth-worker
npm install
```

**Configure Local Secrets** - Create `.dev.vars` file:
```
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
COOKIE_ENCRYPTION_KEY=<32-byte-hex-key>
MCP_SERVER_URL=http://localhost:3000
OAUTH_ISSUER=http://localhost:8787
```

**Add Local Callback to Google:**
In Google Cloud Console, add to authorized redirect URIs:
- `http://localhost:8787/callback`

**Run Locally:**
```bash
npm run dev
```
This starts the worker at `http://localhost:8787`.

---

## Phase 3: User Features

User-specific features that require authentication.

### Favorites

Save and manage your favorite POIs (hotels, restaurants, attractions).

#### `add_favorite`

Add a POI to your favorites list.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `osm_id` | number | Yes | The OSM ID of the POI to save |
| `notes` | string | No | Personal notes (e.g., "Great rooftop bar") |

**Example:**
```json
{
  "osm_id": 123456789,
  "notes": "Book the corner room with city view"
}
```

**Response:**
```json
{ "success": true }
```

#### `remove_favorite`

Remove a POI from your favorites.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `osm_id` | number | Yes | The OSM ID of the POI to remove |

**Response:**
```json
{
  "success": true,
  "message": "Favorite removed"
}
```

#### `list_favorites`

List your saved favorites with optional filters. Returns full POI details.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `city_name` | string | No | Filter by city name |
| `country_code` | string | No | 2-letter country code (required with city_name) |
| `state` | string | No | State/province filter |
| `latitude` | number | No | Center latitude for radius search |
| `longitude` | number | No | Center longitude for radius search |
| `radius_km` | number | No | Search radius in km (default: 50) |
| `poi_types` | string[] | No | Filter by types (e.g., `["restaurant", "cafe"]`) |
| `limit` | number | No | Max results (default: 100) |

**Example - All favorites:**
```json
{}
```

**Example - Restaurants in New York:**
```json
{
  "city_name": "New York",
  "country_code": "US",
  "poi_types": ["restaurant", "cafe", "bar"]
}
```

**Example - Hotels near coordinates:**
```json
{
  "latitude": 40.7580,
  "longitude": -73.9855,
  "radius_km": 5,
  "poi_types": ["hotel"]
}
```

**Response:**
```json
{
  "count": 2,
  "favorites": [
    {
      "is_favorite": true,
      "favorite_since": "2025-02-02T...",
      "favorite_notes": "Great rooftop bar",
      "osm_id": 123456789,
      "osm_name": "The Standard High Line",
      "poi_type": "hotel",
      "city": "New York",
      "google_rating": 4.3,
      "distance_meters": 1250,
      ...
    },
    ...
  ]
}
```

**Notes:**
- When using coordinates, results include `distance_meters` and are sorted by distance
- When not using coordinates, results are sorted by `favorite_since` (most recent first)
- Location filters (city vs coordinates) are mutually exclusive

#### Favorites in Search Results

When authenticated, search results include favorite status:

```json
{
  "osm_id": 123456789,
  "osm_name": "Hotel Example",
  "is_favorite": true,
  "favorite_since": "2025-02-02T...",
  "favorite_notes": "Great location",
  ...
}
```

#### Error Handling

All favorites tools require authentication. If called without a valid token:

```json
{
  "error": "Authentication required. Please provide a valid token."
}
```

### Future User Features

**Preferences** - Store user preferences in `user_config`:
- `preferred_currency` - Display prices in user's currency
- `preferred_language` - Translate results
- `home_location` - Default search location
- `dietary_restrictions` - Filter restaurants

**Trip Planning**:
```sql
CREATE TABLE user_trips (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR(255),
    destination_city_id INTEGER REFERENCES geonames_cities(geoname_id),
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trip_items (
    trip_id INTEGER NOT NULL REFERENCES user_trips(id),
    poi_osm_id BIGINT NOT NULL REFERENCES osm_pois(osm_id),
    day_number INTEGER,
    notes TEXT,
    PRIMARY KEY (trip_id, poi_osm_id)
);
```

New MCP tools:
- `create_trip` - Start planning a trip
- `add_to_trip` - Add hotel/restaurant/attraction to trip
- `get_trip_itinerary` - View trip plan
- `share_trip` - Generate shareable link

**Usage Analytics** - Track per-user statistics:
- API calls made
- Most searched cities
- Favorite cuisines
- Travel patterns

---

## Configuration Reference

### User Config Keys

| Key | Values | Description |
|-----|--------|-------------|
| `google_places_limit` | `unlimited`, number | API call limit (default: from app_config) |
| `role` | `admin`, `user` | User role (future use) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (OAuth Worker) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (OAuth Worker) |

---

## Security Considerations

1. **Tokens are secrets** - Never log tokens, send to analytics, or expose in responses
2. **Use HTTPS** - Always use HTTPS in production to protect tokens in transit
3. **Token rotation** - Consider implementing token refresh for long-lived sessions
4. **Revocation** - Set `revoked_at` to immediately invalidate a compromised token
5. **Expiration** - Set `expires_at` for tokens that should auto-expire
