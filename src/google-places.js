/**
 * Google Places API Client
 *
 * Provides methods to search and enrich POI data using Google Places API
 */

import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GOOGLE_PLACES_ENABLED = process.env.GOOGLE_PLACES_ENABLED !== 'false';

export class GooglePlacesClient {
  constructor(apiKey = GOOGLE_PLACES_API_KEY) {
    this.apiKey = apiKey;
    this.enabled = GOOGLE_PLACES_ENABLED && !!apiKey;

    if (!this.enabled) {
      console.warn('⚠️  Google Places API is disabled or API key not configured');
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /**
   * Make a request to Google Places API
   */
  async makeRequest(endpoint, params) {
    if (!this.enabled) {
      throw new Error('Google Places API is not enabled');
    }

    const queryParams = new URLSearchParams({
      ...params,
      key: this.apiKey,
    });

    const url = `https://maps.googleapis.com/maps/api/place/${endpoint}/json?${queryParams}`;

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const result = JSON.parse(data);

            if (result.status === 'OK') {
              resolve(result);
            } else if (result.status === 'ZERO_RESULTS') {
              resolve({ status: 'ZERO_RESULTS', results: [] });
            } else {
              reject(new Error(`Google Places API error: ${result.status} - ${result.error_message || ''}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse Google Places API response: ${error.message}`));
          }
        });
      }).on('error', (error) => {
        reject(new Error(`Google Places API request failed: ${error.message}`));
      });
    });
  }

  /**
   * Search for a place near coordinates
   * Uses Nearby Search API
   */
  async searchNearby(latitude, longitude, name, type = null, radius = 50) {
    const params = {
      location: `${latitude},${longitude}`,
      radius: radius,
      keyword: name,
    };

    if (type) {
      params.type = type;
    }

    try {
      const result = await this.makeRequest('nearbysearch', params);
      return result.results || [];
    } catch (error) {
      console.error('Google Places Nearby Search error:', error.message);
      return [];
    }
  }

  /**
   * Search for a place by text query
   * Uses Text Search API
   */
  async searchText(query, latitude = null, longitude = null) {
    const params = { query };

    if (latitude && longitude) {
      params.location = `${latitude},${longitude}`;
      params.radius = 1000; // 1km radius for text search
    }

    try {
      const result = await this.makeRequest('textsearch', params);
      return result.results || [];
    } catch (error) {
      console.error('Google Places Text Search error:', error.message);
      return [];
    }
  }

  /**
   * Get detailed information about a place
   * Uses Place Details API
   */
  async getPlaceDetails(placeId) {
    const params = {
      place_id: placeId,
      fields: 'place_id,name,rating,user_ratings_total,price_level,types,formatted_address,formatted_phone_number,website,opening_hours,photos,geometry',
    };

    try {
      const result = await this.makeRequest('details', params);
      return result.result || null;
    } catch (error) {
      console.error('Google Places Details error:', error.message);
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

    const { name, latitude, longitude, poi_type } = poi;

    if (!name || !latitude || !longitude) {
      return null;
    }

    // Map POI types to Google Place types
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
      // Find best match based on name similarity
      const bestMatch = this.findBestNameMatch(name, nearbyResults);
      if (bestMatch) {
        return {
          place_id: bestMatch.place_id,
          name: bestMatch.name,
          rating: bestMatch.rating,
          user_ratings_total: bestMatch.user_ratings_total,
          types: bestMatch.types,
        };
      }
    }

    // Fallback to text search
    const textQuery = `${name}, ${latitude}, ${longitude}`;
    const textResults = await this.searchText(textQuery, latitude, longitude);

    if (textResults.length > 0) {
      return {
        place_id: textResults[0].place_id,
        name: textResults[0].name,
        rating: textResults[0].rating,
        user_ratings_total: textResults[0].user_ratings_total,
        types: textResults[0].types,
      };
    }

    return null;
  }

  /**
   * Find best name match from search results
   */
  findBestNameMatch(targetName, results) {
    if (!results || results.length === 0) {
      return null;
    }

    // Simple name similarity scoring
    const normalized = (str) => str.toLowerCase().trim().replace(/[^\w\s]/g, '');
    const target = normalized(targetName);

    let bestMatch = null;
    let bestScore = 0;

    for (const result of results) {
      const candidate = normalized(result.name);

      // Exact match
      if (candidate === target) {
        return result;
      }

      // Contains match
      if (candidate.includes(target) || target.includes(candidate)) {
        const score = Math.min(target.length, candidate.length) / Math.max(target.length, candidate.length);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = result;
        }
      }
    }

    // Return best match if score is good enough (> 0.6)
    return bestScore > 0.6 ? bestMatch : results[0];
  }

  /**
   * Enrich a POI with full Google Places data
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

    // Transform to our schema
    return {
      google_place_id: details.place_id,
      google_rating: details.rating || null,
      google_user_ratings_total: details.user_ratings_total || null,
      google_price_level: details.price_level !== undefined ? details.price_level : null,
      google_types: details.types || [],
      google_formatted_address: details.formatted_address || null,
      google_phone: details.formatted_phone_number || null,
      google_website: details.website || null,
      google_opening_hours: details.opening_hours || null,
      google_photos: details.photos ? details.photos.slice(0, 10).map(p => ({
        photo_reference: p.photo_reference,
        width: p.width,
        height: p.height,
      })) : null,
      google_enriched_at: new Date(),
      google_enrichment_status: 'enriched',
    };
  }

  /**
   * Get photo URL from photo reference
   */
  getPhotoUrl(photoReference, maxWidth = 400) {
    if (!this.enabled || !photoReference) {
      return null;
    }

    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${this.apiKey}`;
  }
}

export default GooglePlacesClient;
