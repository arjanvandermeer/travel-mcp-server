import pg from 'pg';

const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://traveluser:travelpass@localhost:5432/travel';

export class TravelDatabase {
  constructor() {
    this.pool = new pg.Pool({ connectionString: CONNECTION_STRING });
  }

  async close() {
    await this.pool.end();
  }

  // =========================================================================
  // City Search
  // =========================================================================

  async searchCities(query, countryCode = null, limit = 10) {
    let queryText = `
      SELECT
        geoname_id,
        name,
        ascii_name,
        country_code,
        population,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        timezone
      FROM geonames_cities
      WHERE (name ILIKE $1 OR ascii_name ILIKE $1)
    `;

    const params = [`%${query}%`];

    if (countryCode) {
      queryText += ` AND country_code = $${params.length + 1}`;
      params.push(countryCode.toUpperCase());
    }

    queryText += ` ORDER BY population DESC NULLS LAST LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(queryText, params);
    return result.rows;
  }

  async getCityById(geonameId) {
    const result = await this.pool.query(`
      SELECT
        geoname_id,
        name,
        ascii_name,
        country_code,
        population,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        timezone
      FROM geonames_cities
      WHERE geoname_id = $1
    `, [geonameId]);

    return result.rows[0] || null;
  }

  // =========================================================================
  // Hotel Search (now uses unified POIs table)
  // =========================================================================

  async getHotelsNearCoordinates(latitude, longitude, radiusKm, limit = 50) {
    const radiusMeters = radiusKm * 1000;

    const result = await this.pool.query(`
      SELECT
        osm_id,
        osm_type,
        name,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        stars,
        rooms,
        beds,
        address,
        phone,
        email,
        website,
        ST_Distance(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) as distance_meters
      FROM pois
      WHERE poi_type = 'hotel'
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
      ORDER BY distance_meters
      LIMIT $4
    `, [latitude, longitude, radiusMeters, limit]);

    return result.rows;
  }

  async findHotelsInCity(cityName, countryCode = null, limit = 50) {
    // First, find the city
    let cityQuery = `
      SELECT
        geoname_id,
        name,
        ascii_name,
        country_code,
        population,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        timezone
      FROM geonames_cities
      WHERE name ILIKE $1
    `;

    const params = [cityName];

    if (countryCode) {
      cityQuery += ` AND country_code = $2`;
      params.push(countryCode);
    }

    cityQuery += ` ORDER BY population DESC NULLS LAST LIMIT 1`;

    const cityResult = await this.pool.query(cityQuery, params);

    if (cityResult.rows.length === 0) {
      return {
        city: null,
        hotels: [],
        count: 0,
        message: `City "${cityName}" not found`,
      };
    }

    const city = cityResult.rows[0];

    // Determine radius based on population
    const radiusKm = this.getRadiusForPopulation(city.population || 100000);

    // Get hotels near city center
    const hotels = await this.getHotelsNearCoordinates(
      city.latitude,
      city.longitude,
      radiusKm,
      limit
    );

    return {
      city: {
        geoname_id: city.geoname_id,
        name: city.name,
        country_code: city.country_code,
        population: city.population,
        latitude: city.latitude,
        longitude: city.longitude,
      },
      radius_km: radiusKm,
      hotels: hotels,
      count: hotels.length,
    };
  }

  getRadiusForPopulation(population) {
    if (population > 5000000) return 25; // Mega cities (>5M)
    if (population > 1000000) return 15; // Large cities (1-5M)
    if (population > 500000) return 10;  // Medium cities (500k-1M)
    if (population > 100000) return 5;   // Small cities (100k-500k)
    return 3; // Towns (<100k)
  }

  async getHotelById(osmId) {
    const result = await this.pool.query(`
      SELECT
        osm_id,
        osm_type,
        name,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        stars,
        rooms,
        beds,
        address,
        phone,
        email,
        website,
        tags,
        source_region,
        imported_at
      FROM pois
      WHERE osm_id = $1 AND poi_type = 'hotel'
    `, [osmId]);

    return result.rows[0] || null;
  }

  // =========================================================================
  // POI Search
  // =========================================================================

  async searchPOIs(query, poiType = null, limit = 20) {
    let queryText = `
      SELECT
        osm_id,
        osm_type,
        poi_type,
        name,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        address,
        cuisine,
        opening_hours,
        phone,
        website,
        stars,
        rooms,
        beds,
        similarity(name, $1) as similarity_score
      FROM pois
      WHERE name % $1
    `;

    const params = [query];

    if (poiType) {
      queryText += ` AND poi_type = $${params.length + 1}`;
      params.push(poiType);
    }

    queryText += ` ORDER BY similarity_score DESC, name LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(queryText, params);
    return result.rows;
  }

  async searchHotels(query, limit = 20) {
    return this.searchPOIs(query, 'hotel', limit);
  }

  async searchRestaurants(query, limit = 20) {
    return this.searchPOIs(query, 'restaurant', limit);
  }

  // =========================================================================
  // Unified POI Search (supports name AND/OR location)
  // =========================================================================

  async unifiedSearchPOIs(options) {
    const {
      query,           // Optional: POI name to search for
      cityName,        // Optional: City name (use with countryCode)
      countryCode,     // Optional: Country code (only with cityName)
      latitude,        // Optional: Lat coordinate (use with longitude)
      longitude,       // Optional: Lon coordinate (use with latitude)
      radiusKm = 5,    // Radius in km for coordinate search
      poiType,         // Optional: Filter by POI type
      limit = 50,
    } = options;

    // Validate parameters
    if (latitude && !longitude) {
      throw new Error('longitude is required when latitude is provided');
    }
    if (longitude && !latitude) {
      throw new Error('latitude is required when longitude is provided');
    }
    if (countryCode && !cityName) {
      throw new Error('country_code can only be used with city_name, not with coordinates');
    }

    // Case 1: Name only (no location filter)
    if (query && !cityName && !latitude) {
      return this.searchPOIs(query, poiType, limit);
    }

    // Case 2: Coordinates only (no name filter)
    if (latitude && longitude && !query) {
      const pois = await this.getPOIsNearCoordinates(
        latitude,
        longitude,
        radiusKm,
        poiType,
        limit
      );
      return {
        latitude,
        longitude,
        radius_km: radiusKm,
        poi_type_filter: poiType || null,
        count: pois.length,
        pois,
      };
    }

    // Case 3: City name only (no name filter)
    if (cityName && !query) {
      return this.findPOIsInCity(cityName, countryCode, poiType, limit);
    }

    // Case 4: Name + Coordinates (combined search)
    if (query && latitude && longitude) {
      return this.searchPOIsWithNameAndCoordinates(
        query,
        latitude,
        longitude,
        radiusKm,
        poiType,
        limit
      );
    }

    // Case 5: Name + City (combined search)
    if (query && cityName) {
      return this.searchPOIsWithNameAndCity(
        query,
        cityName,
        countryCode,
        poiType,
        limit
      );
    }

    // No filters provided - return empty result
    return {
      message: 'Please provide at least a name (query) or location (city_name or coordinates)',
      pois: [],
      count: 0,
    };
  }

  // Helper: Search POIs by name within a coordinate radius
  async searchPOIsWithNameAndCoordinates(query, latitude, longitude, radiusKm, poiType, limit) {
    const radiusMeters = radiusKm * 1000;

    let queryText = `
      SELECT
        osm_id,
        osm_type,
        poi_type,
        name,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        address,
        cuisine,
        opening_hours,
        phone,
        website,
        stars,
        rooms,
        beds,
        similarity(name, $1) as similarity_score,
        ST_Distance(
          location::geography,
          ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
        ) as distance_meters
      FROM pois
      WHERE name % $1
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
          $4
        )
    `;

    const params = [query, latitude, longitude, radiusMeters];

    if (poiType) {
      queryText += ` AND poi_type = $${params.length + 1}`;
      params.push(poiType);
    }

    queryText += ` ORDER BY similarity_score DESC, distance_meters LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(queryText, params);

    return {
      query,
      latitude,
      longitude,
      radius_km: radiusKm,
      poi_type_filter: poiType || null,
      count: result.rows.length,
      pois: result.rows,
    };
  }

  // Helper: Search POIs by name within a city
  async searchPOIsWithNameAndCity(query, cityName, countryCode, poiType, limit) {
    // First, find the city
    let cityQuery = `
      SELECT
        geoname_id,
        name,
        country_code,
        population,
        ST_Y(location) as latitude,
        ST_X(location) as longitude
      FROM geonames_cities
      WHERE name ILIKE $1
    `;

    const cityParams = [cityName];

    if (countryCode) {
      cityQuery += ` AND country_code = $2`;
      cityParams.push(countryCode.toUpperCase());
    }

    cityQuery += ` ORDER BY population DESC NULLS LAST LIMIT 1`;

    const cityResult = await this.pool.query(cityQuery, cityParams);

    if (cityResult.rows.length === 0) {
      return {
        city: null,
        pois: [],
        count: 0,
        message: `City "${cityName}" not found`,
      };
    }

    const city = cityResult.rows[0];
    const radiusKm = this.getRadiusForPopulation(city.population || 100000);

    // Now search for POIs by name within that city's radius
    const result = await this.searchPOIsWithNameAndCoordinates(
      query,
      city.latitude,
      city.longitude,
      radiusKm,
      poiType,
      limit
    );

    return {
      city: {
        geoname_id: city.geoname_id,
        name: city.name,
        country_code: city.country_code,
        population: city.population,
        latitude: city.latitude,
        longitude: city.longitude,
      },
      radius_km: radiusKm,
      query,
      poi_type_filter: poiType || null,
      count: result.pois.length,
      pois: result.pois,
    };
  }

  async getPOIsNearCoordinates(latitude, longitude, radiusKm, poiType = null, limit = 50) {
    const radiusMeters = radiusKm * 1000;

    let query = `
      SELECT
        osm_id,
        osm_type,
        poi_type,
        name,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        address,
        cuisine,
        opening_hours,
        phone,
        website,
        ST_Distance(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) as distance_meters
      FROM pois
      WHERE ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
    `;

    const params = [latitude, longitude, radiusMeters];

    if (poiType) {
      query += ` AND poi_type = $4`;
      params.push(poiType);
      query += ` ORDER BY distance_meters LIMIT $5`;
      params.push(limit);
    } else {
      query += ` ORDER BY distance_meters LIMIT $4`;
      params.push(limit);
    }

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async findPOIsInCity(cityName, countryCode = null, poiType = null, limit = 50) {
    // First, find the city
    let cityQuery = `
      SELECT
        geoname_id,
        name,
        ascii_name,
        country_code,
        population,
        ST_Y(location) as latitude,
        ST_X(location) as longitude,
        timezone
      FROM geonames_cities
      WHERE name ILIKE $1
    `;

    const params = [cityName];

    if (countryCode) {
      cityQuery += ` AND country_code = $2`;
      params.push(countryCode);
    }

    cityQuery += ` ORDER BY population DESC NULLS LAST LIMIT 1`;

    const cityResult = await this.pool.query(cityQuery, params);

    if (cityResult.rows.length === 0) {
      return {
        city: null,
        pois: [],
        count: 0,
        message: `City "${cityName}" not found`,
      };
    }

    const city = cityResult.rows[0];
    const radiusKm = this.getRadiusForPopulation(city.population || 100000);

    const pois = await this.getPOIsNearCoordinates(
      city.latitude,
      city.longitude,
      radiusKm,
      poiType,
      limit
    );

    return {
      city: {
        geoname_id: city.geoname_id,
        name: city.name,
        country_code: city.country_code,
        population: city.population,
        latitude: city.latitude,
        longitude: city.longitude,
      },
      radius_km: radiusKm,
      poi_type_filter: poiType,
      pois: pois,
      count: pois.length,
    };
  }

  // =========================================================================
  // Import Tracking
  // =========================================================================

  async startImport(importType, options = {}) {
    const {
      sourceFile = null,
      sourceUrl = null,
      sourceDate = null,
      regionName = null,
      metadata = null,
    } = options;

    const result = await this.pool.query(`
      INSERT INTO imports (
        import_type, source_file, source_url, source_date, region_name, metadata, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'running')
      RETURNING id
    `, [importType, sourceFile, sourceUrl, sourceDate, regionName, metadata ? JSON.stringify(metadata) : null]);

    return result.rows[0].id;
  }

  async completeImport(importId, recordsImported) {
    await this.pool.query(`
      UPDATE imports
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          records_imported = $2
      WHERE id = $1
    `, [importId, recordsImported]);
  }

  async failImport(importId, errorMessage) {
    await this.pool.query(`
      UPDATE imports
      SET status = 'failed',
          completed_at = CURRENT_TIMESTAMP,
          error_message = $2
      WHERE id = $1
    `, [importId, errorMessage]);
  }

  async getImportHistory(limit = 20) {
    const result = await this.pool.query(`
      SELECT
        id,
        import_type,
        source_file,
        source_url,
        source_date,
        region_name,
        started_at,
        completed_at,
        status,
        records_imported,
        error_message,
        metadata
      FROM imports
      ORDER BY started_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  }

  async getLatestImportByType(importType, regionName = null) {
    let query = `
      SELECT
        id,
        import_type,
        source_file,
        source_date,
        region_name,
        completed_at,
        status,
        records_imported
      FROM imports
      WHERE import_type = $1
        AND status = 'completed'
    `;

    const params = [importType];

    if (regionName) {
      query += ` AND region_name = $2`;
      params.push(regionName);
    }

    query += ` ORDER BY completed_at DESC LIMIT 1`;

    const result = await this.pool.query(query, params);
    return result.rows[0] || null;
  }

  // =========================================================================
  // Statistics
  // =========================================================================

  async getStats() {
    const countries = await this.pool.query('SELECT COUNT(*) FROM geonames_countries');
    const cities = await this.pool.query('SELECT COUNT(*) FROM geonames_cities');
    const pois = await this.pool.query('SELECT COUNT(*) FROM pois');
    const hotels = await this.pool.query("SELECT COUNT(*) FROM pois WHERE poi_type = 'hotel'");
    const regions = await this.pool.query('SELECT COUNT(*) FROM regions');

    const poisByType = await this.pool.query(`
      SELECT poi_type, COUNT(*) as count
      FROM pois
      GROUP BY poi_type
      ORDER BY count DESC
    `);

    const poisByRegion = await this.pool.query(`
      SELECT source_region, COUNT(*) as count
      FROM pois
      GROUP BY source_region
      ORDER BY count DESC
    `);

    // Get recent successful imports
    const recentImports = await this.pool.query(`
      SELECT
        import_type,
        region_name,
        source_file,
        completed_at,
        records_imported
      FROM imports
      WHERE status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 10
    `);

    return {
      countries: parseInt(countries.rows[0].count),
      cities: parseInt(cities.rows[0].count),
      pois: parseInt(pois.rows[0].count),
      hotels: parseInt(hotels.rows[0].count),
      regions: parseInt(regions.rows[0].count),
      pois_by_type: poisByType.rows,
      pois_by_region: poisByRegion.rows,
      recent_imports: recentImports.rows,
    };
  }
}
