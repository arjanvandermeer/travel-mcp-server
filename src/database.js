import pg from 'pg';
import { GooglePlacesClient } from './google-places.js';
import dotenv from 'dotenv';

// Load environment variables (using dotenv 16.x to avoid verbose output that breaks MCP)
dotenv.config();

const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://traveluser:travelpass@localhost:5432/travel';

/**
 * Recursively removes null and undefined fields from objects and arrays
 * @param {*} obj - Object, array, or primitive value to clean
 * @returns {*} Cleaned object/array/value with null/undefined fields removed
 */
function removeNullFields(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeNullFields);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj)
      .filter(([_, v]) => v !== null && v !== undefined)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: removeNullFields(v) }), {});
  }
  return obj;
}

export class TravelDatabase {
  constructor() {
    this.pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    this.googlePlaces = null; // Initialize later with config
    this.googlePlacesReady = this.initGooglePlaces(); // Store promise
  }

  async close() {
    await this.pool.end();
  }

  /**
   * Test database connection - throws if connection fails
   */
  async testConnection() {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  async ensureGooglePlacesReady() {
    if (!this.googlePlaces) {
      await this.googlePlacesReady;
    }
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  async getConfig(key, defaultValue = null) {
    try {
      const result = await this.pool.query(
        'SELECT value FROM config WHERE key = $1',
        [key]
      );
      return result.rows.length > 0 ? result.rows[0].value : defaultValue;
    } catch (error) {
      // Silently fall back to default if config table doesn't exist
      // (config table is optional - using env vars is fine)
      if (!error.message.includes('relation "config" does not exist')) {
        console.error(`Error reading config ${key}:`, error.message);
      }
      return defaultValue;
    }
  }

  async setConfig(key, value, description = null) {
    await this.pool.query(`
      INSERT INTO config (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        description = COALESCE(EXCLUDED.description, config.description),
        updated_at = CURRENT_TIMESTAMP
    `, [key, value, description]);
  }

  async initGooglePlaces() {
    try {
      // Try to read from database first, fallback to environment variable
      const apiKey = await this.getConfig('google_places_api_key', process.env.GOOGLE_PLACES_API_KEY);

      // Update environment for GooglePlacesClient (if not already set)
      if (apiKey && !process.env.GOOGLE_PLACES_API_KEY) {
        process.env.GOOGLE_PLACES_API_KEY = apiKey;
      }

      this.googlePlaces = new GooglePlacesClient(apiKey);

      if (this.googlePlaces.isEnabled()) {
        console.error('✓ Google Places API initialized from database config');
      }
    } catch (error) {
      console.error('⚠️  Could not initialize Google Places from database, using environment variables');
      this.googlePlaces = new GooglePlacesClient();
    }
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
    return removeNullFields(result.rows);
  }

  async getCityByGeonameId(geonameId) {
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

    const city = result.rows[0] || null;
    return city ? removeNullFields(city) : null;
  }

  // =========================================================================
  // POI Search (uses enriched_pois view)
  // =========================================================================

  async searchPOIs(params) {
    const {
      cityName = null,
      countryCode = null,
      latitude = null,
      longitude = null,
      radius = null,
      poiType = null,
      poiTypes = null,  // New: array of types
      name = null,
      limit = 50
    } = params;

    let query;
    let queryParams = [];

    // Normalize POI type filter - support both single type and array of types
    const typeFilter = poiTypes || (poiType ? [poiType] : null);

    // Determine search strategy based on provided parameters
    const hasName = !!name;
    const hasCity = !!cityName;
    const hasCoords = !!(latitude && longitude);

    // Case 1: Name only (fuzzy match across all POIs)
    if (hasName && !hasCity && !hasCoords) {
      query = `
        SELECT
          osm_id,
          poi_type,
          COALESCE(google_name, osm_name) as name,
          osm_latitude as latitude,
          osm_longitude as longitude,
          city,
          country_code,
          google_rating,
          google_review_count,
          google_price_level,
          google_business_status,
          osm_stars,
          osm_brand,
          GREATEST(
            similarity(COALESCE(google_name, osm_name), $1),
            COALESCE(similarity(osm_brand, $1), 0)
          ) as name_similarity
        FROM enriched_pois
        WHERE osm_name IS NOT NULL
          AND (osm_name ILIKE $2 OR google_name ILIKE $2 OR osm_brand ILIKE $2)
      `;
      queryParams = [name, `%${name}%`];

      if (typeFilter) {
        query += ` AND poi_type = ANY($${queryParams.length + 1})`;
        queryParams.push(typeFilter);
      }

      query += ` ORDER BY name_similarity DESC, google_rating DESC NULLS LAST LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    // Case 2: Location only (city or coordinates)
    else if (!hasName && (hasCity || hasCoords)) {
      if (hasCity) {
        const city = await this.getCityByName(cityName, countryCode);
        if (!city) {
          return [];
        }

        const searchRadius = radius || this.getRadiusForPopulation(city.population || 100000);
        return this.searchPOIsNearCoordinates(
          city.latitude,
          city.longitude,
          searchRadius,
          typeFilter,
          limit
        );
      } else {
        const searchRadius = radius || 10; // Default 10km
        return this.searchPOIsNearCoordinates(
          latitude,
          longitude,
          searchRadius,
          typeFilter,
          limit
        );
      }
    }
    // Case 3: Name + Location (combined search - filter by name AND location)
    else if (hasName && (hasCity || hasCoords)) {
      // First resolve city to coordinates if needed
      let searchLat = latitude;
      let searchLon = longitude;
      let searchRadius = radius;

      if (hasCity) {
        const city = await this.getCityByName(cityName, countryCode);
        if (!city) {
          return [];
        }
        searchLat = city.latitude;
        searchLon = city.longitude;
        searchRadius = searchRadius || this.getRadiusForPopulation(city.population || 100000);
      } else {
        searchRadius = searchRadius || 10; // Default 10km for coordinates
      }

      // Combined query: name filter + distance filter
      query = `
        SELECT
          osm_id,
          poi_type,
          COALESCE(google_name, osm_name) as name,
          osm_latitude as latitude,
          osm_longitude as longitude,
          city,
          country_code,
          google_rating,
          google_review_count,
          google_price_level,
          google_business_status,
          osm_stars,
          osm_brand,
          GREATEST(
            similarity(COALESCE(google_name, osm_name), $1),
            COALESCE(similarity(osm_brand, $1), 0)
          ) as name_similarity,
          ST_Distance(
            osm_location::geography,
            ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
          ) / 1000.0 as distance_km
        FROM enriched_pois
        WHERE osm_name IS NOT NULL
          AND (osm_name ILIKE $4 OR google_name ILIKE $4 OR osm_brand ILIKE $4)
          AND ST_DWithin(
            osm_location::geography,
            ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
            $5 * 1000
          )
      `;
      queryParams = [name, searchLat, searchLon, `%${name}%`, searchRadius];

      if (typeFilter) {
        query += ` AND poi_type = ANY($${queryParams.length + 1})`;
        queryParams.push(typeFilter);
      }

      query += ` ORDER BY name_similarity DESC, distance_km ASC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    else {
      throw new Error('Must provide either name, cityName, or coordinates (latitude + longitude)');
    }

    const result = await this.pool.query(query, queryParams);
    return removeNullFields(result.rows);
  }

  async searchPOIsNearCoordinates(latitude, longitude, radiusKm, typeFilter = null, limit = 50) {
    let query = `
      SELECT
        osm_id,
        poi_type,
        COALESCE(google_name, osm_name) as name,
        osm_latitude as latitude,
        osm_longitude as longitude,
        city,
        country_code,
        google_rating,
        google_review_count,
        google_price_level,
        google_business_status,
        osm_stars,
        ST_Distance(
          osm_location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) / 1000.0 as distance_km
      FROM enriched_pois
      WHERE osm_name IS NOT NULL
        AND ST_DWithin(
          osm_location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3 * 1000
        )
    `;

    const params = [latitude, longitude, radiusKm];

    if (typeFilter) {
      query += ` AND poi_type = ANY($${params.length + 1})`;
      params.push(typeFilter);
    }

    query += ` ORDER BY distance_km ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(query, params);
    return removeNullFields(result.rows);
  }

  async getCityByName(name, countryCode = null) {
    const cities = await this.searchCities(name, countryCode, 1);
    return cities[0] || null;
  }

  getRadiusForPopulation(population) {
    if (population > 5000000) return 30;
    if (population > 1000000) return 20;
    if (population > 500000) return 15;
    if (population > 100000) return 10;
    return 5;
  }

  // =========================================================================
  // POI Details
  // =========================================================================

  async getPOIDetails(osmId) {
    const result = await this.pool.query(`
      SELECT *
      FROM enriched_pois
      WHERE osm_id = $1
    `, [osmId]);

    const poi = result.rows[0] || null;
    if (!poi) return null;

    // Determine enrichment status and add helpful metadata
    let enrichment_status = 'complete';
    let enrichment_message = null;

    // Check mapping status to determine if enrichment is needed
    if (poi.mapping_status === 'active' && poi.google_place_id) {
      // Already enriched - complete
      enrichment_status = 'complete';
    } else if (poi.mapping_status === 'pending') {
      // Enrichment already in progress
      enrichment_status = 'pending';
      const startedAt = poi.mapped_at ? new Date(poi.mapped_at) : new Date();
      const checkBackAt = new Date(startedAt.getTime() + 60000);
      enrichment_message = `Google Places enrichment already in progress (started at ${startedAt.toISOString()}). Check back after ${checkBackAt.toISOString()} for complete information.`;
    } else if (poi.mapping_status === 'not_found') {
      enrichment_status = 'failed';
      enrichment_message = 'Google Places enrichment attempted but no matching location was found. Only OpenStreetMap data is available.';
    } else if (poi.mapping_status === 'error') {
      enrichment_status = 'failed';
      enrichment_message = 'Google Places enrichment failed due to an error. Only OpenStreetMap data is available.';
    } else if (!poi.mapping_status) {
      // No enrichment attempt yet - trigger it
      await this.ensureGooglePlacesReady();
      if (this.googlePlaces && this.googlePlaces.isEnabled()) {
        // Mark as pending IMMEDIATELY before starting enrichment
        await this.pool.query(`
          INSERT INTO osm_google_mappings (osm_id, mapping_status, mapped_at)
          VALUES ($1, 'pending', CURRENT_TIMESTAMP)
          ON CONFLICT (osm_id) DO UPDATE SET mapping_status = 'pending', mapped_at = CURRENT_TIMESTAMP
        `, [osmId]);

        const startedAt = new Date();
        const checkBackAt = new Date(startedAt.getTime() + 60000); // 1 minute from now

        enrichment_status = 'pending';
        enrichment_message = `Google Places enrichment started at ${startedAt.toISOString()}. Check back after ${checkBackAt.toISOString()} (approximately 1 minute) for complete information including ratings, reviews, photos, and verified opening hours.`;

        // Fire-and-forget background enrichment with 2-minute timeout
        Promise.race([
          this.enrichOSMPOI(osmId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Enrichment timeout after 2 minutes')), 120000))
        ]).catch(err => {
          console.error(`Background enrichment failed for POI ${osmId}:`, err.message);
          // Mark as error if enrichment fails
          this.pool.query(`
            UPDATE osm_google_mappings
            SET mapping_status = 'error', mapping_notes = $1
            WHERE osm_id = $2
          `, [err.message, osmId]).catch(() => {});
        });
      } else {
        enrichment_status = 'disabled';
        enrichment_message = 'Google Places enrichment is not enabled. Only OpenStreetMap data is available.';
      }
    }

    // Add enrichment metadata to the response
    const response = {
      ...poi,
      _enrichment: {
        status: enrichment_status,
        message: enrichment_message,
      }
    };

    // Remove null/undefined fields from the response
    return removeNullFields(response);
  }

  // =========================================================================
  // Google Places Enrichment
  // =========================================================================

  /**
   * Enrich an OSM POI with Google Places data
   * Creates/updates google_places entry and creates mapping
   */
  async enrichOSMPOI(osmId) {
    await this.ensureGooglePlacesReady();

    if (!this.googlePlaces || !this.googlePlaces.isEnabled()) {
      return;
    }

    try {
      // Get OSM POI data
      const osmResult = await this.pool.query(`
        SELECT
          osm_id,
          poi_type,
          name,
          latitude,
          longitude
        FROM osm_pois
        WHERE osm_id = $1
      `, [osmId]);

      if (osmResult.rows.length === 0) {
        return;
      }

      const osmPOI = osmResult.rows[0];

      // Check if already mapped
      const existingMapping = await this.pool.query(`
        SELECT
          google_place_id,
          mapping_status,
          mapped_at
        FROM osm_google_mappings
        WHERE osm_id = $1
      `, [osmId]);

      // Skip if already mapped and active
      if (existingMapping.rows.length > 0) {
        const mapping = existingMapping.rows[0];
        if (mapping.mapping_status === 'active') {
          // Check if cache expired
          const cacheHours = parseInt(await this.getConfig('google_places_cache_hours', '168'));
          const hoursSinceMapping = (Date.now() - new Date(mapping.mapped_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceMapping < cacheHours) {
            return; // Still cached
          }
        }
        // If 'not_found', retry after 7 days
        if (mapping.mapping_status === 'not_found') {
          const daysSinceCheck = (Date.now() - new Date(mapping.mapped_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceCheck < 7) {
            return; // Don't retry yet
          }
        }
      }

      // Find matching Google Place
      const matchResult = await this.googlePlaces.findMatchingPlace(osmPOI);

      if (!matchResult) {
        // Mark as not_found
        await this.createMapping(osmId, null, {
          mapping_status: 'not_found',
          mapping_notes: 'No matching Google Place found'
        });
        return;
      }

      // Get full place details
      const placeDetails = await this.googlePlaces.getPlaceDetails(matchResult.place_id);

      if (!placeDetails) {
        await this.createMapping(osmId, matchResult.place_id, {
          mapping_status: 'error',
          mapping_notes: 'Failed to retrieve place details'
        });
        return;
      }

      // Upsert Google Place data
      await this.upsertGooglePlace(placeDetails);

      // Create/update mapping
      const distanceMeters = this.calculateDistance(
        osmPOI.latitude,
        osmPOI.longitude,
        placeDetails.location.latitude,
        placeDetails.location.longitude
      );

      await this.createMapping(osmId, placeDetails.id, {
        match_confidence: matchResult.rating ? 0.95 : 0.80, // Higher if has rating
        match_method: 'nearby_search',
        match_distance_meters: Math.round(distanceMeters),
        mapping_status: 'active'
      });

      console.error(`✓ Enriched OSM POI ${osmId} with Google Place ${placeDetails.id}`);

    } catch (error) {
      console.error(`Error enriching OSM POI ${osmId}:`, error.message);
      await this.createMapping(osmId, null, {
        mapping_status: 'error',
        mapping_notes: error.message
      });
    }
  }

  /**
   * Insert or update Google Place data
   */
  async upsertGooglePlace(placeData) {
    const cacheHours = parseInt(await this.getConfig('google_places_cache_hours', '168'));
    const cacheExpiresAt = new Date(Date.now() + cacheHours * 60 * 60 * 1000);

    // Extract and format reviews (up to 5)
    const reviews = placeData.reviews ? placeData.reviews.slice(0, 5).map(r => ({
      author: r.authorAttribution?.displayName,
      authorUri: r.authorAttribution?.uri,
      rating: r.rating,
      text: r.text?.text || r.originalText?.text,
      language: r.text?.languageCode || r.originalText?.languageCode,
      publishTime: r.publishTime,
      relativeTime: r.relativePublishTimeDescription,
    })) : null;

    await this.pool.query(`
      INSERT INTO google_places (
        google_place_id,
        name,
        display_name,
        location,
        latitude,
        longitude,
        types,
        primary_type,
        primary_type_display,
        formatted_address,
        short_formatted_address,
        international_phone,
        national_phone,
        website_uri,
        google_maps_uri,
        rating,
        user_rating_count,
        reviews,
        price_level,
        business_status,
        utc_offset_minutes,
        editorial_summary,
        opening_hours,
        current_opening_hours,
        photos,
        service_options,
        accessibility,
        amenities,
        plus_code,
        viewport,
        address_components,
        enriched_at,
        cache_expires_at,
        raw_response
      ) VALUES (
        $1, $2, $3,
        ST_SetSRID(ST_MakePoint($5, $4), 4326),
        $4, $5,
        $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
        $28, $29, $30,
        $31, $32, $33
      )
      ON CONFLICT (google_place_id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        location = EXCLUDED.location,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        types = EXCLUDED.types,
        primary_type = EXCLUDED.primary_type,
        primary_type_display = EXCLUDED.primary_type_display,
        formatted_address = EXCLUDED.formatted_address,
        short_formatted_address = EXCLUDED.short_formatted_address,
        international_phone = EXCLUDED.international_phone,
        national_phone = EXCLUDED.national_phone,
        website_uri = EXCLUDED.website_uri,
        google_maps_uri = EXCLUDED.google_maps_uri,
        rating = EXCLUDED.rating,
        user_rating_count = EXCLUDED.user_rating_count,
        reviews = EXCLUDED.reviews,
        price_level = EXCLUDED.price_level,
        business_status = EXCLUDED.business_status,
        utc_offset_minutes = EXCLUDED.utc_offset_minutes,
        editorial_summary = EXCLUDED.editorial_summary,
        opening_hours = EXCLUDED.opening_hours,
        current_opening_hours = EXCLUDED.current_opening_hours,
        photos = EXCLUDED.photos,
        service_options = EXCLUDED.service_options,
        accessibility = EXCLUDED.accessibility,
        amenities = EXCLUDED.amenities,
        plus_code = EXCLUDED.plus_code,
        viewport = EXCLUDED.viewport,
        address_components = EXCLUDED.address_components,
        enriched_at = EXCLUDED.enriched_at,
        cache_expires_at = EXCLUDED.cache_expires_at,
        raw_response = EXCLUDED.raw_response
    `, [
      placeData.id,
      placeData.displayName?.text || placeData.displayName || '',
      JSON.stringify(placeData.displayName),
      placeData.location?.latitude || null,
      placeData.location?.longitude || null,
      placeData.types || [],
      placeData.primaryType || null,
      placeData.primaryTypeDisplayName?.text || null,
      placeData.formattedAddress || null,
      placeData.shortFormattedAddress || null,
      placeData.internationalPhoneNumber || null,
      placeData.nationalPhoneNumber || null,
      placeData.websiteUri || null,
      placeData.googleMapsUri || null,
      placeData.rating || null,
      placeData.userRatingCount || null,
      JSON.stringify(reviews),
      placeData.priceLevel || null,
      placeData.businessStatus || null,
      placeData.utcOffsetMinutes || null,
      placeData.editorialSummary?.text || null,
      JSON.stringify(placeData.regularOpeningHours || null),
      JSON.stringify(placeData.currentOpeningHours || null),
      JSON.stringify((placeData.photos || []).slice(0, 10).map(p => ({
        name: p.name,
        widthPx: p.widthPx,
        heightPx: p.heightPx
      }))),
      JSON.stringify({
        delivery: placeData.delivery,
        dineIn: placeData.dineIn,
        takeout: placeData.takeout,
        curbsidePickup: placeData.curbsidePickup,
        reservable: placeData.reservable
      }),
      JSON.stringify(placeData.accessibilityOptions || null),
      JSON.stringify({
        outdoorSeating: placeData.outdoorSeating,
        liveMusic: placeData.liveMusic,
        menuForChildren: placeData.menuForChildren,
        servesBeer: placeData.servesBeer,
        servesWine: placeData.servesWine,
        servesCocktails: placeData.servesCocktails,
        servesBreakfast: placeData.servesBreakfast,
        servesBrunch: placeData.servesBrunch,
        servesLunch: placeData.servesLunch,
        servesDinner: placeData.servesDinner,
        servesCoffee: placeData.servesCoffee,
        servesDessert: placeData.servesDessert,
        servesVegetarianFood: placeData.servesVegetarianFood,
        goodForChildren: placeData.goodForChildren,
        goodForGroups: placeData.goodForGroups,
        goodForWatchingSports: placeData.goodForWatchingSports,
        allowsDogs: placeData.allowsDogs,
        restroom: placeData.restroom,
        parkingOptions: placeData.parkingOptions,
        paymentOptions: placeData.paymentOptions
      }),
      JSON.stringify(placeData.plusCode || null),
      JSON.stringify(placeData.viewport || null),
      JSON.stringify(placeData.addressComponents || null),
      new Date(),
      cacheExpiresAt,
      JSON.stringify(placeData)
    ]);
  }

  /**
   * Create or update mapping between OSM POI and Google Place
   */
  async createMapping(osmId, googlePlaceId, metadata = {}) {
    const {
      match_confidence = null,
      match_method = null,
      match_distance_meters = null,
      mapping_status = 'active',
      mapping_notes = null
    } = metadata;

    if (!googlePlaceId) {
      // Only insert if not_found or error status
      if (mapping_status === 'not_found' || mapping_status === 'error') {
        await this.pool.query(`
          INSERT INTO osm_google_mappings (
            osm_id,
            google_place_id,
            mapping_status,
            mapping_notes,
            mapped_at
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (osm_id) DO UPDATE SET
            mapping_status = EXCLUDED.mapping_status,
            mapping_notes = EXCLUDED.mapping_notes,
            mapped_at = CURRENT_TIMESTAMP
        `, [osmId, 'not_found_placeholder', mapping_status, mapping_notes]);
      }
      return;
    }

    await this.pool.query(`
      INSERT INTO osm_google_mappings (
        osm_id,
        google_place_id,
        match_confidence,
        match_method,
        match_distance_meters,
        mapping_status,
        mapping_notes,
        mapped_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (osm_id) DO UPDATE SET
        google_place_id = EXCLUDED.google_place_id,
        match_confidence = EXCLUDED.match_confidence,
        match_method = EXCLUDED.match_method,
        match_distance_meters = EXCLUDED.match_distance_meters,
        mapping_status = EXCLUDED.mapping_status,
        mapping_notes = EXCLUDED.mapping_notes,
        mapped_at = CURRENT_TIMESTAMP
    `, [
      osmId,
      googlePlaceId,
      match_confidence,
      match_method,
      match_distance_meters,
      mapping_status,
      mapping_notes
    ]);
  }

  /**
   * Calculate distance between two coordinates in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Batch enrich top POIs from search results
   */
  async batchEnrichPOIs(osmIds, maxConcurrent = 3) {
    if (!Array.isArray(osmIds) || osmIds.length === 0) {
      return;
    }

    // Limit to top results to control API costs
    const idsToEnrich = osmIds.slice(0, 10);

    // Enrich in background (fire-and-forget)
    for (let i = 0; i < idsToEnrich.length; i += maxConcurrent) {
      const batch = idsToEnrich.slice(i, i + maxConcurrent);
      Promise.all(batch.map(osmId => this.enrichOSMPOI(osmId).catch(err => {
        console.error(`Background enrichment error for OSM ${osmId}:`, err.message);
      })));
    }
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
      sourceType = 'osm'
    } = options;

    const result = await this.pool.query(`
      INSERT INTO imports (
        import_type,
        source_file,
        source_url,
        source_date,
        region_name,
        metadata,
        source_type,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
      RETURNING id
    `, [
      importType,
      sourceFile,
      sourceUrl,
      sourceDate,
      regionName,
      metadata ? JSON.stringify(metadata) : null,
      sourceType
    ]);

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
        source_type,
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

  // =========================================================================
  // Statistics
  // =========================================================================

  async getStats() {
    const countries = await this.pool.query('SELECT COUNT(*) FROM geonames_countries');
    const cities = await this.pool.query('SELECT COUNT(*) FROM geonames_cities');
    const pois = await this.pool.query('SELECT COUNT(*) FROM osm_pois');
    const hotels = await this.pool.query("SELECT COUNT(*) FROM osm_pois WHERE poi_type = 'hotel'");
    const regions = await this.pool.query('SELECT COUNT(*) FROM regions');

    const poisByType = await this.pool.query(`
      SELECT poi_type, COUNT(*) as count
      FROM osm_pois
      GROUP BY poi_type
      ORDER BY count DESC
    `);

    const poisByCountry = await this.pool.query(`
      SELECT country_code, COUNT(*) as count
      FROM enriched_pois
      WHERE country_code IS NOT NULL
      GROUP BY country_code
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

    // Get enrichment stats from POIs table
    const enrichmentStats = await this.pool.query(`
      SELECT COUNT(*) as total_enriched
      FROM osm_pois
      WHERE google_place_id IS NOT NULL
    `);

    const mappingStats = await this.pool.query(`
      SELECT google_enrichment_status as mapping_status, COUNT(*) as count
      FROM osm_pois
      WHERE google_enrichment_status IS NOT NULL
      GROUP BY google_enrichment_status
    `);

    const stats = {
      countries: parseInt(countries.rows[0].count),
      cities: parseInt(cities.rows[0].count),
      pois: parseInt(pois.rows[0].count),
      hotels: parseInt(hotels.rows[0].count),
      regions: parseInt(regions.rows[0].count),
      pois_by_type: poisByType.rows,
      pois_by_country: poisByCountry.rows,
      recent_imports: recentImports.rows,
      google_places_enriched: parseInt(enrichmentStats.rows[0].total_enriched),
      enrichment_by_status: mappingStats.rows,
    };

    return removeNullFields(stats);
  }
}

export default TravelDatabase;
