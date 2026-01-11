# HTTP/SSE Transport for Travel MCP Server

The Travel MCP Server supports both **stdio** (for Claude Desktop) and **HTTP with Server-Sent Events (SSE)** transports.

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
  "version": "1.0.0",
  "transport": "http-sse",
  "endpoints": {
    "sse": "/sse",
    "health": "/health"
  }
}
```

## Endpoints

### `GET /health`
Health check endpoint. Returns server status and available endpoints.

### `GET /sse`
Server-Sent Events endpoint for MCP protocol communication. Clients should connect to this endpoint using the MCP SDK's SSE client transport.

### `GET /`
Alias for `/health`.

## Using with MCP Clients

### JavaScript/TypeScript Client

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const transport = new SSEClientTransport(
  new URL('http://localhost:3000/sse')
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

### Python Client

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client

async with sse_client("http://localhost:3000/sse") as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()

        # List tools
        tools = await session.list_tools()
        print(f"Available tools: {tools}")

        # Call a tool
        result = await session.call_tool("search_cities", {"query": "Bangkok"})
        print(f"Search results: {result}")
```

## Available Tools

The HTTP server provides the same tools as the stdio version:

1. **search_cities** - Search for cities by name
2. **search_hotels** - Search for hotels by name/location
3. **search_restaurants** - Search for restaurants by name/location
4. **search_pois** - Search for points of interest
5. **get_poi_details** - Get detailed POI information with Google Places enrichment
6. **get_stats** - Get database statistics

## CORS Support

The HTTP server includes CORS headers to allow browser-based clients:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

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
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # SSE requires these settings
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }
}
```

## Performance Notes

- Each SSE connection creates a dedicated transport
- The server can handle multiple simultaneous connections
- Database connection pooling is handled by pg.Pool
- For high-traffic scenarios, consider running multiple instances behind a load balancer

## Security Considerations

1. **Authentication**: The current implementation has no authentication. Add middleware for production use.
2. **Rate Limiting**: Consider adding rate limiting to prevent abuse.
3. **HTTPS**: Always use HTTPS in production. The server works behind reverse proxies with TLS termination.
4. **Input Validation**: All inputs are validated by the database layer, but additional validation can be added.

## Comparison: stdio vs HTTP/SSE

| Feature | stdio | HTTP/SSE |
|---------|-------|----------|
| Use case | Claude Desktop | Web clients, remote access |
| Connections | Single process | Multiple simultaneous |
| Discovery | Local only | Network accessible |
| Authentication | Process isolation | Requires middleware |
| Debugging | Harder (binary protocol) | Easier (HTTP tools) |
| Performance | Slightly faster | Good for most use cases |

## Troubleshooting

### Connection Refused
- Check that the server is running: `curl http://localhost:3000/health`
- Verify the port is not blocked by firewall
- Check logs for startup errors

### SSE Connection Drops
- Ensure proxy/load balancer supports SSE (no buffering)
- Check for network timeouts
- Verify client implements proper reconnection logic

### Database Errors
- Verify PostgreSQL is running and accessible
- Check DATABASE_URL environment variable
- Ensure PostGIS extension is installed
- Run `npm run db:init` to initialize schema
