# PostgreSQL + PostGIS Setup with Docker

This guide covers setting up PostgreSQL with PostGIS extension using Docker for the travel MCP server.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)

## Quick Start

### 1. Start PostgreSQL

```bash
docker-compose up -d
```

This will:
- Download the PostGIS image (if needed)
- Create a PostgreSQL container named `travel-postgres`
- Create database `travel` with PostGIS extension
- Expose PostgreSQL on port 5432

### 2. Verify it's running

```bash
docker-compose ps
```

You should see:
```
NAME              IMAGE                    STATUS
travel-postgres   postgis/postgis:17-3.5   Up (healthy)
```

### 3. Test the connection

```bash
docker-compose exec postgres psql -U traveluser -d travel -c "SELECT version();"
```

### 4. Verify PostGIS is installed

```bash
docker-compose exec postgres psql -U traveluser -d travel -c "SELECT PostGIS_Version();"
```

## Connection Details

Use these credentials in your application:

```
Host: localhost
Port: 5432
Database: travel
Username: traveluser
Password: travelpass
```

**Connection String:**
```
postgresql://traveluser:travelpass@localhost:5432/travel
```

## Common Commands

### Start PostgreSQL
```bash
docker-compose up -d
```

### Stop PostgreSQL
```bash
docker-compose stop
```

### Restart PostgreSQL
```bash
docker-compose restart
```

### View logs
```bash
docker-compose logs -f postgres
```

### Connect to PostgreSQL CLI
```bash
docker-compose exec postgres psql -U traveluser -d travel
```

Once connected, useful commands:
- `\dt` - List tables
- `\d tablename` - Describe table
- `\q` - Quit

### Stop and remove container (keeps data)
```bash
docker-compose down
```

### Stop and remove ALL data (⚠️ destructive)
```bash
docker-compose down -v
```

## Backup and Restore

### Create backup
```bash
docker-compose exec -T postgres pg_dump -U traveluser travel > backup.sql
```

### Restore backup
```bash
docker-compose exec -T postgres psql -U traveluser -d travel < backup.sql
```

## Migrating to Hosted PostgreSQL

When ready to move to AWS RDS or other hosted PostgreSQL:

1. **Export your data:**
   ```bash
   docker-compose exec -T postgres pg_dump -U traveluser travel > production_export.sql
   ```

2. **Update connection string** in your code from:
   ```
   postgresql://traveluser:travelpass@localhost:5432/travel
   ```

   To your hosted endpoint:
   ```
   postgresql://username:password@your-rds-endpoint.amazonaws.com:5432/travel
   ```

3. **Import data to hosted database:**
   ```bash
   psql -h your-rds-endpoint.amazonaws.com -U username -d travel < production_export.sql
   ```

No code changes needed - just the connection string!

## Troubleshooting

### Port 5432 already in use
If you have another PostgreSQL instance running:
```bash
# Check what's using port 5432
lsof -i :5432

# Stop local PostgreSQL (if using Homebrew)
brew services stop postgresql
```

Or change the port in docker-compose.yml:
```yaml
ports:
  - "5433:5432"  # Use port 5433 instead
```

Then connect to `localhost:5433`

### Container won't start
Check logs:
```bash
docker-compose logs postgres
```

### Reset everything
```bash
docker-compose down -v
docker-compose up -d
```

## Next Steps

After PostgreSQL is running:

1. **Install Node.js PostgreSQL client:**
   ```bash
   npm install pg
   ```

2. **Import OSM data** using the PBF import script (coming next)

3. **Update MCP server** to connect to PostgreSQL instead of SQLite
