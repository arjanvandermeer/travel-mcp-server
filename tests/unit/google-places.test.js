/**
 * Unit Tests for GooglePlacesClient
 *
 * Tests initialization, helper methods, and high-level methods with mocked HTTP.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { GooglePlacesClient } from '../../src/google-places.js';

describe('GooglePlacesClient', () => {
  // Suppress console.warn/error during tests
  let originalWarn, originalError;

  beforeEach(() => {
    originalWarn = console.warn;
    originalError = console.error;
    console.warn = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;
  });

  // =========================================================================
  // Constructor & isEnabled
  // =========================================================================

  describe('constructor', () => {
    it('should be disabled when no API key provided', () => {
      const client = new GooglePlacesClient(null, true);
      assert.strictEqual(client.isEnabled(), false);
    });

    it('should be disabled when API key is empty string', () => {
      const client = new GooglePlacesClient('', true);
      assert.strictEqual(client.isEnabled(), false);
    });

    it('should be disabled when enabled flag is false', () => {
      const client = new GooglePlacesClient('valid-api-key', false);
      assert.strictEqual(client.isEnabled(), false);
    });

    it('should be enabled when API key and enabled flag are set', () => {
      const client = new GooglePlacesClient('valid-api-key', true);
      assert.strictEqual(client.isEnabled(), true);
    });

    it('should store API key', () => {
      const client = new GooglePlacesClient('test-api-key', true);
      assert.strictEqual(client.apiKey, 'test-api-key');
    });
  });

  describe('isEnabled', () => {
    it('should return false when disabled', () => {
      const client = new GooglePlacesClient(null, false);
      assert.strictEqual(client.isEnabled(), false);
    });

    it('should return true when enabled', () => {
      const client = new GooglePlacesClient('valid-key', true);
      assert.strictEqual(client.isEnabled(), true);
    });
  });

  // =========================================================================
  // makeRequest / makeGetRequest disabled paths
  // =========================================================================

  describe('makeRequest', () => {
    it('should throw error when client is disabled', async () => {
      const client = new GooglePlacesClient(null, true);
      await assert.rejects(
        async () => client.makeRequest('https://example.com', {}, 'fields'),
        /Google Places API is not enabled/,
      );
    });
  });

  describe('makeGetRequest', () => {
    it('should throw error when client is disabled', async () => {
      const client = new GooglePlacesClient(null, true);
      await assert.rejects(
        async () => client.makeGetRequest('https://example.com', 'fields'),
        /Google Places API is not enabled/,
      );
    });
  });

  // =========================================================================
  // resolvePhotoUrl
  // =========================================================================

  describe('resolvePhotoUrl', () => {
    it('should return null when client is disabled', async () => {
      const client = new GooglePlacesClient(null, false);
      const url = await client.resolvePhotoUrl('places/ChIJxxx/photos/AUc7xyz', 800, 600);
      assert.strictEqual(url, null);
    });

    it('should return null when photoName is empty', async () => {
      const client = new GooglePlacesClient('test-api-key', true);
      const url = await client.resolvePhotoUrl(null);
      assert.strictEqual(url, null);
    });
  });

  // =========================================================================
  // levenshteinDistance (pure function)
  // =========================================================================

  describe('levenshteinDistance', () => {
    const client = new GooglePlacesClient('key', true);

    it('should return 0 for identical strings', () => {
      assert.strictEqual(client.levenshteinDistance('hello', 'hello'), 0);
    });

    it('should return length of other string when one is empty', () => {
      assert.strictEqual(client.levenshteinDistance('', 'hello'), 5);
      assert.strictEqual(client.levenshteinDistance('test', ''), 4);
    });

    it('should return correct distance for simple substitution', () => {
      assert.strictEqual(client.levenshteinDistance('cat', 'bat'), 1);
    });

    it('should return correct distance for insertion', () => {
      assert.strictEqual(client.levenshteinDistance('cat', 'cats'), 1);
    });

    it('should return correct distance for deletion', () => {
      assert.strictEqual(client.levenshteinDistance('cats', 'cat'), 1);
    });

    it('should handle completely different strings', () => {
      assert.strictEqual(client.levenshteinDistance('abc', 'xyz'), 3);
    });
  });

  // =========================================================================
  // calculateNameSimilarity (pure function)
  // =========================================================================

  describe('calculateNameSimilarity', () => {
    const client = new GooglePlacesClient('key', true);

    it('should return 0 for null inputs', () => {
      assert.strictEqual(client.calculateNameSimilarity(null, 'test'), 0);
      assert.strictEqual(client.calculateNameSimilarity('test', null), 0);
    });

    it('should return 1.0 for exact match', () => {
      assert.strictEqual(client.calculateNameSimilarity('Hotel Grand', 'Hotel Grand'), 1.0);
    });

    it('should return 1.0 for case-insensitive match', () => {
      assert.strictEqual(client.calculateNameSimilarity('Hotel Grand', 'hotel grand'), 1.0);
    });

    it('should return 1.0 when normalization makes strings equal', () => {
      assert.strictEqual(client.calculateNameSimilarity('Hotel  Grand!', 'Hotel Grand'), 1.0);
    });

    it('should return high score for substring match', () => {
      const score = client.calculateNameSimilarity('Grand Hotel', 'Grand Hotel New York');
      assert.ok(score > 0.5);
    });

    it('should return high score for word overlap', () => {
      const score = client.calculateNameSimilarity('The Grand Hotel', 'Grand Hotel');
      assert.ok(score > 0.5);
    });

    it('should return low score for completely different names', () => {
      const score = client.calculateNameSimilarity('Pizza Place', 'Grand Hotel');
      assert.ok(score < 0.4);
    });

    it('should filter out common filler words', () => {
      // "the" and "hotel" are filler words, so "Grand" is the key word
      const score = client.calculateNameSimilarity('The Grand Hotel', 'Grand Resort');
      assert.ok(score > 0.3);
    });
  });

  // =========================================================================
  // findBestNameMatch
  // =========================================================================

  describe('findBestNameMatch', () => {
    const client = new GooglePlacesClient('key', true);

    it('should return null for empty results', () => {
      assert.strictEqual(client.findBestNameMatch('test', []), null);
      assert.strictEqual(client.findBestNameMatch('test', null), null);
    });

    it('should find exact match', () => {
      const results = [
        { displayName: { text: 'Other Place' }, id: '1' },
        { displayName: { text: 'Grand Hotel' }, id: '2' },
      ];
      const match = client.findBestNameMatch('Grand Hotel', results);
      assert.strictEqual(match.id, '2');
    });

    it('should handle displayName as string', () => {
      const results = [{ displayName: 'Grand Hotel', id: '1' }];
      const match = client.findBestNameMatch('Grand Hotel', results);
      assert.strictEqual(match.id, '1');
    });

    it('should return null when no confident match (below threshold)', () => {
      const results = [
        { displayName: { text: 'XYZ Completely Different' }, id: '1' },
      ];
      const match = client.findBestNameMatch('Grand Hotel', results);
      assert.strictEqual(match, null);
    });

    it('should pick highest scoring match', () => {
      const results = [
        { displayName: { text: 'Grand Resort' }, id: '1' },
        { displayName: { text: 'Grand Hotel NYC' }, id: '2' },
      ];
      const match = client.findBestNameMatch('Grand Hotel', results);
      assert.ok(match);
      // Should prefer the closer match
      assert.strictEqual(match.id, '2');
    });
  });

  // =========================================================================
  // isTypeCompatible
  // =========================================================================

  describe('isTypeCompatible', () => {
    const client = new GooglePlacesClient('key', true);

    it('should return true when no POI type is provided', () => {
      assert.strictEqual(client.isTypeCompatible(null, ['lodging']), true);
    });

    it('should return true when no Google types are provided', () => {
      assert.strictEqual(client.isTypeCompatible('hotel', null), true);
      assert.strictEqual(client.isTypeCompatible('hotel', []), true);
    });

    it('should return true when POI type has no compatibility rule', () => {
      assert.strictEqual(client.isTypeCompatible('museum', ['museum', 'point_of_interest']), true);
    });

    it('should return true when hotel matches lodging type', () => {
      assert.strictEqual(client.isTypeCompatible('hotel', ['lodging', 'point_of_interest']), true);
    });

    it('should return true when hostel matches hostel type', () => {
      assert.strictEqual(client.isTypeCompatible('hostel', ['hostel', 'lodging']), true);
    });

    it('should return false when hotel matches restaurant type', () => {
      assert.strictEqual(client.isTypeCompatible('hotel', ['restaurant', 'food']), false);
    });

    it('should return true when restaurant matches food type', () => {
      assert.strictEqual(client.isTypeCompatible('restaurant', ['food', 'point_of_interest']), true);
    });

    it('should return false when restaurant matches lodging type', () => {
      assert.strictEqual(client.isTypeCompatible('restaurant', ['lodging', 'point_of_interest']), false);
    });
  });

  // =========================================================================
  // Confidence threshold
  // =========================================================================

  describe('confidence threshold', () => {
    const client = new GooglePlacesClient('key', true);

    it('should return null when name similarity is below 0.7', () => {
      // "Grand Hotel" vs "Sunset Bar" should score well below 0.7
      const results = [
        { displayName: { text: 'Sunset Bar' }, id: '1' },
      ];
      const match = client.findBestNameMatch('Grand Hotel', results);
      assert.strictEqual(match, null);
    });

    it('should return match when name similarity is above 0.7', () => {
      const results = [
        { displayName: { text: 'Grand Hotel NYC' }, id: '1' },
      ];
      const match = client.findBestNameMatch('Grand Hotel', results);
      assert.ok(match, 'Expected a match for similar names above 0.7 threshold');
      assert.strictEqual(match.id, '1');
    });

    it('should reject moderate similarity that was previously accepted at 0.4', () => {
      // Names that might score ~0.4-0.6 but not 0.7
      const results = [
        { displayName: { text: 'Grand Palace' }, id: '1' },
      ];
      const match = client.findBestNameMatch('Grand Hotel', results);
      // "Grand Palace" vs "Grand Hotel" - word overlap is just "grand" (filler words filtered)
      // This should now be rejected with the higher threshold
      assert.strictEqual(match, null);
    });
  });

  // =========================================================================
  // searchNearby (with mocked makeRequest)
  // =========================================================================

  describe('searchNearby', () => {
    it('should return places from API response', async () => {
      const client = new GooglePlacesClient('key', true);
      const places = [{ id: 'place1', displayName: { text: 'Hotel A' } }];
      client.makeRequest = async () => ({ places });

      const result = await client.searchNearby(40.7, -73.9, 'Hotel A');
      assert.deepStrictEqual(result, places);
    });

    it('should return empty array when no places in response', async () => {
      const client = new GooglePlacesClient('key', true);
      client.makeRequest = async () => ({});

      const result = await client.searchNearby(40.7, -73.9, 'Hotel A');
      assert.deepStrictEqual(result, []);
    });

    it('should return empty array on error', async () => {
      const client = new GooglePlacesClient('key', true);
      client.makeRequest = async () => { throw new Error('API error'); };

      const result = await client.searchNearby(40.7, -73.9, 'Hotel A');
      assert.deepStrictEqual(result, []);
    });

    it('should pass type when provided', async () => {
      const client = new GooglePlacesClient('key', true);
      let capturedBody;
      client.makeRequest = async (_url, body) => { capturedBody = body; return { places: [] }; };

      await client.searchNearby(40.7, -73.9, 'Hotel A', 'lodging', 200);
      assert.deepStrictEqual(capturedBody.includedTypes, ['lodging']);
      assert.strictEqual(capturedBody.locationRestriction.circle.radius, 200);
    });
  });

  // =========================================================================
  // searchText (with mocked makeRequest)
  // =========================================================================

  describe('searchText', () => {
    it('should return places from API response', async () => {
      const client = new GooglePlacesClient('key', true);
      const places = [{ id: 'place1' }];
      client.makeRequest = async () => ({ places });

      const result = await client.searchText('Grand Hotel');
      assert.deepStrictEqual(result, places);
    });

    it('should add locationBias when coordinates provided', async () => {
      const client = new GooglePlacesClient('key', true);
      let capturedBody;
      client.makeRequest = async (_url, body) => { capturedBody = body; return { places: [] }; };

      await client.searchText('Hotel', 40.7, -73.9);
      assert.ok(capturedBody.locationBias);
      assert.strictEqual(capturedBody.locationBias.circle.center.latitude, 40.7);
    });

    it('should not add locationBias without coordinates', async () => {
      const client = new GooglePlacesClient('key', true);
      let capturedBody;
      client.makeRequest = async (_url, body) => { capturedBody = body; return { places: [] }; };

      await client.searchText('Hotel');
      assert.strictEqual(capturedBody.locationBias, undefined);
    });

    it('should return empty array on error', async () => {
      const client = new GooglePlacesClient('key', true);
      client.makeRequest = async () => { throw new Error('API error'); };

      const result = await client.searchText('Hotel');
      assert.deepStrictEqual(result, []);
    });
  });

  // =========================================================================
  // getPlaceDetails (with mocked makeGetRequest)
  // =========================================================================

  describe('getPlaceDetails', () => {
    it('should return place details', async () => {
      const client = new GooglePlacesClient('key', true);
      const details = { id: 'place1', displayName: { text: 'Hotel' } };
      client.makeGetRequest = async () => details;

      const result = await client.getPlaceDetails('place1');
      assert.deepStrictEqual(result, details);
    });

    it('should format place ID with places/ prefix', async () => {
      const client = new GooglePlacesClient('key', true);
      let capturedUrl;
      client.makeGetRequest = async (url) => { capturedUrl = url; return {}; };

      await client.getPlaceDetails('ChIJ123');
      assert.ok(capturedUrl.includes('places/ChIJ123'));
    });

    it('should not double-prefix places/', async () => {
      const client = new GooglePlacesClient('key', true);
      let capturedUrl;
      client.makeGetRequest = async (url) => { capturedUrl = url; return {}; };

      await client.getPlaceDetails('places/ChIJ123');
      assert.ok(capturedUrl.includes('places/ChIJ123'));
      assert.ok(!capturedUrl.includes('places/places/'));
    });

    it('should return null on error', async () => {
      const client = new GooglePlacesClient('key', true);
      client.makeGetRequest = async () => { throw new Error('API error'); };

      const result = await client.getPlaceDetails('ChIJ123');
      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // findMatchingPlace (with mocked search methods)
  // =========================================================================

  describe('findMatchingPlace', () => {
    it('should return null when disabled', async () => {
      const client = new GooglePlacesClient(null, false);
      const result = await client.findMatchingPlace({ name: 'Hotel', latitude: 40.7, longitude: -73.9 });
      assert.strictEqual(result, null);
    });

    it('should return null when missing required fields', async () => {
      const client = new GooglePlacesClient('key', true);
      assert.strictEqual(await client.findMatchingPlace({ name: null, latitude: 40.7, longitude: -73.9 }), null);
      assert.strictEqual(await client.findMatchingPlace({ name: 'Hotel', latitude: null, longitude: -73.9 }), null);
    });

    it('should find match via nearby search', async () => {
      const client = new GooglePlacesClient('key', true);
      client.searchNearby = async () => [
        { id: 'place1', displayName: { text: 'Grand Hotel' }, rating: 4.5, userRatingCount: 100, types: ['lodging'] },
      ];
      client.searchText = async () => [];

      const result = await client.findMatchingPlace({
        name: 'Grand Hotel', latitude: 40.7, longitude: -73.9, poi_type: 'hotel',
      });
      assert.ok(result);
      assert.strictEqual(result.place_id, 'place1');
      assert.strictEqual(result.rating, 4.5);
    });

    it('should fallback to text search when nearby finds no match', async () => {
      const client = new GooglePlacesClient('key', true);
      client.searchNearby = async () => [];
      client.searchText = async () => [
        { id: 'place2', displayName: { text: 'Grand Hotel' }, rating: 4.0, userRatingCount: 50, types: ['lodging'] },
      ];

      const result = await client.findMatchingPlace({
        name: 'Grand Hotel', latitude: 40.7, longitude: -73.9, poi_type: 'hotel',
      });
      assert.ok(result);
      assert.strictEqual(result.place_id, 'place2');
    });

    it('should return null when no confident match from either search', async () => {
      const client = new GooglePlacesClient('key', true);
      client.searchNearby = async () => [{ id: 'p1', displayName: { text: 'XYZXYZ' } }];
      client.searchText = async () => [{ id: 'p2', displayName: { text: 'ABCABC' } }];

      const result = await client.findMatchingPlace({
        name: 'Grand Hotel', latitude: 40.7, longitude: -73.9, poi_type: 'hotel',
      });
      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // enrichPOI (with mocked methods)
  // =========================================================================

  describe('enrichPOI', () => {
    it('should return null when disabled', async () => {
      const client = new GooglePlacesClient(null, false);
      const result = await client.enrichPOI({ name: 'Hotel' });
      assert.strictEqual(result, null);
    });

    it('should return null when no matching place found', async () => {
      const client = new GooglePlacesClient('key', true);
      client.findMatchingPlace = async () => null;

      const result = await client.enrichPOI({ name: 'Hotel', latitude: 40.7, longitude: -73.9 });
      assert.strictEqual(result, null);
    });

    it('should return null when place details fetch fails', async () => {
      const client = new GooglePlacesClient('key', true);
      client.findMatchingPlace = async () => ({ place_id: 'place1' });
      client.getPlaceDetails = async () => null;

      const result = await client.enrichPOI({ name: 'Hotel', latitude: 40.7, longitude: -73.9 });
      assert.strictEqual(result, null);
    });

    it('should use existing google_place_id if available', async () => {
      const client = new GooglePlacesClient('key', true);
      let findCalled = false;
      client.findMatchingPlace = async () => { findCalled = true; return null; };
      client.getPlaceDetails = async () => ({
        id: 'existing-id',
        displayName: { text: 'Hotel' },
        location: { latitude: 40.7, longitude: -73.9 },
        types: ['lodging'],
      });
      client.resolvePhotoUrl = async () => null;

      const result = await client.enrichPOI({
        name: 'Hotel', latitude: 40.7, longitude: -73.9,
        google_place_id: 'existing-id',
      });
      assert.strictEqual(findCalled, false);
      assert.ok(result);
      assert.strictEqual(result.google_place_id, 'existing-id');
    });

    it('should transform full place details to schema', async () => {
      const client = new GooglePlacesClient('key', true);
      client.findMatchingPlace = async () => ({ place_id: 'p1' });
      client.getPlaceDetails = async () => ({
        id: 'p1',
        displayName: { text: 'Grand Hotel' },
        location: { latitude: 40.7, longitude: -73.9 },
        formattedAddress: '123 Main St, NYC',
        shortFormattedAddress: '123 Main St',
        types: ['lodging'],
        primaryType: 'hotel',
        primaryTypeDisplayName: { text: 'Hotel' },
        nationalPhoneNumber: '555-1234',
        internationalPhoneNumber: '+1 555-1234',
        websiteUri: 'https://hotel.com',
        googleMapsUri: 'https://maps.google.com/place1',
        businessStatus: 'OPERATIONAL',
        priceLevel: 'PRICE_LEVEL_MODERATE',
        utcOffsetMinutes: -300,
        rating: 4.5,
        userRatingCount: 200,
        reviews: [
          { authorAttribution: { displayName: 'John' }, rating: 5, text: { text: 'Great!' }, publishTime: '2024-01-01', relativePublishTimeDescription: '1 month ago' },
        ],
        regularOpeningHours: { openNow: true, periods: [], weekdayDescriptions: ['Mon: 24hrs'] },
        currentOpeningHours: { openNow: true, periods: [], weekdayDescriptions: ['Mon: 24hrs'] },
        dineIn: true,
        takeout: false,
        delivery: false,
        curbsidePickup: false,
        reservable: true,
        accessibilityOptions: { wheelchairAccessibleEntrance: true },
        outdoorSeating: true,
        servesBeer: true,
        servesWine: true,
        editorialSummary: { text: 'A fine hotel' },
      });
      client.resolvePhotoUrl = async () => null;

      const result = await client.enrichPOI({ name: 'Grand Hotel', latitude: 40.7, longitude: -73.9 });

      assert.strictEqual(result.google_place_id, 'p1');
      assert.strictEqual(result.name, 'Grand Hotel');
      assert.strictEqual(result.formatted_address, '123 Main St, NYC');
      assert.strictEqual(result.rating, 4.5);
      assert.strictEqual(result.user_rating_count, 200);
      assert.strictEqual(result.business_status, 'OPERATIONAL');
      assert.strictEqual(result.website_uri, 'https://hotel.com');
      assert.strictEqual(result.editorial_summary, 'A fine hotel');
      assert.ok(result.opening_hours);
      assert.ok(result.current_opening_hours);
      assert.strictEqual(result.service_options.dine_in, true);
      assert.strictEqual(result.service_options.reservable, true);
      assert.ok(result.accessibility);
      assert.strictEqual(result.amenities.outdoor_seating, true);
      assert.strictEqual(result.amenities.serves_beer, true);
      assert.ok(result.reviews);
      assert.strictEqual(result.reviews.length, 1);
      assert.strictEqual(result.reviews[0].author, 'John');
      assert.ok(result.enriched_at instanceof Date);
    });

    it('should handle photos with URL resolution', async () => {
      const client = new GooglePlacesClient('key', true);
      client.findMatchingPlace = async () => ({ place_id: 'p1' });
      client.getPlaceDetails = async () => ({
        id: 'p1',
        displayName: { text: 'Hotel' },
        types: [],
        photos: [
          { name: 'places/p1/photos/photo1', widthPx: 1000, heightPx: 750, authorAttributions: [] },
        ],
      });
      client.resolvePhotoUrl = async (_name, w, h) => `https://cdn.example.com/photo?w=${w}&h=${h}`;

      const result = await client.enrichPOI({ name: 'Hotel', latitude: 40.7, longitude: -73.9 });
      assert.ok(result.photos);
      assert.strictEqual(result.photos.length, 1);
      assert.strictEqual(result.photos[0].url, 'https://cdn.example.com/photo?w=800&h=600');
      assert.strictEqual(result.photos[0].url_thumbnail, 'https://cdn.example.com/photo?w=200&h=150');
    });
  });
});
