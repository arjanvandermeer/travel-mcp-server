#!/bin/bash

# Reset PostgreSQL database and container
# This will DELETE ALL DATA and start fresh with ARM64 architecture

set -e

echo "⚠️  WARNING: This will DELETE ALL DATA in the travel database!"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "🛑 Stopping and removing existing container..."
docker-compose down -v

echo ""
echo "🚀 Starting new ARM64 container..."
docker-compose up -d

echo ""
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Wait for postgres to be fully ready
until docker-compose exec -T postgres pg_isready -U traveluser -d travel > /dev/null 2>&1; do
    echo "  Waiting for PostgreSQL..."
    sleep 2
done

echo ""
echo "📋 Creating database schema..."
docker-compose exec -T postgres psql -U traveluser -d travel < schema.sql

echo ""
echo "✅ Database reset complete!"
echo ""
echo "Next steps:"
echo "  1. Import GeoNames: npm run db:import-geonames"
echo "  2. Import POIs: npm run db:import-pois thailand-latest.osm.pbf all"
echo ""
