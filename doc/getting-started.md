# Getting Started

This guide walks you through setting up the Travel MCP Server on a new workstation, from installation to configuring Claude Desktop.

## Prerequisites

Before you begin, ensure you have:
- **Node.js v24+** installed
- **Git** installed
- **PostgreSQL 14+** with PostGIS extension (we'll help you install this)

---

## Step 1: Clone the Repository

```bash
cd ~/Documents/Development  # Or your preferred location
git clone <your-repo-url> travel-mcp-server
cd travel-mcp-server
```

---

## Step 2: Install Node.js Dependencies

```bash
npm install
```

This installs all required packages including:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `pg` - PostgreSQL client
- `osm-pbf-parser` - OpenStreetMap data parser
- `dotenv` - Environment configuration

---

## Step 3: Set Up PostgreSQL Database

You have two options: **Docker** (easier) or **Native Installation** (better for production).

### Option A: PostgreSQL with Docker (Recommended for Development)

**1. Install Docker Desktop** (if not already installed)
- macOS: https://docs.docker.com/desktop/install/mac-install/
- Windows: https://docs.docker.com/desktop/install/windows-install/
- Linux: https://docs.docker.com/desktop/install/linux-install/

**2. Create a PostgreSQL container and install PostGIS**

We'll use the standard PostgreSQL image and install PostGIS manually since platform-specific PostGIS images may not be available:

```bash
# Create and start PostgreSQL container
docker run -d \
  --name travel-postgres \
  -e POSTGRES_USER=traveluser \
  -e POSTGRES_PASSWORD=travelpass \
  -e POSTGRES_DB=travel \
  -p 5432:5432 \
  postgres:16

# Wait a few seconds for PostgreSQL to start
sleep 5

# Verify it's running
docker ps | grep travel-postgres
```

**3. Install PostGIS in the container**

```bash
# Install PostGIS packages in the container
docker exec -it travel-postgres bash -c "apt-get update && apt-get install -y postgresql-16-postgis-3 postgresql-contrib-16"

# Enable PostGIS extension in the database
docker exec -it travel-postgres psql -U traveluser -d travel -c "CREATE EXTENSION postgis;"

# Enable pg_trgm extension (required for fuzzy text search)
docker exec -it travel-postgres psql -U traveluser -d travel -c "CREATE EXTENSION pg_trgm;"

# Verify PostGIS is installed
docker exec -it travel-postgres psql -U traveluser -d travel -c "SELECT PostGIS_version();"
```

**Expected output:**
```
             postgis_version
-----------------------------------------
 3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1
(1 row)
```

**4. Test the connection**

```bash
# Connect to the database interactively
docker exec -it travel-postgres psql -U traveluser -d travel

# You should see a PostgreSQL prompt:
# travel=#

# Test a spatial query
SELECT ST_AsText(ST_Point(100.5018, 13.7563));

# Exit with:
\q
```

**4. Create `.env` file for database configuration**

```bash
cat > .env << 'EOF'
DATABASE_URL=postgresql://traveluser:travelpass@localhost:5432/travel
EOF
```

**Docker Management Commands:**

```bash
# Start the container (if stopped)
docker start travel-postgres

# Stop the container
docker stop travel-postgres

# View logs
docker logs travel-postgres

# Remove container (WARNING: deletes all data)
docker rm -f travel-postgres
```

---

### Option B: Native PostgreSQL Installation

**macOS (using Homebrew):**

```bash
# Install PostgreSQL and PostGIS
brew install postgresql@16 postgis

# Start PostgreSQL
brew services start postgresql@16

# Create user and database
createuser -s traveluser
psql postgres -c "ALTER USER traveluser WITH PASSWORD 'travelpass';"
createdb -O traveluser travel
```

**Ubuntu/Debian Linux:**

```bash
# Install PostgreSQL and PostGIS
sudo apt-get update
sudo apt-get install postgresql-16 postgresql-16-postgis-3 postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create user and database
sudo -u postgres createuser traveluser
sudo -u postgres psql -c "ALTER USER traveluser WITH PASSWORD 'travelpass';"
sudo -u postgres createdb -O traveluser travel
```

**Windows:**

1. Download PostgreSQL installer from https://www.postgresql.org/download/windows/
2. Run installer (includes PostGIS as an optional component - **make sure to select it**)
3. During setup, set password for `postgres` user
4. After installation, open **pgAdmin 4** or **SQL Shell (psql)**
5. Create user and database:

```sql
CREATE USER traveluser WITH PASSWORD 'travelpass';
CREATE DATABASE travel OWNER traveluser;
```

**Create `.env` file:**

```bash
# Create .env file with database connection
cat > .env << 'EOF'
DATABASE_URL=postgresql://traveluser:travelpass@localhost:5432/travel
EOF
```

---

## Step 4: Initialize Database Schema

Now that PostgreSQL is running, safely create any missing database tables:

```bash
# Option 1: Using npm script (recommended)
npm run db:init

# Option 2: Manual import
psql postgresql://traveluser:travelpass@localhost:5432/travel < data/schema.sql
```

`data/schema.sql` is non-destructive and can be re-run without dropping existing travel data. For a destructive local development reset, run:

```bash
npm run db:reset
```

**Verify the setup:**

```bash
psql postgresql://traveluser:travelpass@localhost:5432/travel -c "\dt"
```

You should see tables like:
- `geonames_countries`
- `geonames_cities`
- `osm_pois`
- `imports`
- `google_places`
- `osm_google_mappins`
- `regions`

**Verify PostGIS extension:**

```bash
psql postgresql://traveluser:travelpass@localhost:5432/travel -c "SELECT PostGIS_version();"
```

---

## Step 5: Import Data

### 5.1 Import GeoNames City Data

This imports ~150,000 cities worldwide with population > 1,000:

```bash
npm run db:import-geonames
```

**Expected output:**
```
Downloading GeoNames data...
Processing cities...
Imported 150,000 cities
Import complete in 2m 34s
```

**Time estimate:** 2-5 minutes depending on internet speed

---

### 5.2 Import OpenStreetMap POI Data

Import hotels, restaurants, attractions, and other points of interest from OpenStreetMap.

**Step 1: Download a PBF file**

Download regional OSM data from Geofabrik: https://download.geofabrik.de/

```bash
# Create data directory if it doesn't exist
mkdir -p data

# Download Thailand (example - small country, good for testing)
curl -L -o data/thailand-latest.osm.pbf https://download.geofabrik.de/asia/thailand-latest.osm.pbf

# Or download other regions:
# Netherlands
curl -L -o data/netherlands-latest.osm.pbf https://download.geofabrik.de/europe/netherlands-latest.osm.pbf

# US - California
curl -L -o data/california-latest.osm.pbf https://download.geofabrik.de/north-america/us/california-latest.osm.pbf

# France
curl -L -o data/france-latest.osm.pbf https://download.geofabrik.de/europe/france-latest.osm.pbf
```

**Popular regions to download:**
- **Small/Fast** (good for testing): Netherlands, Thailand, Portugal
- **Medium**: France, Germany, UK, California
- **Large** (slower): USA, Brazil, Japan

**Find more regions:** Browse https://download.geofabrik.de/ for your region

**Step 2: Import the PBF file**

```bash
# Import all POI types from the downloaded file
node scripts/import-osm.js data/thailand-latest.osm.pbf all

# Or import specific types only:
node scripts/import-osm.js data/thailand-latest.osm.pbf hotel
node scripts/import-osm.js data/thailand-latest.osm.pbf restaurant
```

**Expected output:**
```
Starting import from: data/thailand-latest.osm.pbf
Region: thailand-latest
POI Type: all

✓ Connected to PostgreSQL
Processing POIs...
Batch 1: Inserted 5000 POIs
Batch 2: Inserted 5000 POIs
Batch 3: Inserted 5000 POIs
...

✅ Import complete!
Total POIs imported: 24,567
  - Hotels: 3,421
  - Restaurants: 8,234
  - Attractions: 4,567
  - Other: 8,345
Time: 2m 15s
```

**Time estimates:**
- Small country (Netherlands, Thailand): 2-10 minutes
- Medium country (France, Germany): 15-45 minutes
- Large country (USA, Brazil): 1-4 hours

**Tip:** Start with a small country to test the system before importing larger regions.

---

## Step 6: Configure Google Places API (Optional)

Google Places API enriches POIs with ratings, reviews, photos, and verified business details.

**Note:** This step is **optional**. The server works fine with just OpenStreetMap data.

### 6.1 Get Google Places API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **"Places API (New)"**
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Copy your API key

**Cost estimate:** ~$0.05 per POI enrichment.With 7-day caching and batch limiting, it tries to save some money.

### 6.2 Store API Key in Database (Recommended)

```bash
# Set API key
node scripts/manage-config.js set google_places_api_key <google-api-key>

# Verify it's saved
node scripts/manage-config.js list
```

**Why database config?** Claude Desktop sometimes seems to have issues reading `.env` files. Database configuration is more reliable and persists across restarts. Yes, I do realize the contradiction between this and the database config also in .env - I'll fix it at some point. 

### 6.3 Alternative: Environment Variables

Add to `.env` file:

```bash
GOOGLE_PLACES_API_KEY=<google-api-key>
GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_CACHE_HOURS=168  # 7 days
```

### 6.4 Test Google Places Integration

```bash
# Test with a sample query
node tests/test-google-places.js
```

---

## Step 6.5: Configure Sentry Telemetry (Optional)

Sentry provides error tracking and performance monitoring. It helps you understand how the server is performing and catch errors in production.

**Note:** This step is **optional**. The server works fine without telemetry.

### 6.5.1 Get Sentry DSN

1. Go to [Sentry.io](https://sentry.io/) and create an account
2. Create a new project (select Node.js)
3. Go to **Settings** → **Projects** → **<sentry-project>** → **Client Keys (DSN)**
4. Copy your DSN (looks like: `https://xxxxx@xxx.ingest.sentry.io/xxxxx`)

**Cost:** Sentry has a free tier with 5K errors/month.

### 6.5.2 Store DSN in Database (Recommended)

```bash
# Set Sentry DSN
node scripts/manage-config.js set sentry_dsn <sentry-dsn>

# Verify it's saved
node scripts/manage-config.js list
```

### 6.5.3 Alternative: Environment Variables

Add to `.env` file:

```bash
SENTRY_DSN=https://xxxxx@xxx.ingest.sentry.io/xxxxx
TELEMETRY_ENABLED=true
TELEMETRY_SAMPLE_RATE=1.0      # 1.0 = 100% of requests traced
TELEMETRY_ENVIRONMENT=development
```

### 6.5.4 Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTRY_DSN` | (none) | Your Sentry DSN. Required for telemetry. |
| `TELEMETRY_ENABLED` | `true` | Set to `false` to disable telemetry even if DSN is set |
| `TELEMETRY_SAMPLE_RATE` | `1.0` | Trace sample rate 0.0-1.0 (reduce for high-traffic) |
| `TELEMETRY_ENVIRONMENT` | `development` | Environment name shown in Sentry |
| `SENTRY_SEND_DEV` | (not set) | Set to `true` to send events in development mode |

### 6.5.5 What Gets Tracked

- **Errors:** All exceptions are captured with context
- **Performance:** Request duration for each MCP tool call
- **Breadcrumbs:** Tool calls and their arguments for debugging

### 6.5.6 Verify Telemetry

After configuring, start the server and make a request:

```bash
npm start
```

Check the logs for:
```
[Telemetry] Sentry initialized successfully
[Telemetry] Enabled (env: development, sample: 1)
```

Then visit your Sentry dashboard to see events.

---

## Step 7: Test the MCP Server

### Test stdio server (for Claude Desktop):

```bash
npm start
```

**Expected output:**
```
Travel MCP Server running on stdio
Database connected
Ready to accept MCP requests
```

Press `Ctrl+C` to stop.

### Test HTTP server (for web clients):

The HTTP server supports two MCP transport protocols simultaneously:

| Endpoint | Protocol | Use Case |
|----------|----------|----------|
| `POST /` | StreamableHTTP | ChatGPT and modern MCP clients |
| `GET /sse` | SSE | MCP Inspector and legacy SSE clients |
| `GET /mcp` | SSE (alt) | Alternative SSE endpoint |
| `GET /health` | JSON | Health check endpoint |

```bash
# Terminal 1: Start server
npm run start:http
# Output shows:
#   Travel MCP Server running on http://localhost:3000
#   Endpoints:
#     - StreamableHTTP: POST http://localhost:3000/
#     - SSE:            GET  http://localhost:3000/sse
#     - SSE (alt):      GET  http://localhost:3000/mcp
#     - Health:         GET  http://localhost:3000/health

# Terminal 2: Test with client
node tests/test-http-client.js
```

### Connecting ChatGPT to Your Server

1. Start the HTTP server: `npm run start:http`
2. Expose via ngrok (ChatGPT requires HTTPS):
   ```bash
   ngrok http 3000
   ```
3. Copy the ngrok HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. In ChatGPT, go to Settings > MCP Servers > Add custom server
5. Use the ngrok URL as your server endpoint

### Alternative: Test with MCP Inspector

MCP Inspector provides a web-based UI to interactively test your MCP server without configuring Claude Desktop:

```bash
# Run stdio server with Inspector
npm run inspect

# Run HTTP server with Inspector (connects to /sse SSE endpoint)
npm run inspect:http

# With auto-reload on code changes
npm run inspect:watch
npm run inspect:watch:http
```

This opens a browser UI where you can:
- Browse available tools
- Execute tools with custom parameters
- See full request/response payloads
- Debug issues before connecting to Claude Desktop

---

## Step 8: Configure Claude Desktop

### 8.1 Find Your Node.js Path

```bash
which node
```

**Example output:**
- macOS: `/Users/yourname/.nvm/versions/node/v24.0.0/bin/node`
- Linux: `/home/yourname/.nvm/versions/node/v24.0.0/bin/node`
- Windows: `C:\Program Files\nodejs\node.exe`

**Important:** Use the **absolute path**, not `node` or `~/path/to/node`

### 8.2 Find Your Project Path

```bash
pwd
```

**Example output:**
- macOS: `/Users/yourname/Documents/Development/travel-mcp-server`
- Linux: `/home/yourname/Documents/Development/travel-mcp-server`
- Windows: `C:\Users\yourname\Documents\Development\travel-mcp-server`

### 8.3 Locate Claude Desktop Config File

**macOS:**
```bash
code "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
```

**Windows:**
```cmd
notepad "%APPDATA%\Claude\claude_desktop_config.json"
```

**Linux:**
```bash
code "$HOME/.config/Claude/claude_desktop_config.json"
```

### 8.4 Add MCP Server Configuration

Add this to the config file (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "travel-info": {
      "command": "/FULL/PATH/TO/node",
      "args": ["/FULL/PATH/TO/travel-mcp-server/src/index.js"]
    }
  }
}
```

**Example (macOS):**

```json
{
  "mcpServers": {
    "travel-info": {
      "command": "/Users/arjan/.nvm/versions/node/v24.0.0/bin/node",
      "args": ["/Users/arjan/Documents/Development/travel-mcp-server/src/index.js"]
    }
  }
}
```

**Example (Windows):**

```json
{
  "mcpServers": {
    "travel-info": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\arjan\\Documents\\Development\\travel-mcp-server\\src\\index.js"]
    }
  }
}
```

**Important:**
- Use **absolute paths** (no `~` or relative paths)
- On Windows, use double backslashes (`\\`) or forward slashes (`/`)
- Ensure the JSON is valid (use a JSON validator if unsure)

### 8.5 Restart Claude Desktop

**macOS:**
```bash
# Quit Claude Desktop completely (Cmd+Q)
# Then reopen from Applications
```

**Windows:**
- Right-click system tray → Quit
- Reopen from Start Menu

**Linux:**
```bash
killall claude
# Then restart from application menu
```

### 8.6 Verify MCP Server is Connected

1. Open Claude Desktop
2. Start a new conversation
3. Look for the 🔌 icon or "MCP" indicator
4. Try a test query:

```
Find hotels in Bangkok
```

You should see results with hotel names, addresses, and ratings (if Google Places is configured).

---

## Troubleshooting

### Database Connection Issues

**Error:** `ECONNREFUSED` or `connection refused`

```bash
# Check if PostgreSQL is running
docker ps | grep travel-postgres  # Docker
# OR
brew services list | grep postgresql  # macOS native
sudo systemctl status postgresql  # Linux native

# Restart PostgreSQL if needed
docker start travel-postgres  # Docker
brew services restart postgresql@16  # macOS
sudo systemctl restart postgresql  # Linux
```

**Error:** `authentication failed for user "traveluser"`

```bash
# Reset password
psql postgres -c "ALTER USER traveluser WITH PASSWORD 'travelpass';"

# Verify .env file has correct credentials
cat .env
```

---

### Node.js Version Issues

**Error:** `SyntaxError: Unexpected token '?'` or similar

```bash
# Check Node version
node --version

# Must be v24 or higher
# Install correct version:
nvm install 24
nvm use 24
```

---

### PostGIS Extension Missing

**Error:** `extension "postgis" does not exist` or `operator class "gin_trgm_ops" does not exist`

```bash
# Connect to database and enable required extensions
psql postgresql://traveluser:travelpass@localhost:5432/travel

# Run in psql prompt:
CREATE EXTENSION postgis;
CREATE EXTENSION pg_trgm;
\q
```

**For Docker users:**
```bash
# Install extensions in the container
docker exec -it travel-postgres psql -U traveluser -d travel -c "CREATE EXTENSION postgis;"
docker exec -it travel-postgres psql -U traveluser -d travel -c "CREATE EXTENSION pg_trgm;"
```

---

### Claude Desktop Not Finding Server

**Check logs (macOS):**
```bash
tail -f "$HOME/Library/Logs/Claude/mcp-server-travel-info.log"
```

**Common issues:**
- ❌ Using `~` in paths → Use absolute paths
- ❌ Using relative paths → Use absolute paths
- ❌ Wrong Node.js path → Run `which node` to find correct path
- ❌ Invalid JSON in config → Validate JSON syntax
- ❌ Didn't restart Claude Desktop → Quit completely and reopen

---

### Import Failures

**Error:** `Download failed` or `HTTP 404`

```bash
# Check internet connection
curl -I http://download.geonames.org/export/dump/allCountries.zip

# Try manual download and import
wget http://download.geonames.org/export/dump/allCountries.zip
unzip allCountries.zip
# Then modify import script to use local file
```

**Error:** `Out of memory` during import

```bash
# Increase Node.js memory limit
node --max-old-space-size=4096 scripts/import-osm.js
```

---

### Google Places API Issues

**Error:** `API key not valid`

```bash
# Verify API key is set correctly
node scripts/manage-config.js list

# Check that "Places API (New)" is enabled in Google Cloud Console
# NOT "Places API" (legacy) - must be the NEW version
```

**Error:** `QUOTA_EXCEEDED`

- You've hit your daily API limit
- Check billing in Google Cloud Console
- Consider reducing cache hours or batch size

---

## Next Steps

Now that your server is running:

1. **Try example queries in Claude Desktop:**
   - "Find hotels in Paris"
   - "Search for Italian restaurants in Bangkok"
   - "What museums are near Times Square?"
   - "Show me cafes in London with high ratings"

2. **Import more regions:**
   - Run `npm run db:import-all-pois` to add more cities/countries

3. **Review documentation:**
   - [README.md](README.md) - Full feature documentation
   - [GitHub Issues](https://github.com/arjanvandermeer/travel-mcp-server/issues) - Planned improvements and known issues
   - [google-places.md](doc/google-places.md) - Google Places API integration

4. **Customize configuration:**
   - Adjust cache duration in `.env`
   - Configure search radii and batch limits
   - Set up API rate limiting

---

## Quick Reference

### Database Connection String
```
postgresql://traveluser:travelpass@localhost:5432/travel
```

### Essential Commands
```bash
# Start stdio server
npm start

# Start HTTP server
npm run start:http

# Development mode (auto-reload)
npm run dev
npm run dev:http

# MCP Inspector (interactive testing UI)
npm run inspect
npm run inspect:http

# Import data
npm run db:import-geonames                         # Import GeoNames cities
node scripts/import-osm.js data/REGION.osm.pbf all # Import OSM POIs

# Download OSM data
curl -L -o data/thailand-latest.osm.pbf https://download.geofabrik.de/asia/thailand-latest.osm.pbf

# Manage Google API config
node scripts/manage-config.js list
node scripts/manage-config.js set google_places_api_key <google-api-key>
node scripts/manage-config.js delete google_places_api_key

# Database management
npm run db:init                          # Safely initialize missing schema objects
npm run db:reset                         # Destructive local reset, then recreate schema
psql $DATABASE_URL                       # Connect to database
psql $DATABASE_URL < data/schema.sql     # Safely re-run schema
```

### Docker PostgreSQL Commands
```bash
docker start travel-postgres       # Start container
docker stop travel-postgres        # Stop container
docker restart travel-postgres     # Restart container
docker logs travel-postgres        # View logs
docker exec -it travel-postgres psql -U traveluser -d travel  # Connect to DB
```

---

## Support

If you encounter issues not covered in this guide:

1. Check [GitHub Issues](https://github.com/arjanvandermeer/travel-mcp-server/issues) for known issues
2. Review server logs: `npm start` shows real-time logs
3. Check Claude Desktop logs (location shown in Troubleshooting section)
4. Open an issue on the GitHub repository

---

**Congratulations! Your Travel MCP Server is now ready to use.** 🎉
