/**
 * Google Places API Client (New)
 *
 * Provides methods to search and enrich POI data using Google Places API (New)
 * Documentation: https://developers.google.com/maps/documentation/places/web-service/op-overview
 */

import https from 'https';
import dotenv from 'dotenv';
import * as telemetry from './telemetry.js';
import { GOOGLE_PLACES_TEXT_SEARCH_RADIUS, GOOGLE_PLACES_NEARBY_SEARCH_RADIUS, GOOGLE_PLACES_MATCH_SEARCH_RADIUS, GOOGLE_PLACES_MAX_RESULTS } from './config.js';
import {
  calculateNameSimilarity,
  findBestNameMatch,
  findBestNameMatchMulti,
  getOSMNameVariants,
  isPlaceDetailsNameCompatible,
  isTypeCompatible,
  levenshteinDistance,
  radiusToBBox,
} from './google-places-matching.js';

dotenv.config();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function recordGooglePlacesApiCall(endpoint, method, fieldMask = null) {
  const tags = {
    provider: 'google_places',
    source: 'enrichment',
    endpoint,
    method,
  };
  telemetry.incrementCounter('google_places.api_calls', 1, { endpoint, method });
  telemetry.captureMetricEvent('google_places.api_calls', 1, tags, { fieldMask });
}

function recordGooglePlacesApiError(endpoint, tags = {}) {
  const eventTags = {
    provider: 'google_places',
    source: 'enrichment',
    endpoint,
    ...tags,
  };
  telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, ...tags });
  telemetry.captureMetricEvent('google_places.api_errors', 1, eventTags);
}

function googlePlacesSpanAttributes(endpoint, method, fieldMask = null) {
  return {
    provider: 'google_places',
    source: 'enrichment',
    endpoint,
    method,
    'http.request.method': method,
    'server.address': 'places.googleapis.com',
    'url.scheme': 'https',
    field_mask: fieldMask,
  };
}

export class GooglePlacesClient {
  /**
   * @param {string} apiKey - Google Places API key
   * @param {boolean} enabled - Whether Google Places is enabled (from database config)
   */
  constructor(apiKey = GOOGLE_PLACES_API_KEY, enabled = true) {
    this.apiKey = apiKey;

    // Enabled if API key is present AND enabled flag is true
    this.enabled = !!apiKey && enabled;

    if (!this.enabled) {
      if (!enabled) {
        console.error('⚠️  Google Places API is disabled via google_places_enabled config');
      } else {
        console.error('⚠️  Google Places API key not configured');
      }
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /**
   * Make a POST request to Google Places API (New)
   */
  async makeRequest(url, body, fieldMask) {
    if (!this.enabled) {
      throw new Error('Google Places API is not enabled');
    }

    // Extract endpoint type from URL for metrics
    const endpoint = url.includes('searchNearby') ? 'nearby_search' :
                     url.includes('searchText') ? 'text_search' : 'post_request';

    const postData = JSON.stringify(body);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
    };

    return telemetry.withSpan(
      `Google Places ${endpoint}`,
      'http.client',
      googlePlacesSpanAttributes(endpoint, 'POST', fieldMask),
      async (span) => telemetry.timeAsync('google_places.api_latency', async () => {
        recordGooglePlacesApiCall(endpoint, 'POST', fieldMask);

        return new Promise((resolve, reject) => {
          const req = https.request(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
              data += chunk;
            });

            res.on('end', () => {
              try {
                const result = JSON.parse(data);

                // Check for error in response
                if (result.error) {
                  recordGooglePlacesApiError(endpoint, { error_status: result.error.status });
                  reject(new Error(`Google Places API error: ${result.error.status} - ${result.error.message || ''}`));
                  return;
                }

                resolve(result);
              } catch (error) {
                recordGooglePlacesApiError(endpoint, { error_type: 'parse_error' });
                reject(new Error(`Failed to parse Google Places API response: ${error.message}`));
              }
            });
          });

          req.on('error', (error) => {
            recordGooglePlacesApiError(endpoint, { error_type: 'request_error' });
            reject(new Error(`Google Places API request failed: ${error.message}`));
          });

          req.write(postData);
          req.end();
        });
      }, {
        tags: { endpoint },
        onSuccess: (_result, duration) => telemetry.setSpanAttributes(span, { duration_ms: duration }),
        onError: (_error, duration) => telemetry.setSpanAttributes(span, { duration_ms: duration }),
      }),
    );
  }

  /**
   * Make a GET request to Google Places API (New) - for Place Details
   */
  async makeGetRequest(url, fieldMask) {
    if (!this.enabled) {
      throw new Error('Google Places API is not enabled');
    }

    const endpoint = 'place_details';

    const headers = { 'X-Goog-Api-Key': this.apiKey };
    if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;

    const options = {
      method: 'GET',
      headers,
    };

    return telemetry.withSpan(
      `Google Places ${endpoint}`,
      'http.client',
      googlePlacesSpanAttributes(endpoint, 'GET', fieldMask),
      async (span) => telemetry.timeAsync('google_places.api_latency', async () => {
        recordGooglePlacesApiCall(endpoint, 'GET', fieldMask);

        return new Promise((resolve, reject) => {
          const req = https.request(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
              data += chunk;
            });

            res.on('end', () => {
              try {
                if (!data) {
                  recordGooglePlacesApiError(endpoint, { error_type: 'empty_response' });
                  reject(new Error('Empty response from Google Places API'));
                  return;
                }

                const result = JSON.parse(data);

                // Check for error in response
                if (result.error) {
                  recordGooglePlacesApiError(endpoint, { error_status: result.error.status });
                  reject(new Error(`Google Places API error: ${result.error.status} - ${result.error.message || ''}`));
                  return;
                }

                resolve(result);
              } catch (error) {
                recordGooglePlacesApiError(endpoint, { error_type: 'parse_error' });
                reject(new Error(`Failed to parse Google Places API response: ${error.message}`));
              }
            });
          });

          req.on('error', (error) => {
            recordGooglePlacesApiError(endpoint, { error_type: 'request_error' });
            reject(new Error(`Google Places API request failed: ${error.message}`));
          });

          req.end();
        });
      }, {
        tags: { endpoint },
        onSuccess: (_result, duration) => telemetry.setSpanAttributes(span, { duration_ms: duration }),
        onError: (_error, duration) => telemetry.setSpanAttributes(span, { duration_ms: duration }),
      }),
    );
  }

  /**
   * Search for places near coordinates using Google Places Nearby Search API.
   * @param {number} latitude - Center latitude
   * @param {number} longitude - Center longitude
   * @param {string} name - Place name (unused in request body, kept for interface consistency)
   * @param {string|null} type - Google Place type filter (e.g. 'lodging', 'restaurant')
   * @param {number} radius - Search radius in meters
   * @returns {Promise<Array<Object>>} Array of Google Place objects with id, displayName, rating, location, types
   */
  async searchNearby(latitude, longitude, name, type = null, radius = GOOGLE_PLACES_NEARBY_SEARCH_RADIUS) {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';

    const body = {
      includedTypes: type ? [type] : ['lodging', 'restaurant', 'cafe', 'tourist_attraction'],
      maxResultCount: GOOGLE_PLACES_MAX_RESULTS,
      locationRestriction: {
        circle: {
          center: {
            latitude: latitude,
            longitude: longitude,
          },
          radius: radius,
        },
      },
    };

    const fieldMask = 'places.id,places.displayName,places.rating,places.userRatingCount,places.types,places.location';

    try {
      const result = await this.makeRequest(url, body, fieldMask);
      return result.places || [];
    } catch (error) {
      console.error('Google Places Nearby Search error:', error.message);
      telemetry.captureException(error, { context: 'google_places_nearby_search' });
      return [];
    }
  }

  /**
   * Search for places by text query using Google Places Text Search API.
   * @param {string} query - Free-text search query
   * @param {number|null} latitude - Optional latitude for location bias
   * @param {number|null} longitude - Optional longitude for location bias
   * @returns {Promise<Array<Object>>} Array of Google Place objects with id, displayName, rating, location, types
   */
  async searchText(query, latitude = null, longitude = null, includedType = null) {
    const url = 'https://places.googleapis.com/v1/places:searchText';

    const body = {
      textQuery: query,
      maxResultCount: GOOGLE_PLACES_MAX_RESULTS,
    };

    if (includedType) {
      body.includedType = includedType;
    }

    if (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined) {
      // Text Search only accepts rectangle for locationRestriction (not circle).
      // Convert radius to a bounding box so we get a hard geographic filter.
      body.locationRestriction = {
        rectangle: this._radiusToBBox(latitude, longitude, GOOGLE_PLACES_TEXT_SEARCH_RADIUS),
      };
    }

    const fieldMask = 'places.id,places.displayName,places.rating,places.userRatingCount,places.types,places.location';

    try {
      const result = await this.makeRequest(url, body, fieldMask);
      return result.places || [];
    } catch (error) {
      console.error('Google Places Text Search error:', error.message);
      telemetry.captureException(error, { context: 'google_places_text_search' });
      return [];
    }
  }

  /**
   * Get detailed information about a place
   * Uses Place Details API (New)
   * Requests all available fields for comprehensive data
   */
  async getPlaceDetails(placeId) {
    // Ensure place ID has the "places/" prefix
    const formattedPlaceId = placeId.startsWith('places/') ? placeId : `places/${placeId}`;
    const url = `https://places.googleapis.com/v1/${formattedPlaceId}`;

    // Request ALL available fields for comprehensive enrichment
    // Organized by SKU tier (costs vary by field):
    // - Essentials: location, address fields, types
    // - Pro: business status, display name, contact info, hours
    // - Enterprise: reviews, amenities, services, summaries
    const fieldMask = [
      // Basic identification
      'id',
      'displayName',
      'primaryType',
      'primaryTypeDisplayName',
      'types',
      // Location & Address
      'location',
      'formattedAddress',
      'shortFormattedAddress',
      'addressComponents',
      'plusCode',
      'viewport',
      // Contact
      'nationalPhoneNumber',
      'internationalPhoneNumber',
      'websiteUri',
      'googleMapsUri',
      // Business info
      'businessStatus',
      'priceLevel',
      'utcOffsetMinutes',
      // Hours
      'regularOpeningHours',
      'currentOpeningHours',
      // Ratings & Reviews
      'rating',
      'userRatingCount',
      'reviews',
      // Photos
      'photos',
      // Service options
      'dineIn',
      'takeout',
      'delivery',
      'curbsidePickup',
      'reservable',
      // Atmosphere & amenities
      'outdoorSeating',
      'liveMusic',
      'menuForChildren',
      'servesBeer',
      'servesWine',
      'servesCocktails',
      'servesBreakfast',
      'servesBrunch',
      'servesLunch',
      'servesDinner',
      'servesCoffee',
      'servesDessert',
      'servesVegetarianFood',
      'goodForChildren',
      'goodForGroups',
      'goodForWatchingSports',
      'allowsDogs',
      'restroom',
      // Facilities
      'parkingOptions',
      'paymentOptions',
      'accessibilityOptions',
      // Summaries
      'editorialSummary',
    ].join(',');

    try {
      const result = await this.makeGetRequest(url, fieldMask);
      return result || null;
    } catch (error) {
      console.error('Google Places Details error:', error.message);
      telemetry.captureException(error, { context: 'google_places_details' });
      return null;
    }
  }

  /**
   * Find the best matching Google Place for an OSM POI using nearby and text search with name similarity scoring.
   * @param {Object} poi - POI object to match
   * @param {string} poi.name - POI name
   * @param {string|null} poi.name_en - English transliteration of the name
   * @param {number} poi.latitude - POI latitude
   * @param {number} poi.longitude - POI longitude
   * @param {string} poi.poi_type - OSM POI type (e.g. 'hotel', 'restaurant')
   * @returns {Promise<{place_id: string, name: string, rating: number, user_ratings_total: number, types: string[]}|null>} Matched place info or null
   */
  async findMatchingPlace(poi) {
    if (!this.enabled) {
      return null;
    }

    const { name, name_en, latitude, longitude, poi_type } = poi;

    if (!name || latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      return null;
    }

    // For matching, try both original name and English transliteration
    const matchNames = [name];
    if (name_en && name_en !== name) {
      matchNames.push(name_en);
    }

    // Map POI types to Google Place types (New API format)
    const googleTypeMap = {
      hotel: 'lodging',
      hostel: 'lodging',
      guest_house: 'lodging',
      motel: 'lodging',
      restaurant: 'restaurant',
      cafe: 'cafe',
      bar: 'bar',
      pub: 'bar',
      fast_food: 'restaurant',
      museum: 'museum',
      attraction: 'tourist_attraction',
      monument: 'tourist_attraction',
      viewpoint: 'tourist_attraction',
    };

    const googleType = googleTypeMap[poi_type];

    // Try nearby search first (most accurate for coordinates)
    const nearbyResults = await this.searchNearby(latitude, longitude, name, googleType, GOOGLE_PLACES_MATCH_SEARCH_RADIUS);

    if (nearbyResults.length > 0) {
      // Find best match based on name similarity (try all name variants)
      const bestMatch = this.findBestNameMatchMulti(matchNames, nearbyResults);
      if (bestMatch && this.isTypeCompatible(poi_type, bestMatch.types)) {
        return {
          place_id: bestMatch.id,
          name: bestMatch.displayName?.text || bestMatch.displayName,
          rating: bestMatch.rating,
          user_ratings_total: bestMatch.userRatingCount,
          types: bestMatch.types,
        };
      }
    }

    // Fallback to text search.
    // Enrich the query with OSM address tags when available — "Travelodge 121 Peckham Street"
    // is far more precise than just "Travelodge". Location filtering is handled by
    // locationRestriction in the request body, not by embedding coords in the query.
    const baseName = name_en || name;
    const addrNum    = poi.tags?.['addr:housenumber'];
    const addrStreet = poi.tags?.['addr:street'];
    const addrParts  = [baseName, addrNum, addrStreet].filter(Boolean);
    const searchName = addrParts.length > 1 ? addrParts.join(' ') : baseName;
    const textResults = await this.searchText(searchName, latitude, longitude, googleType);

    if (textResults.length > 0) {
      // Also validate text search results with name matching
      const textMatch = this.findBestNameMatchMulti(matchNames, textResults);
      if (textMatch && this.isTypeCompatible(poi_type, textMatch.types)) {
        return {
          place_id: textMatch.id,
          name: textMatch.displayName?.text || textMatch.displayName,
          rating: textMatch.rating,
          user_ratings_total: textMatch.userRatingCount,
          types: textMatch.types,
        };
      }
    }

    // No confident match found
    if (process.env.DEBUG_MATCHING) {
      console.error(`  No Google Places match found for: "${name}"`);
    }
    return null;
  }

  /**
   * Check if a Google Place's types are compatible with the OSM POI type.
   * Returns true if types are compatible or if no compatibility rule exists for the POI type.
   */
  isTypeCompatible(poiType, googleTypes) {
    return isTypeCompatible(poiType, googleTypes);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  // Convert a centre point + radius (metres) to a lat/lon bounding box.
  // Used because Text Search locationRestriction only accepts rectangle, not circle.
  _radiusToBBox(lat, lon, radiusMeters) {
    return radiusToBBox(lat, lon, radiusMeters);
  }

  levenshteinDistance(str1, str2) {
    return levenshteinDistance(str1, str2);
  }

  /**
   * Calculate name similarity score (0-1, higher is better)
   */
  calculateNameSimilarity(name1, name2) {
    return calculateNameSimilarity(name1, name2);
  }

  /**
   * Find best name match from search results (New API format)
   * Returns null if no confident match found (prevents wrong matches)
   */
  findBestNameMatch(targetName, results) {
    return findBestNameMatch(targetName, results);
  }

  /**
   * Try matching with multiple name variants (e.g. Thai + English transliteration)
   * Returns the best match across all name variants
   */
  findBestNameMatchMulti(names, results) {
    return findBestNameMatchMulti(names, results);
  }

  getOSMNameVariants(poi) {
    return getOSMNameVariants(poi);
  }

  isPlaceDetailsNameCompatible(poi, placeDetails) {
    return isPlaceDetailsNameCompatible(poi, placeDetails);
  }

  /**
   * Enrich a POI with full Google Places data (New API format)
   * Returns all available fields for comprehensive enrichment
   */
  async enrichPOI(poi) {
    if (!this.enabled) {
      return null;
    }

    // If we already have a google_place_id, use it
    let placeId = poi.google_place_id;

    // Otherwise, find the matching place
    if (!placeId) {
      const match = await this.findMatchingPlace(poi);
      if (!match) {
        return null;
      }
      placeId = match.place_id;
    }

    // Get full place details
    const details = await this.getPlaceDetails(placeId);
    if (!details) {
      return null;
    }

    // Transform new API format to our schema - extract ALL fields
    return {
      // Core identification
      google_place_id: details.id,
      name: details.displayName?.text || details.displayName || null,
      display_name: details.displayName?.text || details.displayName || null,

      // Location
      latitude: details.location?.latitude || null,
      longitude: details.location?.longitude || null,
      viewport: details.viewport || null,

      // Address
      formatted_address: details.formattedAddress || null,
      short_formatted_address: details.shortFormattedAddress || null,
      address_components: details.addressComponents || null,
      plus_code: details.plusCode || null,

      // Classification
      types: details.types || [],
      primary_type: details.primaryType || null,
      primary_type_display: details.primaryTypeDisplayName?.text || null,

      // Contact
      national_phone: details.nationalPhoneNumber || null,
      international_phone: details.internationalPhoneNumber || null,
      website_uri: details.websiteUri || null,
      google_maps_uri: details.googleMapsUri || null,

      // Business info
      business_status: details.businessStatus || null,
      price_level: details.priceLevel || null,
      utc_offset_minutes: details.utcOffsetMinutes || null,

      // Ratings & Reviews
      rating: details.rating || null,
      user_rating_count: details.userRatingCount || null,
      reviews: details.reviews ? details.reviews.slice(0, 5).map(r => ({
        author: r.authorAttribution?.displayName,
        rating: r.rating,
        text: r.text?.text,
        time: r.publishTime,
        relativeTime: r.relativePublishTimeDescription,
      })) : null,

      // Hours
      opening_hours: details.regularOpeningHours ? {
        open_now: details.regularOpeningHours.openNow,
        periods: details.regularOpeningHours.periods,
        weekday_text: details.regularOpeningHours.weekdayDescriptions,
      } : null,
      current_opening_hours: details.currentOpeningHours ? {
        open_now: details.currentOpeningHours.openNow,
        periods: details.currentOpeningHours.periods,
        weekday_text: details.currentOpeningHours.weekdayDescriptions,
      } : null,

      // Photos (up to 10) — URLs resolved below via resolvePhotoUrl
      photos: details.photos ? await Promise.all(details.photos.slice(0, 10).map(async p => ({
        name: p.name,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        authorAttributions: p.authorAttributions,
        url: await this.resolvePhotoUrl(p.name, 800, 600),
        url_thumbnail: await this.resolvePhotoUrl(p.name, 200, 150),
      }))) : null,

      // Service options
      service_options: {
        dine_in: details.dineIn,
        takeout: details.takeout,
        delivery: details.delivery,
        curbside_pickup: details.curbsidePickup,
        reservable: details.reservable,
      },

      // Accessibility
      accessibility: details.accessibilityOptions || null,

      // Amenities - food & drink
      amenities: {
        outdoor_seating: details.outdoorSeating,
        live_music: details.liveMusic,
        menu_for_children: details.menuForChildren,
        serves_beer: details.servesBeer,
        serves_wine: details.servesWine,
        serves_cocktails: details.servesCocktails,
        serves_breakfast: details.servesBreakfast,
        serves_brunch: details.servesBrunch,
        serves_lunch: details.servesLunch,
        serves_dinner: details.servesDinner,
        serves_coffee: details.servesCoffee,
        serves_dessert: details.servesDessert,
        serves_vegetarian_food: details.servesVegetarianFood,
        good_for_children: details.goodForChildren,
        good_for_groups: details.goodForGroups,
        good_for_watching_sports: details.goodForWatchingSports,
        allows_dogs: details.allowsDogs,
        restroom: details.restroom,
        parking_options: details.parkingOptions,
        payment_options: details.paymentOptions,
      },

      // Summary
      editorial_summary: details.editorialSummary?.text || null,

      // Metadata
      enriched_at: new Date(),
      raw_response: details, // Store complete response for future use
    };
  }

  /**
   * Resolve a photo name to a direct CDN URL (no API key exposed).
   * Calls the Photo Media endpoint with skipHttpRedirect=true to get the photoUri.
   * Photo name format: "places/{place_id}/photos/{photo_id}"
   */
  async resolvePhotoUrl(photoName, maxWidthPx = 400, maxHeightPx = 400) {
    if (!this.enabled || !photoName) {
      return null;
    }

    const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidthPx}&maxHeightPx=${maxHeightPx}&skipHttpRedirect=true`;
    try {
      const result = await this.makeGetRequest(url, '');
      return result.photoUri || null;
    } catch {
      return null;
    }
  }
}

export default GooglePlacesClient;
