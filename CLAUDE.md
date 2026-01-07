# Claude Instructions for hotel-mcp-server

## Project Context
This is a Model Context Protocol (MCP) server that provides hotel and geographic information from open data sources (GeoNames, OpenStreetMap, Wikidata).

## Development Workflow

### Decision Framework for New Ideas
When a new idea, improvement, or task comes up during discussion:

1. **Pause and ask**: "Should we add this to TODO.md or work on it now?"
2. **If TODO**: Add it to the appropriate priority section and continue current work
3. **If now**: Explicitly acknowledge we're interrupting current flow to implement it

**Never silently add tasks without discussing priority first.**

## Code Organization

### Tool Definitions
- **All MCP tools** are defined in `src/tools-config.js`
- This is the **single source of truth** for tool definitions and handlers
- Both `src/index.js` (stdio) and `src/index-http.js` (HTTP) import from this file
- When adding new tools:
  1. Add tool definition to `toolsConfig` array
  2. Add case handler in `executeToolHandler()` function
  3. Both servers automatically pick up changes

### File Structure
```
src/
├── database.js           # Database layer (all SQL queries)
├── tools-config.js       # MCP tool definitions (single source of truth)
├── index.js             # Stdio MCP server
├── index-http.js        # HTTP/SSE MCP server
├── import-geonames.js   # Import GeoNames countries & cities
├── import-geonames-extended.js  # Import extended GeoNames data
└── import-osm.js        # Import OpenStreetMap hotel data
```

## Important Conventions

### Shared Configuration
- Tools are shared between stdio and HTTP servers via `src/tools-config.js`
- Never duplicate tool definitions - always use the shared config
- This prevents the servers from getting out of sync

### Database Methods
- All database operations in `src/database.js`
- Methods should be reusable across different tools
- Use prepared statements and transactions for bulk operations

### Import Scripts
- All import scripts should show progress for long operations
- Use batch processing for large datasets (5000-10000 records per batch)
- Always report final stats when complete

### Error Handling
- MCP tools should return `{ isError: true }` for errors
- Log errors in stdio server to `mcp-server.log` for debugging
- Never use `console.log()` in stdio server (interferes with JSON-RPC protocol)

## Testing
- Test new features before committing
- Verify both stdio and HTTP servers work after changes
- Check that database queries are efficient

## Known Issues / Future Work
See `TODO.md` for tracked improvements and future work.

## Key Technical Details

### Node Version
- Project requires Node.js v24+ (for better-sqlite3 compatibility)
- Claude Desktop config specifies absolute path to Node binary to avoid version conflicts

### MCP Protocol
- Uses `@modelcontextprotocol/sdk` v1.0.4
- Stdio transport for Claude Desktop integration
- HTTP/SSE transport available for other clients

### Database
- SQLite with better-sqlite3
- 9 tables: cities, countries, hotels, alternate_names, admin codes, timezones, feature codes, hierarchy
- Spatial indexing for geographic queries
- ~600K+ records after full import

## Don't Do This
- ❌ Add console.log() to stdio server (breaks protocol)
- ❌ Duplicate tool definitions between servers
- ❌ Make changes without discussing TODO vs. immediate work
- ❌ Commit without testing both servers
- ❌ Add features without documenting in TODO.md or implementing immediately
