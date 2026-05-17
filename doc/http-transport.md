# HTTP Transport for Travel MCP Server

The Travel MCP Server supports both **stdio** (for Claude Desktop) and **Streamable HTTP** transports.

## Quick Start

### Start the HTTP Server

```bash
# Start on default port 3000
npm run start:http

# Start on custom port
node src/index-http.js 8080

# Development mode with auto-reload
npm run dev:http
```

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "server": "travel-mcp-server",
  "version": "1.1.0",
  "transport": "streamable-http",
  "activeSessions": 0,
  "endpoints": {
    "mcp": "/mcp",
    "health": "/health",
    "preview": "/preview/poi/{osm_id}"
  }
}
```

### OpenAPI Specification

The REST API used by the web frontend is documented in [openapi.yaml](openapi.yaml) and served by the HTTP process:

```bash
curl http://localhost:3000/openapi.yaml
```

The spec covers the public `/api/v1/*` routes, `/auth/*` web auth routes, optional bearer/session authentication, and favorites endpoints that require authentication.

## Endpoints

### `GET /health`
Health check endpoint. Returns server status and available endpoints.

### `/mcp`
Streamable HTTP endpoint for MCP protocol communication. Clients should connect to this endpoint using the MCP SDK's Streamable HTTP client transport.

### `GET /`
Serves the browser frontend from `web/index.html`.

## Using with MCP Clients

### JavaScript/TypeScript Client

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp')
);

const client = new Client({
  name: 'travel-client',
  version: '1.0.0',
}, {
  capabilities: {}
});

await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools);

// Call a tool
const result = await client.callTool({
  name: 'search_cities',
  arguments: {
    query: 'Bangkok'
  }
});
console.log('Search results:', result);
```

## Available Tools

The HTTP server provides the same tools as the stdio version:

1. **search_cities** - Search for cities by name
2. **search_hotels** - Search for hotels by name/location
3. **compare_hotels** - Compare 2-5 hotels side by side
4. **get_neighborhood_score** - Score nearby amenities around a hotel or coordinates
5. **build_itinerary** - Build day plans from a hotel base
6. **search_restaurants** - Search for restaurants by name/location
7. **plan_dining** - Build a dining plan for a city
8. **get_dining_budget** - Estimate city dining costs from price-level data
9. **find_food_districts** - Find restaurant-dense city areas
10. **search_pois** - Search for points of interest
11. **get_poi_details** - Get detailed POI information with Google Places enrichment
12. **get_nearby_pois** - Find nearby complementary POIs
13. **whoami**, **get_user_preferences**, **set_user_preferences**, **add_favorite**, **remove_favorite**, **list_favorites** - Authenticated user features
14. **get_stats** - Get database statistics

## CORS Support

The HTTP server includes CORS headers to allow browser-based clients:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, POST, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, mcp-session-id, MCP-Protocol-Version, Authorization`
- `Access-Control-Expose-Headers: mcp-session-id`

## Deployment

### Docker

```dockerfile
FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

EXPOSE 3000
CMD ["node", "src/index-http.js"]
```

Build and run:
```bash
docker build -t travel-mcp-server .
docker run -p 3000:3000 -e DATABASE_URL=postgresql://... travel-mcp-server
```

### Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `GOOGLE_PLACES_API_KEY` - Google Places API key (optional, for enrichment)

### Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;

        # Keep MCP Streamable HTTP responses unbuffered.
        proxy_buffering off;
        proxy_cache off;
    }
}
```

## Performance Notes

- Each MCP session creates a dedicated Streamable HTTP transport
- The server can handle multiple simultaneous sessions in one process
- Database connection pooling is handled by pg.Pool
- For high-traffic scenarios, consider running multiple instances behind a load balancer

## Security Considerations

1. **Authentication**: See [authentication.md](authentication.md) for token and OAuth authentication options.
2. **Rate Limiting**: Consider adding rate limiting to prevent abuse.
3. **HTTPS**: Always use HTTPS in production. The server works behind reverse proxies with TLS termination.
4. **Input Validation**: All inputs are validated by the database layer, but additional validation can be added.

## Comparison: stdio vs Streamable HTTP

| Feature | stdio | Streamable HTTP |
|---------|-------|----------|
| Use case | Claude Desktop | Web clients, remote access |
| Connections | Single process | Multiple simultaneous |
| Discovery | Local only | Network accessible |
| Authentication | Process isolation | Token or OAuth |
| Debugging | Harder (binary protocol) | Easier (HTTP tools) |
| Performance | Slightly faster | Good for most use cases |

## Troubleshooting

### Connection Refused
- Check that the server is running: `curl http://localhost:3000/health`
- Verify the port is not blocked by firewall
- Check logs for startup errors

### Streamable HTTP Session Drops
- Check for network timeouts or proxy buffering that interrupts long-lived responses
- Verify clients preserve the `mcp-session-id` header returned by the server
- Use sticky routing if you later run multiple HTTP server processes

### Database Errors
- Verify PostgreSQL is running and accessible
- Check DATABASE_URL environment variable
- Ensure PostGIS extension is installed
- Run `npm run db:init` to initialize schema
