# Authentication

This document describes the authentication system for the travel-mcp-server.

## Why Authenticate?

Authentication is **completely optional**. The server works fully without authentication, and anonymous users have access to all tools and features.

However, authentication enables:

1. **API Limit Bypass** - Authenticated users can be granted unlimited Google Places API access (instead of the default daily limit)
2. **User Identification** - Track which user made requests (useful for debugging and analytics in Sentry)
3. **Future Features** - Store favorites, preferences, and personalized recommendations

**Key Design Principle**: Authentication is transparent. If you don't provide a token, or provide an invalid token, the server simply treats you as anonymous. No errors, no access denied - just default rate limits.

## Phase 1: Simple Token Auth (Current)

Phase 1 is implemented and deployed. It uses Bearer token authentication.

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
    google_id VARCHAR(255) UNIQUE,      -- For future OAuth
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
VALUES (1, 'your-64-char-hex-token', 'Claude Desktop');

-- Grant unlimited Google Places access
INSERT INTO user_config (user_id, key, value)
VALUES (1, 'google_places_limit', 'unlimited');
```

### Using the Token

**MCP Inspector (CLI)**:
```bash
npx @modelcontextprotocol/inspector \
  --transport streamable-http \
  --url https://mcp.arjanvandermeer.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN_HERE"
```

**curl**:
```bash
curl -X POST https://mcp.arjanvandermeer.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
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

## Phase 2: Full OAuth2 (Future)

Phase 2 will implement standard OAuth2 endpoints, enabling:

1. **Self-service authentication** - Users can log in via Google without admin intervention
2. **ChatGPT integration** - ChatGPT's MCP Actions UI supports OAuth configuration
3. **MCP Inspector OAuth** - Inspector's OAuth UI will work

### Planned Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/authorize` | GET | Redirect to Google OAuth consent screen |
| `/auth/callback` | GET | Handle Google OAuth callback |
| `/auth/token` | POST | Exchange authorization code for access token |
| `/auth/login` | GET | Web UI for manual login |

### OAuth Flow (ChatGPT Example)

```
1. User configures MCP server in ChatGPT with:
   - Client ID: chatgpt-mcp-client
   - Client Secret: (configured in server)
   - Scope: profile

2. User clicks "Connect" in ChatGPT

3. ChatGPT redirects to:
   https://mcp.arjanvandermeer.com/auth/authorize?
     client_id=chatgpt-mcp-client&
     redirect_uri=https://chatgpt.com/callback&
     scope=profile&
     state=xyz

4. Server redirects to Google OAuth consent

5. User approves, Google redirects back to server

6. Server creates user (if new) and generates auth code

7. Server redirects to ChatGPT callback with code

8. ChatGPT calls POST /auth/token to exchange code for token

9. ChatGPT uses token for all subsequent MCP requests
```

### Device Authorization Flow (CLI Clients)

For headless clients like Claude Desktop that can't open browsers:

```
1. Client calls POST /auth/device to get device_code and user_code

2. User visits https://mcp.arjanvandermeer.com/auth/device
   and enters the user_code

3. User completes Google OAuth in browser

4. Client polls POST /auth/token with device_code until approved

5. Server returns access token
```

## Phase 3: User Features

User-specific features that require authentication.

### Favorites ✅ IMPLEMENTED

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
{
  "success": true,
  "favorite": {
    "favorited_at": "2025-02-02T...",
    "notes": "Book the corner room with city view",
    "osm_id": 123456789,
    "osm_name": "Conrad New York Downtown",
    "poi_type": "hotel",
    "city": "New York",
    "country_code": "US",
    "google_rating": 4.5,
    ...
  }
}
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
      "favorited_at": "2025-02-02T...",
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
- When not using coordinates, results are sorted by `favorited_at` (most recent first)
- Location filters (city vs coordinates) are mutually exclusive

#### Error Handling

All favorites tools require authentication. If called without a valid token:

```json
{
  "error": "Authentication required. Please provide a valid token."
}
```

### Preferences

Store user preferences in `user_config`:
- `preferred_currency` - Display prices in user's currency
- `preferred_language` - Translate results
- `home_location` - Default search location
- `dietary_restrictions` - Filter restaurants

### Trip Planning

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

### Usage Analytics

Track per-user statistics:
- API calls made
- Most searched cities
- Favorite cuisines
- Travel patterns

## Configuration Reference

### User Config Keys

| Key | Values | Description |
|-----|--------|-------------|
| `google_places_limit` | `unlimited`, number | API call limit (default: from app_config) |
| `role` | `admin`, `user` | User role (future use) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (Phase 2) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (Phase 2) |

## Security Considerations

1. **Tokens are secrets** - Never log tokens, send to analytics, or expose in responses
2. **Use HTTPS** - Always use HTTPS in production to protect tokens in transit
3. **Token rotation** - Consider implementing token refresh for long-lived sessions
4. **Revocation** - Set `revoked_at` to immediately invalidate a compromised token
5. **Expiration** - Set `expires_at` for tokens that should auto-expire
