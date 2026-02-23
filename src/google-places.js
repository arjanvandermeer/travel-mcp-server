/**
 * Google Places API Client (New)
 *
 * Provides methods to search and enrich POI data using Google Places API (New)
 * Documentation: https://developers.google.com/maps/documentation/places/web-service/op-overview
 */

import https from 'https';
import dotenv from 'dotenv';
import * as telemetry from './telemetry.js';

dotenv.config();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

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
        console.warn('⚠️  Google Places API is disabled via google_places_enabled config');
      } else {
        console.warn('⚠️  Google Places API key not configured');
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

    // Track API call with metrics
    return telemetry.timeAsync('google_places.api_latency', async () => {
      telemetry.incrementCounter('google_places.api_calls', 1, { endpoint, method: 'POST' });

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
                telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, error_status: result.error.status });
                reject(new Error(`Google Places API error: ${result.error.status} - ${result.error.message || ''}`));
                return;
              }

              resolve(result);
            } catch (error) {
              telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, error_type: 'parse_error' });
              reject(new Error(`Failed to parse Google Places API response: ${error.message}`));
            }
          });
        });

        req.on('error', (error) => {
          telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, error_type: 'request_error' });
          reject(new Error(`Google Places API request failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
      });
    }, { tags: { endpoint } });
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

    // Track API call with metrics
    return telemetry.timeAsync('google_places.api_latency', async () => {
      telemetry.incrementCounter('google_places.api_calls', 1, { endpoint, method: 'GET' });

      return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (!data) {
                telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, error_type: 'empty_response' });
                reject(new Error('Empty response from Google Places API'));
                return;
              }

              const result = JSON.parse(data);

              // Check for error in response
              if (result.error) {
                telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, error_status: result.error.status });
                reject(new Error(`Google Places API error: ${result.error.status} - ${result.error.message || ''}`));
                return;
              }

              resolve(result);
            } catch (error) {
              telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, error_type: 'parse_error' });
              reject(new Error(`Failed to parse Google Places API response: ${error.message}`));
            }
          });
        });

        req.on('error', (error) => {
          telemetry.incrementCounter('google_places.api_errors', 1, { endpoint, error_type: 'request_error' });
          reject(new Error(`Google Places API request failed: ${error.message}`));
        });

        req.end();
      });
    }, { tags: { endpoint } });
  }

  /**
   * Search for a place near coordinates
   * Uses Nearby Search API (New)
   */
  async searchNearby(latitude, longitude, name, type = null, radius = 50) {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';

    const body = {
      includedTypes: type ? [type] : ['lodging', 'restaurant', 'cafe', 'tourist_attraction'],
      maxResultCount: 20,
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
   * Search for a place by text query
   * Uses Text Search API (New)
   */
  async searchText(query, latitude = null, longitude = null) {
    const url = 'https://places.googleapis.com/v1/places:searchText';

    const body = {
      textQuery: query,
      maxResultCount: 20,
    };

    if (latitude && longitude) {
      body.locationBias = {
        circle: {
          center: {
            latitude: latitude,
            longitude: longitude,
          },
          radius: 1000,
        },
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
   * Find the best matching Google Place for a POI
   * Returns the place_id and basic info
   */
  async findMatchingPlace(poi) {
    if (!this.enabled) {
      return null;
    }

    const { name, name_en, latitude, longitude, poi_type } = poi;

    if (!name || !latitude || !longitude) {
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
    const nearbyResults = await this.searchNearby(latitude, longitude, name, googleType, 100);

    if (nearbyResults.length > 0) {
      // Find best match based on name similarity (try all name variants)
      const bestMatch = this.findBestNameMatchMulti(matchNames, nearbyResults);
      if (bestMatch) {
        return {
          place_id: bestMatch.id,
          name: bestMatch.displayName?.text || bestMatch.displayName,
          rating: bestMatch.rating,
          user_ratings_total: bestMatch.userRatingCount,
          types: bestMatch.types,
        };
      }
    }

    // Fallback to text search (use English name if available for better Google results)
    const searchName = name_en || name;
    const textQuery = `${searchName}, ${latitude}, ${longitude}`;
    const textResults = await this.searchText(textQuery, latitude, longitude);

    if (textResults.length > 0) {
      // Also validate text search results with name matching
      const textMatch = this.findBestNameMatchMulti(matchNames, textResults);
      if (textMatch) {
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
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    return dp[m][n];
  }

  /**
   * Calculate name similarity score (0-1, higher is better)
   */
  calculateNameSimilarity(name1, name2) {
    if (!name1 || !name2) return 0;

    // Normalize: lowercase, remove special chars, collapse whitespace
    const normalize = (str) => str.toLowerCase().trim()
      .replace(/[^\w\s]/g, ' ')  // Replace special chars with space
      .replace(/\s+/g, ' ')      // Collapse multiple spaces
      .trim();

    const n1 = normalize(name1);
    const n2 = normalize(name2);

    // Exact match after normalization
    if (n1 === n2) return 1.0;

    // Extract significant words (filter out common filler words)
    const fillerWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'at', 'to', 'for', 'bar', 'restaurant', 'cafe', 'hotel', 'hostel', 'bistro']);
    const getWords = (str) => str.split(' ').filter(w => w.length > 1 && !fillerWords.has(w));

    const words1 = getWords(n1);
    const words2 = getWords(n2);

    // Check for word overlap (important words match)
    const commonWords = words1.filter(w => words2.some(w2 => w === w2 || w.includes(w2) || w2.includes(w)));
    const wordOverlapScore = commonWords.length > 0
      ? (commonWords.length * 2) / (words1.length + words2.length)
      : 0;

    // Levenshtein-based similarity
    const maxLen = Math.max(n1.length, n2.length);
    const levenshteinScore = maxLen > 0
      ? 1 - (this.levenshteinDistance(n1, n2) / maxLen)
      : 0;

    // Contains match (one name is substring of other)
    let containsScore = 0;
    if (n1.includes(n2) || n2.includes(n1)) {
      containsScore = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
    }

    // Return the highest score from different methods
    return Math.max(wordOverlapScore, levenshteinScore, containsScore);
  }

  /**
   * Find best name match from search results (New API format)
   * Returns null if no confident match found (prevents wrong matches)
   */
  findBestNameMatch(targetName, results) {
    if (!results || results.length === 0) {
      return null;
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const result of results) {
      // Handle new API format: displayName can be {text: "name"} or just "name"
      const resultName = result.displayName?.text || result.displayName || '';
      const score = this.calculateNameSimilarity(targetName, resultName);

      // Debug logging for matching
      if (process.env.DEBUG_MATCHING) {
        console.error(`  Match score: "${targetName}" vs "${resultName}" = ${score.toFixed(3)}`);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    // IMPORTANT: Only return a match if we have good confidence
    // Previously this returned results[0] even with score=0, causing wrong matches
    const MIN_CONFIDENCE = 0.4; // Require at least 40% similarity

    if (bestScore >= MIN_CONFIDENCE) {
      if (process.env.DEBUG_MATCHING) {
        const matchName = bestMatch.displayName?.text || bestMatch.displayName;
        console.error(`  Best match: "${matchName}" with score ${bestScore.toFixed(3)}`);
      }
      return bestMatch;
    }

    // No confident match found - return null instead of wrong match
    if (process.env.DEBUG_MATCHING) {
      console.error(`  No confident match found (best score: ${bestScore.toFixed(3)} < ${MIN_CONFIDENCE})`);
    }
    return null;
  }

  /**
   * Try matching with multiple name variants (e.g. Thai + English transliteration)
   * Returns the best match across all name variants
   */
  findBestNameMatchMulti(names, results) {
    let bestMatch = null;
    let bestScore = 0;

    for (const name of names) {
      for (const result of results) {
        const resultName = result.displayName?.text || result.displayName || '';
        const score = this.calculateNameSimilarity(name, resultName);

        if (process.env.DEBUG_MATCHING) {
          console.error(`  Match score: "${name}" vs "${resultName}" = ${score.toFixed(3)}`);
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = result;
        }
      }
    }

    const MIN_CONFIDENCE = 0.4;
    if (bestScore >= MIN_CONFIDENCE) {
      if (process.env.DEBUG_MATCHING) {
        const matchName = bestMatch.displayName?.text || bestMatch.displayName;
        console.error(`  Best match: "${matchName}" with score ${bestScore.toFixed(3)}`);
      }
      return bestMatch;
    }

    if (process.env.DEBUG_MATCHING) {
      console.error(`  No confident match found (best score: ${bestScore.toFixed(3)} < ${MIN_CONFIDENCE})`);
    }
    return null;
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
