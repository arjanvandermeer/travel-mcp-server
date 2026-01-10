# Claude Desktop Configuration

To use this MCP server with Claude Desktop, add it to your configuration file.

## Configuration File Location

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

## Configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "travel-info": {
      "command": "node",
      "args": [
        "/Users/arjanvandermeer/Documents/Development/hotel-mcp-server/src/index.js"
      ],
      "env": {
        "DATABASE_URL": "postgresql://traveluser:travelpass@localhost:5432/travel"
      }
    }
  }
}
```

**Important:** Replace the path with your actual project path!

## Verify PostgreSQL is Running

Before starting Claude Desktop, make sure PostgreSQL is running:

```bash
cd /Users/arjanvandermeer/Documents/Development/hotel-mcp-server
docker-compose ps
```

Should show:
```
NAME              STATUS
travel-postgres   Up (healthy)
```

If not running:
```bash
docker-compose up -d
```

## Restart Claude Desktop

After updating the config:
1. Quit Claude Desktop completely
2. Relaunch Claude Desktop
3. The MCP server will start automatically

## Available Tools

Once configured, Claude will have access to these tools:

1. **search_cities** - Search for cities by name
2. **find_hotels_in_city** - Find hotels in a city (auto radius based on population)
3. **find_hotels_near_coordinates** - Find hotels near GPS coordinates
4. **get_database_stats** - Get database statistics

## Test It

Ask Claude:
- "Find hotels in Bangkok"
- "Search for cities named Paris"
- "Find hotels near coordinates 13.7563, 100.5018"
- "Show me database statistics"

## Troubleshooting

### MCP server not showing up

1. Check the config file path is correct
2. Make sure PostgreSQL is running
3. Restart Claude Desktop
4. Check Claude Desktop logs

### Connection errors

- Verify PostgreSQL is running: `docker-compose ps`
- Test connection: `docker-compose exec postgres psql -U traveluser -d travel -c "SELECT 1;"`
- Check DATABASE_URL in config matches your setup

### No data returned

- Verify data was imported:
  ```bash
  npm run test
  ```
- Check database has data:
  ```bash
  docker-compose exec postgres psql -U traveluser -d travel -c "SELECT COUNT(*) FROM hotels;"
  ```
