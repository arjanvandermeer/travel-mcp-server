/**
 * Google Places API Client (New)
 *
 * Provides methods to search and enrich POI data using Google Places API (New)
 * Documentation: https://developers.google.com/maps/documentation/places/web-service/op-overview
 */

import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export class GooglePlacesClient {
  constructor(apiKey = GOOGLE_PLACES_API_KEY) {
    this.apiKey = apiKey;

    // Enabled if API key is present AND not explicitly disabled via GOOGLE_PLACES_ENABLED=false
    const explicitlyDisabled = process.env.GOOGLE_PLACES_ENABLED === 'false';
    this.enabled = !!apiKey && !explicitlyDisabled;

    if (!this.enabled) {
      if (explicitlyDisabled) {
        console.warn('⚠️  Google Places API is explicitly disabled via GOOGLE_PLACES_ENABLED=false');
      } else {
        console.warn('⚠️  Google Places API is disabled or API key not configured');
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
              reject(new Error(`Google Places API error: ${result.error.status} - ${result.error.message || ''}`));
              return;
            }

            resolve(result);
          } catch (error) {
            reject(new Error(`Failed to parse Google Places API response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Google Places API request failed: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Make a GET request to Google Places API (New) - for Place Details
   */
  async makeGetRequest(url, fieldMask) {
    if (!this.enabled) {
      throw new Error('Google Places API is not enabled');
    }

    const options = {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (!data) {
              reject(new Error('Empty response from Google Places API'));
              return;
            }

            const result = JSON.parse(data);

            // Check for error in response
            if (result.error) {
              reject(new Error(`Google Places API error: ${result.error.status} - ${result.error.message || ''}`));
              return;
            }

            resolve(result);
          } catch (error) {
            reject(new Error(`Failed to parse Google Places API response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Google Places API request failed: ${error.message}`));
      });

      req.end();
    });
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
      // Find best match based on name similarity
      const bestMatch = this.findBestNameMatch(name, nearbyResults);
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

    // Fallback to text search
    const textQuery = `${name}, ${latitude}, ${longitude}`;
    const textResults = await this.searchText(textQuery, latitude, longitude);

    if (textResults.length > 0) {
      const firstResult = textResults[0];
      return {
        place_id: firstResult.id,
        name: firstResult.displayName?.text || firstResult.displayName,
        rating: firstResult.rating,
        user_ratings_total: firstResult.userRatingCount,
        types: firstResult.types,
      };
    }

    return null;
  }

  /**
   * Find best name match from search results (New API format)
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
      // Handle new API format: displayName can be {text: "name"} or just "name"
      const resultName = result.displayName?.text || result.displayName || '';
      const candidate = normalized(resultName);

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

      // Photos (up to 10) with computed URLs
      photos: details.photos ? details.photos.slice(0, 10).map(p => ({
        name: p.name,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        authorAttributions: p.authorAttributions,
        url: this.getPhotoUrl(p.name, 800, 600),
        url_thumbnail: this.getPhotoUrl(p.name, 200, 150),
      })) : null,

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
   * Get photo URL from photo name (New API format)
   * Photo name format: "places/{place_id}/photos/{photo_id}"
   */
  getPhotoUrl(photoName, maxWidthPx = 400, maxHeightPx = 400) {
    if (!this.enabled || !photoName) {
      return null;
    }

    return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidthPx}&maxHeightPx=${maxHeightPx}&key=${this.apiKey}`;
  }
}

export default GooglePlacesClient;
