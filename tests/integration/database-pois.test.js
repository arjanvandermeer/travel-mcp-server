/**
 * Integration Tests for TravelDatabase POI Functions
 *
 * Tests searchPOIs, searchPOIsNearCoordinates, getPOIDetails
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TravelDatabase } from '../../src/database.js';
import { createMockDatabase } from '../mocks/db-mock.js';
import { dbResult, emptyResult } from '../fixtures/sample-data.js';

describe('TravelDatabase POI Search Functions', () => {
  let db;
  let mockPool;

  // Sample POI data for test responses
  const samplePOIs = [
    {
      osm_id: 12345,
      poi_type: 'hotel',
      name: 'Grand Hotel Bangkok',
      latitude: 13.75,
      longitude: 100.5,
      city: 'Bangkok',
      country_code: 'TH',
      google_place_id: 'ChIJ123',
      google_rating: 4.5,
      google_review_count: 1200,
      osm_stars: 5,
    },
    {
      osm_id: 12346,
      poi_type: 'restaurant',
      name: 'Thai Kitchen',
      latitude: 13.76,
      longitude: 100.51,
      city: 'Bangkok',
      country_code: 'TH',
      google_rating: 4.2,
      osm_cuisine: 'thai',
    },
  ];

  beforeEach(() => {
    mockPool = createMockDatabase({}, { throwOnUnmatched: false });
    // Mock getServerBaseUrl
    mockPool.setResponse('server_base_url', dbResult([{ value: 'https://example.com' }]));
    // Mock Google Places config with fake key to suppress warnings
    mockPool.setResponse('google_places_api_key', dbResult([{ value: 'test-fake-api-key' }]));
    mockPool.setResponse('google_places_enabled', dbResult([{ value: 'true' }]));
  });

  describe('searchPOIs', () => {
    describe('Case 1: Name search only', () => {
      it('should search POIs by name only', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand Hotel' });

        assert.ok(Array.isArray(results));
        assert.ok(mockPool.wasCalled('osm_pois'));
        // Should have called with ILIKE pattern
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.params?.includes('%Grand Hotel%'));
        assert.ok(searchCall, 'Should search with ILIKE pattern');
      });

      it('should filter by country code when provided', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand Hotel', countryCode: 'TH' });

        assert.ok(Array.isArray(results));
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c =>
          c.sql.includes('country_code') &&
          c.params?.includes('TH')
        );
        assert.ok(searchCall, 'Should filter by country code');
      });

      it('should filter by POI type when provided', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({ name: 'Grand', poiType: 'hotel' });

        assert.ok(Array.isArray(results));
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('poi_type'));
        assert.ok(searchCall, 'Should filter by POI type');
      });

      it('should support multiple POI types', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand',
          poiTypes: ['hotel', 'restaurant']
        });

        assert.ok(Array.isArray(results));
      });

      it('should add cuisine filters to name searches', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Kitchen',
          poiTypes: ['restaurant'],
          cuisine: ['sushi', 'japanese'],
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('p.cuisine ILIKE'));
        assert.ok(searchCall, 'Should include cuisine ILIKE clauses');
        assert.ok(searchCall.sql.includes(' OR '), 'Multiple cuisines should use OR logic');
        assert.ok(searchCall.params.includes('%sushi%'), 'Should bind first cuisine');
        assert.ok(searchCall.params.includes('%japanese%'), 'Should bind second cuisine');
      });

      it('should add restaurant occasion filters to name searches', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));
        mockPool.setResponse('google_places', dbResult([
          { osm_id: 12346, google_rating: 4.6, google_price_level: 'PRICE_LEVEL_EXPENSIVE' },
        ]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Kitchen',
          poiTypes: ['restaurant'],
          occasion: 'date_night',
          limit: 20,
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes("p.poi_type = ANY(ARRAY['restaurant','bar','pub'])"));
        assert.ok(searchCall, 'Should include date night type clauses');
        assert.ok(searchCall.sql.includes("p.tags ? 'reservation'"), 'Should include explainable reservation signal');
        assert.strictEqual(searchCall.params.at(-1), 60, 'Should over-fetch for occasion post-filtering');
        assert.strictEqual(results[0].restaurant_occasion, 'date_night');
        assert.match(results[0].restaurant_occasion_explanation, /reservation, outdoor-seating, live-music/);
      });

      it('should accept a single cuisine string', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Kitchen',
          poiTypes: ['restaurant'],
          cuisine: 'thai',
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('p.cuisine ILIKE'));
        assert.ok(searchCall, 'Should include cuisine ILIKE clause');
        assert.ok(searchCall.params.includes('%thai%'), 'Should bind single cuisine string');
      });

      it('should map dietary filters to parameterized OSM tag keys', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Kitchen',
          poiTypes: ['restaurant'],
          dietary: ['vegan', 'vegetarian', 'pescatarian', 'halal', 'kosher', 'gluten_free'],
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes("p.tags->>$"));
        assert.ok(searchCall, 'Should include parameterized tag lookups');
        assert.ok(searchCall.params.includes('diet:vegan'), 'Should bind vegan tag key');
        assert.ok(searchCall.params.includes('diet:vegetarian'), 'Should bind vegetarian tag key');
        assert.ok(searchCall.params.includes('diet:pescetarian'), 'Should bind pescetarian tag key');
        assert.ok(searchCall.params.includes('diet:halal'), 'Should bind halal tag key');
        assert.ok(searchCall.params.includes('diet:kosher'), 'Should bind kosher tag key');
        assert.ok(searchCall.params.includes('diet:gluten_free'), 'Should bind gluten-free tag key');
        assert.ok(!searchCall.sql.includes('diet:vegan'), 'Tag keys should not be interpolated into SQL');
      });

      it('should map amenity filters to index-friendly OSM tag checks', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Grand Hotel',
          poiTypes: ['hotel'],
          amenities: ['wifi', 'pool', 'breakfast', 'air_conditioning', 'parking'],
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('p.tags ? $'));
        assert.ok(searchCall, 'Should include JSONB key-existence checks');
        assert.ok(searchCall.sql.includes('p.tags->>$'), 'Should reject explicit no values');
        assert.ok(searchCall.params.includes('internet_access'), 'Should bind wifi tag key');
        assert.ok(searchCall.params.includes('swimming_pool'), 'Should bind pool tag key');
        assert.ok(searchCall.params.includes('breakfast'), 'Should bind breakfast tag key');
        assert.ok(searchCall.params.includes('air_conditioning'), 'Should bind air conditioning tag key');
        assert.ok(searchCall.params.includes('parking'), 'Should bind parking tag key');
        assert.ok(!searchCall.sql.includes('internet_access'), 'Tag keys should not be interpolated into SQL');
      });

      it('should search hotel chains without requiring a city or coordinates', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          countryCode: 'TH',
          poiTypes: ['hotel'],
          chain: 'Hilton',
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('hotel_chains') && c.sql.includes('c.country_code'));
        assert.ok(searchCall, 'Should query with hotel chain reference data');
        assert.ok(searchCall.sql.includes('LOWER(hc.chain_name)'), 'Should match chain names');
        assert.ok(searchCall.sql.includes('unnest(hc.aliases)'), 'Should match sub-brand aliases');
        assert.ok(searchCall.params.includes('TH'), 'Should bind country code');
        assert.ok(searchCall.params.includes('Hilton'), 'Should bind chain name');
        assert.ok(searchCall.params.some(p => Array.isArray(p) && p.includes('hotel')), 'Should bind hotel POI types');
      });

      it('should add hotel brand filters to name searches', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        await db.searchPOIs({
          name: 'Bangkok',
          poiTypes: ['hotel'],
          brand: 'DoubleTree',
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('hotel_chains') && c.params.includes('DoubleTree'));
        assert.ok(searchCall, 'Should include hotel chain reference filter');
        assert.ok(searchCall.sql.includes("p.tags->>'brand'"), 'Should match OSM brand tags');
        assert.ok(searchCall.sql.includes("p.tags->>'operator'"), 'Should match OSM operator tags');
        assert.ok(searchCall.sql.includes("p.tags->>'brand:wikidata'"), 'Should match OSM brand Wikidata tags');
      });

      it('should add explainable hotel intent filters to name searches', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand Hotel',
          poiTypes: ['hotel'],
          intent: 'romantic',
        });

        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('p.stars >= 4'));
        assert.ok(searchCall, 'Should include romantic hotel intent clauses');
        assert.ok(searchCall.sql.includes("p.tags ? 'spa'"), 'Should include explainable tag-based clauses');
        assert.strictEqual(results[0].hotel_intent, 'romantic');
        assert.match(results[0].hotel_intent_explanation, /spa, pool, garden, balcony/);
      });
    });

    describe('Case 2: Location only search', () => {
      it('should search by city name', async () => {
        // Mock city lookup
        mockPool.setResponse('geonames_cities', dbResult([{
          geoname_id: 1609350,
          name: 'Bangkok',
          latitude: 13.75,
          longitude: 100.5,
          population: 8000000,
        }]));
        // Mock POI search near coordinates
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          cityName: 'Bangkok',
          countryCode: 'TH'
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by coordinates', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          latitude: 13.75,
          longitude: 100.5
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by zero latitude/longitude coordinates', async () => {
        mockPool.setResponse('osm_pois', dbResult(samplePOIs));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          latitude: 0,
          longitude: 0,
        });

        assert.ok(Array.isArray(results));
        const calls = mockPool.getCalls();
        const searchCall = calls.find(c => c.sql.includes('ST_DWithin'));
        assert.ok(searchCall, 'Should use coordinate search for zero values');
        assert.ok(searchCall.params.includes(0), 'Should pass zero coordinate values');
      });

      it('should return empty array when city not found', async () => {
        mockPool.setResponse('geonames_cities', emptyResult());

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          cityName: 'NonexistentCity',
          countryCode: 'XX'
        });

        assert.ok(Array.isArray(results));
        assert.strictEqual(results.length, 0);
      });
    });

    describe('Case 3: Name + Location combined', () => {
      it('should search by name and city', async () => {
        // Mock city lookup
        mockPool.setResponse('geonames_cities', dbResult([{
          geoname_id: 1609350,
          name: 'Bangkok',
          latitude: 13.75,
          longitude: 100.5,
          population: 8000000,
        }]));
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand Hotel',
          cityName: 'Bangkok',
          countryCode: 'TH'
        });

        assert.ok(Array.isArray(results));
      });

      it('should search by name and coordinates', async () => {
        mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

        db = new TravelDatabase({ pool: mockPool });
        const results = await db.searchPOIs({
          name: 'Grand Hotel',
          latitude: 13.75,
          longitude: 100.5,
          radius: 10
        });

        assert.ok(Array.isArray(results));
      });
    });

    describe('Error cases', () => {
      it('should throw error when no search criteria provided', async () => {
        db = new TravelDatabase({ pool: mockPool });

        await assert.rejects(
          async () => db.searchPOIs({}),
          /Must provide either name, cityName, or coordinates/
        );
      });
    });
  });

  describe('stay quality scoring', () => {
    it('should add hotel stay quality scores with nearby dining query coverage', async () => {
      mockPool.setResponse('SELECT h.osm_id', dbResult([{ osm_id: 12345, nearby_restaurant_count: 8 }]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.addStayQualityScores([{
        osm_id: 12345,
        poi_type: 'hotel',
        name: 'Grand Hotel Bangkok',
        google_rating: 4.5,
        google_review_count: 1200,
        osm_stars: 5,
        osm_tags: { internet_access: 'wlan', swimming_pool: 'yes', spa: 'yes', parking: 'yes' },
        google_amenities: { goodForChildren: true },
      }]);

      assert.strictEqual(results[0].stay_quality_score, 87);
      assert.strictEqual(results[0].stay_quality_confidence, 'high');
      assert.strictEqual(results[0].stay_quality.nearby_restaurant_count, 8);
      assert.strictEqual(results[0].stay_quality.walkability_proxy, 'good');
      assert.ok(results[0].stay_quality.amenity_keys.includes('wifi'));
      assert.ok(results[0].stay_quality.components.google_rating > 0);

      const calls = mockPool.getCalls();
      const qualityCall = calls.find(c => c.sql.includes('COUNT(r.osm_id)::int as nearby_restaurant_count'));
      assert.ok(qualityCall, 'Should query nearby restaurant density for hotels');
      assert.ok(qualityCall.sql.includes('ST_DWithin'), 'Should use spatial distance for nearby restaurant density');
      assert.deepStrictEqual(qualityCall.params[0], [12345]);
      assert.ok(qualityCall.params[1].includes('restaurant'));
      assert.strictEqual(qualityCall.params[2], 1500);
    });

    it('should keep sparse hotel quality scores stable when enrichment fields are missing', () => {
      const score = TravelDatabase.computeStayQualityScore({
        osm_id: 12345,
        poi_type: 'hotel',
        osm_tags: { internet_access: 'wlan' },
      }, 0);

      assert.strictEqual(score.score, 6);
      assert.strictEqual(score.confidence, 'low');
      assert.strictEqual(score.components.google_rating, null);
      assert.strictEqual(score.components.review_volume, null);
      assert.strictEqual(score.components.star_classification, null);
      assert.strictEqual(score.components.amenity_richness, 13);
      assert.strictEqual(score.nearby_restaurant_count, 0);
      assert.strictEqual(score.walkability_proxy, 'limited');
    });
  });

  describe('getNeighborhoodScore', () => {
    it('should count neighborhood categories with a spatial query and return a score breakdown', async () => {
      mockPool.setResponse('WHERE osm_id = $1', dbResult([{
        osm_id: 12345,
        poi_type: 'hotel',
        name: 'Grand Hotel Bangkok',
        latitude: 13.75,
        longitude: 100.5,
      }]));
      mockPool.setResponse('SELECT category, COUNT(*)::int as count', dbResult([
        { category: 'restaurants', count: 10 },
        { category: 'cafes', count: 2 },
        { category: 'bars', count: 3 },
        { category: 'groceries', count: 1 },
        { category: 'pharmacies', count: 1 },
        { category: 'transit', count: 4 },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getNeighborhoodScore({ osmId: 12345 });

      assert.strictEqual(result.source.osm_id, 12345);
      assert.strictEqual(result.score, 78);
      assert.strictEqual(result.label, 'very_good');
      assert.strictEqual(result.total_nearby_pois, 21);
      assert.strictEqual(result.categories.restaurants.count, 10);
      assert.strictEqual(result.categories.restaurants.score, 100);
      assert.strictEqual(result.categories.cafes.score, 50);
      assert.strictEqual(result.categories.transit.weight, 20);

      const calls = mockPool.getCalls();
      const countCall = calls.find(c => c.sql.includes('SELECT category, COUNT(*)::int as count'));
      assert.ok(countCall, 'Should query category counts');
      assert.ok(countCall.sql.includes('ST_DWithin'), 'Should use a spatial radius query');
      assert.ok(countCall.sql.includes("THEN 'restaurants'"), 'Should categorize restaurants');
      assert.ok(countCall.sql.includes("THEN 'transit'"), 'Should categorize transit');
      assert.strictEqual(countCall.params[0], 13.75);
      assert.strictEqual(countCall.params[1], 100.5);
      assert.strictEqual(countCall.params[2], 1500);
      assert.ok(countCall.params.some(param => Array.isArray(param) && param.includes('pharmacy')));
      assert.ok(countCall.params.some(param => Array.isArray(param) && param.includes('bus_stop')));
    });

    it('should score arbitrary coordinates and clamp the radius', async () => {
      mockPool.setResponse('SELECT category, COUNT(*)::int as count', dbResult([
        { category: 'restaurants', count: 1 },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getNeighborhoodScore({ latitude: 13.75, longitude: 100.5, radiusKm: 99 });

      assert.deepStrictEqual(result.source, { latitude: 13.75, longitude: 100.5 });
      assert.strictEqual(result.radius_km, 5);
      assert.strictEqual(result.categories.restaurants.count, 1);
      assert.strictEqual(result.categories.pharmacies.count, 0);
      assert.strictEqual(result.label, 'sparse');
    });

    it('should return null when neighborhood source POI is missing', async () => {
      mockPool.setResponse('WHERE osm_id = $1', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getNeighborhoodScore({ osmId: 99999 });

      assert.strictEqual(result, null);
    });
  });

  describe('buildItinerary', () => {
    it('should build deterministic day plans from clustered spatial candidates', async () => {
      mockPool.setResponse('WHERE osm_id = $1', dbResult([{
        osm_id: 12345,
        poi_type: 'hotel',
        name: 'Grand Hotel Bangkok',
        latitude: 13.75,
        longitude: 100.5,
      }]));
      mockPool.setResponse('ST_ClusterKMeans', dbResult([
        { osm_id: 1, poi_type: 'museum', name: 'City Museum', latitude: 13.751, longitude: 100.501, itinerary_category: 'attraction', distance_from_hotel_km: 0.2, cluster_id: 0 },
        { osm_id: 2, poi_type: 'restaurant', name: 'Local Kitchen', latitude: 13.752, longitude: 100.502, itinerary_category: 'food', distance_from_hotel_km: 0.3, cluster_id: 0 },
        { osm_id: 3, poi_type: 'gallery', name: 'River Gallery', latitude: 13.761, longitude: 100.511, itinerary_category: 'attraction', distance_from_hotel_km: 1.6, cluster_id: 1 },
        { osm_id: 4, poi_type: 'cafe', name: 'Canal Cafe', latitude: 13.762, longitude: 100.512, itinerary_category: 'food', distance_from_hotel_km: 1.7, cluster_id: 1 },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.buildItinerary({
        hotelOsmId: 12345,
        interests: ['museums', 'local_food'],
        days: 2,
      });

      assert.strictEqual(result.hotel.osm_id, 12345);
      assert.strictEqual(result.days, 2);
      assert.deepStrictEqual(result.interests, ['museums', 'local_food']);
      assert.strictEqual(result.candidate_count, 4);
      assert.strictEqual(result.itinerary.length, 2);
      assert.strictEqual(result.itinerary[0].day, 1);
      assert.strictEqual(result.itinerary[0].stops[0].name, 'City Museum');
      assert.strictEqual(result.itinerary[0].stops[1].category, 'food');
      assert.strictEqual(result.itinerary[1].stops[0].name, 'River Gallery');
      assert.ok(result.itinerary[0].center);

      const calls = mockPool.getCalls();
      const itineraryCall = calls.find(c => c.sql.includes('ST_ClusterKMeans'));
      assert.ok(itineraryCall, 'Should use PostGIS clustering for itinerary candidates');
      assert.ok(itineraryCall.sql.includes('ST_DWithin'), 'Should constrain itinerary candidates spatially');
      assert.ok(itineraryCall.sql.includes('distance_from_hotel_km'), 'Should compute distance from hotel');
      assert.deepStrictEqual(itineraryCall.params[0], 12345);
      assert.ok(itineraryCall.params[3].includes('museum'));
      assert.ok(itineraryCall.params[3].includes('restaurant'));
      assert.strictEqual(itineraryCall.params[9], 2);
    });

    it('should return null when itinerary hotel is missing', async () => {
      mockPool.setResponse('WHERE osm_id = $1', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.buildItinerary({ hotelOsmId: 99999 });

      assert.strictEqual(result, null);
    });
  });

  describe('planDining', () => {
    it('should build a clustered dining plan with dietary and budget filters', async () => {
      mockPool.setResponse('geonames_cities', dbResult([{
        name: 'Tokyo',
        country_code: 'JP',
        latitude: 35.6762,
        longitude: 139.6503,
        population: 13960000,
      }]));
      mockPool.setResponse('ST_ClusterKMeans', dbResult([
        { osm_id: 1, poi_type: 'cafe', name: 'Morning Cafe', latitude: 35.67, longitude: 139.65, osm_cuisine: 'coffee_shop', google_rating: 4.4, google_price_level: 'PRICE_LEVEL_MODERATE', distance_from_city_center_km: 0.2, google_opening_hours: { periods: [] }, cluster_id: 0 },
        { osm_id: 2, poi_type: 'restaurant', name: 'Soba House', latitude: 35.671, longitude: 139.651, osm_cuisine: 'japanese;soba', google_rating: 4.6, google_price_level: 'PRICE_LEVEL_MODERATE', distance_from_city_center_km: 0.3, osm_opening_hours: 'Mo-Su 11:00-22:00', cluster_id: 0 },
        { osm_id: 3, poi_type: 'restaurant', name: 'Veggie Table', latitude: 35.672, longitude: 139.652, osm_cuisine: 'vegetarian', google_rating: 4.5, google_price_level: 'PRICE_LEVEL_INEXPENSIVE', distance_from_city_center_km: 0.4, cluster_id: 0 },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.planDining({
        cityName: 'Tokyo',
        countryCode: 'JP',
        days: 1,
        dietary: ['vegetarian'],
        budget: 'moderate',
        varietyPreference: 'high',
      });

      assert.strictEqual(result.city, 'Tokyo');
      assert.strictEqual(result.days, 1);
      assert.deepStrictEqual(result.dietary, ['vegetarian']);
      assert.strictEqual(result.budget, 'moderate');
      assert.deepStrictEqual(result.price_levels, ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE']);
      assert.strictEqual(result.candidate_count, 3);
      assert.strictEqual(result.opening_hours_considered, true);
      assert.strictEqual(result.plan[0].meals.length, 3);
      assert.strictEqual(result.plan[0].meals[0].meal, 'breakfast');
      assert.strictEqual(result.plan[0].meals[0].restaurant.name, 'Morning Cafe');
      assert.strictEqual(result.plan[0].meals[0].restaurant.opening_hours_available, true);

      const calls = mockPool.getCalls();
      const diningCall = calls.find(c => c.sql.includes('ST_ClusterKMeans') && c.sql.includes('google_opening_hours'));
      assert.ok(diningCall, 'Should query clustered dining candidates with opening hours');
      assert.ok(diningCall.sql.includes('ST_DWithin'), 'Should constrain dining candidates spatially');
      assert.ok(diningCall.sql.includes("p.tags->>$"), 'Should apply dietary tag filters');
      assert.ok(diningCall.params.includes('diet:vegetarian'), 'Should bind dietary tag key');
      assert.deepStrictEqual(diningCall.params[3], ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court']);
      assert.strictEqual(diningCall.params[5], 1);
    });

    it('should return sparse empty meal slots when dining data is limited', async () => {
      mockPool.setResponse('geonames_cities', dbResult([{
        name: 'Tokyo',
        country_code: 'JP',
        latitude: 35.6762,
        longitude: 139.6503,
        population: 13960000,
      }]));
      mockPool.setResponse('ST_ClusterKMeans', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.planDining({ cityName: 'Tokyo', days: 2 });

      assert.strictEqual(result.sparse_data, true);
      assert.strictEqual(result.plan.length, 2);
      assert.strictEqual(result.plan[0].meals[0].restaurant, null);
    });

    it('should return null when dining city is missing', async () => {
      mockPool.setResponse('geonames_cities', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.planDining({ cityName: 'Atlantis' });

      assert.strictEqual(result, null);
    });
  });

  describe('searchPOIsNearCoordinates', () => {
    it('should search POIs near coordinates', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(13.75, 100.5, 10);

      assert.ok(Array.isArray(results));
      assert.ok(mockPool.wasCalled('ST_DWithin'));
    });

    it('should filter by type', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['hotel'], 50
      );

      assert.ok(Array.isArray(results));
    });

    it('should respect limit parameter', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, null, 5
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.params?.includes(5)
      );
      assert.ok(searchCall, 'Should pass limit to query');
    });

    it('should exclude specified OSM IDs', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, null, 50, null, [12345]
      );

      assert.ok(Array.isArray(results));
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('osm_id != ALL')
      );
      assert.ok(searchCall, 'Should include osm_id != ALL clause');
      assert.ok(searchCall.params.some(p => Array.isArray(p) && p.includes(12345)),
        'Should pass excludeOsmIds array as parameter');
    });

    it('should not include exclude clause when excludeOsmIds is null', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(13.75, 100.5, 10);

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin')
      );
      assert.ok(searchCall, 'Should have ST_DWithin query');
      assert.ok(!searchCall.sql.includes('osm_id != ALL'),
        'Should NOT include exclude clause when param is null');
    });

    it('should handle fractional radius (non-integer km)', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 1.5, null, 5
      );

      assert.ok(Array.isArray(results));
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin')
      );
      assert.ok(searchCall, 'Should have ST_DWithin query');
      assert.ok(searchCall.params.includes(1.5),
        'Should pass fractional radius as parameter');
      assert.ok(searchCall.sql.includes('::float8'),
        'Should cast radius to float8 to handle non-integer values');
    });

    it('should pass both typeFilter and excludeOsmIds together', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 1.5, ['restaurant', 'cafe'], 5, null, [12345]
      );

      assert.ok(Array.isArray(results));
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin')
      );
      assert.ok(searchCall.sql.includes('poi_type = ANY'),
        'Should include type filter');
      assert.ok(searchCall.sql.includes('osm_id != ALL'),
        'Should include exclude clause');
      // Verify parameter ordering: [lat, lon, radius, typeFilter, excludeOsmIds, limit]
      assert.strictEqual(searchCall.params[0], 13.75, 'First param should be latitude');
      assert.strictEqual(searchCall.params[1], 100.5, 'Second param should be longitude');
      assert.strictEqual(searchCall.params[2], 1.5, 'Third param should be radius');
      assert.deepStrictEqual(searchCall.params[3], ['restaurant', 'cafe'], 'Fourth param should be type filter');
      assert.deepStrictEqual(searchCall.params[4], [12345], 'Fifth param should be excludeOsmIds');
      assert.strictEqual(searchCall.params[5], 5, 'Sixth param should be limit');
    });

    it('should add cuisine filters to coordinate searches', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant'], 20, null, null, { cuisine: ['thai', 'japanese'] }
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes('p.cuisine ILIKE')
      );
      assert.ok(searchCall, 'Should include cuisine filter in coordinate query');
      assert.ok(searchCall.params.includes('%thai%'), 'Should bind thai cuisine');
      assert.ok(searchCall.params.includes('%japanese%'), 'Should bind japanese cuisine');
    });

    it('should add dietary filters to coordinate searches', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant'], 20, null, null, { dietary: ['vegan', 'kosher'] }
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes("p.tags->>$")
      );
      assert.ok(searchCall, 'Should include dietary filter in coordinate query');
      assert.ok(searchCall.params.includes('diet:vegan'), 'Should bind vegan tag key');
      assert.ok(searchCall.params.includes('diet:kosher'), 'Should bind kosher tag key');
    });

    it('should add hotel chain filters to coordinate searches', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['hotel'], 20, null, null, { chain: 'Hilton' }
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes('hotel_chains')
      );
      assert.ok(searchCall, 'Should include chain filter in coordinate query');
      assert.ok(searchCall.params.includes('Hilton'), 'Should bind chain name');
    });

    it('should add hotel intent filters to coordinate searches', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[0]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['hotel'], 20, null, null, { intent: 'accessible' }
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes("p.wheelchair IN ('yes', 'limited')")
      );
      assert.ok(searchCall, 'Should include accessible intent filter in coordinate query');
      assert.strictEqual(results[0].hotel_intent, 'accessible');
      assert.match(results[0].hotel_intent_explanation, /wheelchair accessibility/);
    });

    it('should post-filter coordinate searches by Google price level', async () => {
      mockPool.setResponse('osm_pois', dbResult(samplePOIs));
      mockPool.setResponse('google_places', dbResult([
        { osm_id: 12345, google_price_level: 'PRICE_LEVEL_MODERATE', google_name: 'Grand Hotel Bangkok' },
        { osm_id: 12346, google_price_level: 'PRICE_LEVEL_INEXPENSIVE', google_name: 'Thai Kitchen' },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant'], 20, null, null, { priceLevel: 2 }, false, 5
      );

      assert.deepStrictEqual(results.map(p => p.osm_id), [12345]);
      const calls = mockPool.getCalls();
      const searchCall = calls.find(c => c.sql.includes('osm_pois') && c.sql.includes('ST_DWithin'));
      assert.strictEqual(searchCall.params.at(-2), 60, 'Should over-fetch for price post-filtering');
      assert.strictEqual(searchCall.params.at(-1), 0, 'Should reset offset when post-filtering by price');
    });

    it('should add restaurant occasion filters to coordinate searches', async () => {
      mockPool.setResponse('osm_pois', dbResult([samplePOIs[1]]));

      db = new TravelDatabase({ pool: mockPool });
      const results = await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant', 'bar'], 20, null, null, { occasion: 'late_night' }, false, 5
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes("p.opening_hours ILIKE '%24/7%'")
      );
      assert.ok(searchCall, 'Should include late night opening-hours clauses');
      assert.strictEqual(searchCall.params.at(-2), 60, 'Should over-fetch for occasion post-filtering');
      assert.strictEqual(searchCall.params.at(-1), 0, 'Should reset offset for occasion post-filtering');
      assert.strictEqual(results[0].restaurant_occasion, 'late_night');
    });

    it('should over-fetch coordinate searches when filtering by open_at', async () => {
      mockPool.setResponse('osm_pois', dbResult([
        { ...samplePOIs[1], osm_opening_hours: 'Mo-Su 10:00-22:00' },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      await db.searchPOIsNearCoordinates(
        13.75, 100.5, 10, ['restaurant'], 20, null, null, null, false, 10, new Date(2026, 4, 18, 12, 0)
      );

      const calls = mockPool.getCalls();
      const searchCall = calls.find(c =>
        c.sql.includes('osm_pois') &&
        c.sql.includes('ST_DWithin') &&
        c.sql.includes('p.opening_hours as osm_opening_hours')
      );
      assert.ok(searchCall, 'Should select OSM opening_hours for fallback filtering');
      assert.strictEqual(searchCall.params.at(-2), 60, 'Should over-fetch for post-filtering');
      assert.strictEqual(searchCall.params.at(-1), 0, 'Should reset offset when post-filtering by hours');
    });

    it('should filter by Google hours first and OSM opening_hours as fallback', () => {
      db = new TravelDatabase({ pool: mockPool });
      const openAt = new Date(2026, 4, 18, 12, 0);

      const results = db.filterOpenAt([
        {
          osm_id: 1,
          google_opening_hours: {
            periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
          },
          google_utc_offset_minutes: 0,
          osm_opening_hours: 'Mo-Fr 00:00-01:00',
        },
        {
          osm_id: 2,
          google_opening_hours: null,
          google_utc_offset_minutes: null,
          osm_opening_hours: 'Mo-Fr 10:00-22:00',
        },
        {
          osm_id: 3,
          google_opening_hours: null,
          google_utc_offset_minutes: null,
          osm_opening_hours: null,
        },
      ], openAt);

      assert.deepStrictEqual(results.map(p => p.osm_id), [1, 2]);
    });
  });

  describe('getPOIDetails', () => {
    const samplePOIDetail = {
      osm_id: 12345,
      poi_type: 'hotel',
      osm_name: 'Grand Hotel Bangkok',
      google_name: 'Grand Hotel Bangkok',
      osm_latitude: 13.75,
      osm_longitude: 100.5,
      city: 'Bangkok',
      country_code: 'TH',
      google_place_id: 'ChIJ123',
      google_rating: 4.5,
      google_review_count: 1200,
      mapping_status: 'active',
    };

    it('should get POI details by OSM ID', async () => {
      mockPool.setResponse('enriched_pois', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.strictEqual(result.osm_id, 12345);
    });

    it('should get POI details by Google Place ID', async () => {
      mockPool.setResponse('google_place_id', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(null, 'ChIJ123');

      assert.ok(result);
    });

    it('should return null when POI not found', async () => {
      mockPool.setResponse('enriched_pois', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(99999);

      assert.strictEqual(result, null);
    });

    it('should return null when no ID provided', async () => {
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails();

      assert.strictEqual(result, null);
    });

    it('should include enrichment status for active mapping', async () => {
      mockPool.setResponse('enriched_pois', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result._enrichment, 'Should have _enrichment object');
      assert.strictEqual(result._enrichment.status, 'complete');
    });

    it('should report pending enrichment status', async () => {
      const pendingPOI = { ...samplePOIDetail, mapping_status: 'pending', mapped_at: new Date() };
      mockPool.setResponse('enriched_pois', dbResult([pendingPOI]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result._enrichment, 'Should have _enrichment object');
      assert.strictEqual(result._enrichment.status, 'pending');
      assert.ok(result._enrichment.message?.includes('in progress'));
    });

    it('should not repeatedly restart stale pending enrichment while polling', async () => {
      const stalePendingPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: 'pending',
        mapped_at: new Date(Date.now() - 10 * 60 * 1000),
      };
      mockPool.setResponse('enriched_pois', dbResult([stalePendingPOI]));

      db = new TravelDatabase({ pool: mockPool });
      const enrichmentCalls = [];
      db.enrichOSMPOI = async (...args) => {
        enrichmentCalls.push(args);
      };

      const first = await db.getPOIDetails(12345);
      await new Promise(resolve => setImmediate(resolve));
      const second = await db.getPOIDetails(12345);

      assert.strictEqual(first._enrichment.status, 'pending');
      assert.ok(first._enrichment.message?.includes('restarted'));
      assert.strictEqual(second._enrichment.status, 'pending');
      assert.ok(second._enrichment.message?.includes('in progress'));
      assert.strictEqual(mockPool.callCount('UPDATE osm_google_mappings SET mapped_at = CURRENT_TIMESTAMP'), 1);
      assert.deepStrictEqual(enrichmentCalls, [[12345, { forcePending: true }]]);
    });

    it('should force internally queued pending enrichment to run', async () => {
      const unenrichedPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: null,
        mapped_at: null,
      };
      mockPool.setResponse('enriched_pois', dbResult([unenrichedPOI]));

      db = new TravelDatabase({ pool: mockPool });
      db.googlePlaces = { isEnabled: () => true };
      db.googlePlacesReady = Promise.resolve();
      db.checkGoogleApiLimit = async () => ({ allowed: true, current: 0, limit: 500, remaining: 500 });
      const enrichmentCalls = [];
      db.enrichOSMPOI = async (...args) => {
        enrichmentCalls.push(args);
      };

      const result = await db.getPOIDetails(12345);
      await new Promise(resolve => setImmediate(resolve));

      assert.strictEqual(result._enrichment.status, 'pending');
      assert.ok(result._enrichment.message?.includes('started'));
      assert.deepStrictEqual(enrichmentCalls, [[12345, { forcePending: true }]]);
    });

    it('should not restart stale pending enrichment when daily quota is exhausted', async () => {
      const stalePendingPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: 'pending',
        mapped_at: new Date(Date.now() - 10 * 60 * 1000),
      };
      mockPool.setResponse('enriched_pois', dbResult([stalePendingPOI]));

      db = new TravelDatabase({ pool: mockPool });
      db.checkGoogleApiLimit = async () => ({ allowed: false, current: 500, limit: 500, remaining: 0 });

      const result = await db.getPOIDetails(12345);

      assert.strictEqual(result._enrichment.status, 'pending');
      assert.ok(result._enrichment.message?.includes('daily API limit'));
      assert.strictEqual(mockPool.callCount('UPDATE osm_google_mappings SET mapped_at = CURRENT_TIMESTAMP'), 0);
      const quotaCall = mockPool.getCalls().find(call =>
        call.sql.includes('INSERT INTO osm_google_mappings') &&
        call.params?.includes('pending')
      );
      assert.ok(quotaCall, 'Should keep the mapping pending instead of marking a POI-specific failure');
      assert.ok(quotaCall.params.some(param => param instanceof Date), 'Should schedule a retry after quota reset');
    });

    it('should not restart pending enrichment before next_enrichment_at', async () => {
      const pausedPendingPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: 'pending',
        mapping_notes: 'Google Places enrichment is paused because the daily API limit has been reached (500/500).',
        mapped_at: new Date(Date.now() - 10 * 60 * 1000),
        next_enrichment_at: new Date(Date.now() + 60 * 60 * 1000),
      };
      mockPool.setResponse('enriched_pois', dbResult([pausedPendingPOI]));

      db = new TravelDatabase({ pool: mockPool });
      db.checkGoogleApiLimit = async () => {
        throw new Error('quota should not be checked while retry is deferred');
      };

      const result = await db.getPOIDetails(12345);

      assert.strictEqual(result._enrichment.status, 'pending');
      assert.ok(result._enrichment.message?.includes('daily API limit'));
      assert.strictEqual(mockPool.callCount('UPDATE osm_google_mappings SET mapped_at = CURRENT_TIMESTAMP'), 0);
    });

    it('should not start new enrichment when daily quota is exhausted', async () => {
      const unenrichedPOI = {
        ...samplePOIDetail,
        google_place_id: null,
        mapping_status: null,
        mapped_at: null,
      };
      mockPool.setResponse('enriched_pois', dbResult([unenrichedPOI]));

      db = new TravelDatabase({ pool: mockPool });
      db.googlePlaces = { isEnabled: () => true };
      db.googlePlacesReady = Promise.resolve();
      db.checkGoogleApiLimit = async () => ({ allowed: false, current: 500, limit: 500, remaining: 0 });

      const result = await db.getPOIDetails(12345);

      assert.strictEqual(result._enrichment.status, 'pending');
      assert.ok(result._enrichment.message?.includes('daily API limit'));
      assert.strictEqual(mockPool.callCount("VALUES ($1, 'pending', CURRENT_TIMESTAMP)"), 0);
      const quotaCall = mockPool.getCalls().find(call =>
        call.sql.includes('INSERT INTO osm_google_mappings') &&
        call.params?.includes('pending')
      );
      assert.ok(quotaCall, 'Should keep the mapping pending instead of marking a POI-specific failure');
      assert.ok(quotaCall.params.some(param => param instanceof Date), 'Should schedule a retry after quota reset');
    });

    it('should report failed enrichment for not_found status', async () => {
      const notFoundPOI = { ...samplePOIDetail, mapping_status: 'not_found', google_place_id: null };
      mockPool.setResponse('enriched_pois', dbResult([notFoundPOI]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result._enrichment, 'Should have _enrichment object');
      assert.strictEqual(result._enrichment.status, 'failed');
      assert.ok(result._enrichment.message?.includes('no matching location'));
    });

    it('should preserve Date fields (not convert to empty objects)', async () => {
      const enrichedAt = new Date('2025-06-15T12:00:00Z');
      const cacheExpires = new Date('2025-06-22T12:00:00Z');
      const poiWithDates = {
        ...samplePOIDetail,
        google_enriched_at: enrichedAt,
        google_cache_expires_at: cacheExpires,
        mapped_at: new Date('2025-06-15T11:00:00Z'),
      };
      mockPool.setResponse('enriched_pois', dbResult([poiWithDates]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.ok(result.google_enriched_at instanceof Date, 'google_enriched_at should remain a Date');
      assert.ok(result.google_cache_expires_at instanceof Date, 'google_cache_expires_at should remain a Date');
      assert.strictEqual(result.google_enriched_at.toISOString(), enrichedAt.toISOString());
      assert.strictEqual(result.google_cache_expires_at.toISOString(), cacheExpires.toISOString());
    });

    it('should remove null fields but preserve all non-null values', async () => {
      const poiWithNulls = {
        ...samplePOIDetail,
        osm_phone: null,
        osm_email: null,
        osm_website: 'https://example.com',
        google_rating: 4.5,
        osm_stars: 0,
      };
      mockPool.setResponse('enriched_pois', dbResult([poiWithNulls]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result);
      assert.strictEqual(result.osm_phone, undefined, 'Null fields should be removed');
      assert.strictEqual(result.osm_email, undefined, 'Null fields should be removed');
      assert.strictEqual(result.osm_website, 'https://example.com', 'Non-null strings should be preserved');
      assert.strictEqual(result.google_rating, 4.5, 'Numbers should be preserved');
      assert.strictEqual(result.osm_stars, 0, 'Falsy non-null values (0) should be preserved');
    });

    it('should preserve all field types through the full data pipeline', async () => {
      // Simulates a realistic enriched_pois row with every field type
      // that PostgreSQL/pg driver returns: strings, numbers, booleans,
      // Date objects, arrays, nested objects (JSONB), and nulls.
      const fullPOI = {
        // Core identifiers (integers, strings)
        osm_id: 12345,
        osm_type: 'node',
        poi_type: 'restaurant',

        // OSM string fields
        osm_name: 'Thai Kitchen',
        osm_address: '789 Silom Road, Bangkok',
        osm_phone: '+66 2 345 6789',
        osm_email: 'info@thaikitchen.com',
        osm_website: 'https://thaikitchen.com',
        osm_opening_hours: 'Mo-Su 10:00-22:00',
        osm_cuisine: 'thai;international',
        osm_wheelchair: 'yes',
        osm_brand: 'Thai Kitchen',
        osm_operator: null, // null - should be stripped
        source_region: 'thailand',

        // OSM numeric fields (including zero and falsy values)
        osm_latitude: 13.7450,
        osm_longitude: 100.5300,
        osm_stars: 0, // falsy but valid
        osm_rooms: null, // null - should be stripped
        osm_beds: null, // null - should be stripped

        // OSM JSONB (nested object)
        osm_tags: { brand: 'Thai Kitchen', cuisine: 'thai;international', name: 'Thai Kitchen' },

        // OSM Date
        osm_imported_at: new Date('2025-01-15T10:00:00Z'),

        // City/country strings
        city: 'Bangkok',
        country_code: 'TH',
        city_geoname_id: 1609350,

        // Google Places string fields
        google_place_id: 'ChIJ456',
        google_name: 'Thai Kitchen Restaurant',
        google_display_name: { text: 'Thai Kitchen Restaurant', languageCode: 'en' }, // JSONB object
        google_address: '789 Silom Road, Bang Rak, Bangkok 10500',
        google_short_address: '789 Silom Road',
        google_international_phone: '+66 2 345 6789',
        google_phone: '02-345-6789',
        google_website: 'https://thaikitchen.com',
        google_maps_url: 'https://maps.google.com/?cid=123456',
        google_primary_type: 'restaurant',
        google_primary_type_display: 'Restaurant',
        google_editorial_summary: 'Authentic Thai cuisine in the heart of Silom.',
        google_price_level: 'PRICE_LEVEL_MODERATE',
        google_business_status: 'OPERATIONAL',
        google_plus_code: '7P52PG9R+5W',

        // Google Places numeric fields
        google_rating: 4.3,
        google_review_count: 850,
        google_latitude: 13.7451,
        google_longitude: 100.5301,
        google_utc_offset_minutes: 420,

        // Google Places JSONB arrays
        google_types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
        google_photos: [
          { name: 'places/ChIJ456/photos/abc', heightPx: 1200, widthPx: 1600 },
          { name: 'places/ChIJ456/photos/def', heightPx: 800, widthPx: 1200 },
        ],
        google_reviews: [
          {
            authorAttribution: { displayName: 'John Doe', uri: 'https://maps.google.com/user1' },
            rating: 5,
            text: { text: 'Best Thai food in Bangkok!' },
            relativePublishTimeDescription: '2 weeks ago',
          },
          {
            authorAttribution: { displayName: 'Jane Smith' },
            rating: 4,
            text: { text: 'Great pad thai and green curry.' },
            relativePublishTimeDescription: '1 month ago',
          },
        ],
        google_address_components: [
          { longText: '789', shortText: '789', types: ['street_number'] },
          { longText: 'Silom Road', shortText: 'Silom Rd', types: ['route'] },
        ],

        // Google Places JSONB objects
        google_opening_hours: {
          openNow: true,
          weekdayDescriptions: ['Monday: 10:00–22:00', 'Tuesday: 10:00–22:00'],
        },
        google_current_opening_hours: { openNow: true },
        google_service_options: { dineIn: true, takeout: true, delivery: false },
        google_accessibility: { wheelchairAccessibleEntrance: true, wheelchairAccessibleSeating: true },
        google_amenities: {
          restroom: true,
          goodForChildren: true,
          paymentOptions: { acceptsCreditCards: true },
        },

        // Google Places Date fields
        google_enriched_at: new Date('2025-06-15T12:00:00Z'),
        google_cache_expires_at: new Date('2025-06-22T12:00:00Z'),

        // Mapping metadata (strings, numbers, Date)
        mapping_status: 'active',
        match_confidence: 0.95,
        match_method: 'name_proximity',
        match_distance_meters: 12.5,
        mapping_notes: null, // null - should be stripped
        mapped_at: new Date('2025-06-15T11:59:00Z'),
        last_verified_at: new Date('2025-06-15T12:00:00Z'),
      };

      mockPool.setResponse('enriched_pois', dbResult([fullPOI]));
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getPOIDetails(12345);

      assert.ok(result, 'Should return a result');

      // Strings preserved
      assert.strictEqual(result.osm_name, 'Thai Kitchen');
      assert.strictEqual(result.osm_cuisine, 'thai;international');
      assert.strictEqual(result.google_editorial_summary, 'Authentic Thai cuisine in the heart of Silom.');
      assert.strictEqual(result.google_place_id, 'ChIJ456');

      // Numbers preserved (including zero)
      assert.strictEqual(result.google_rating, 4.3);
      assert.strictEqual(result.google_review_count, 850);
      assert.strictEqual(result.osm_stars, 0, 'Zero should be preserved');
      assert.strictEqual(result.match_confidence, 0.95);
      assert.strictEqual(result.match_distance_meters, 12.5);
      assert.strictEqual(result.google_utc_offset_minutes, 420);

      // Null fields stripped
      assert.strictEqual(result.osm_operator, undefined, 'Null string should be stripped');
      assert.strictEqual(result.osm_rooms, undefined, 'Null number should be stripped');
      assert.strictEqual(result.mapping_notes, undefined, 'Null should be stripped');

      // Date objects preserved as Dates (not empty objects)
      assert.ok(result.google_enriched_at instanceof Date, 'google_enriched_at should be Date');
      assert.ok(result.google_cache_expires_at instanceof Date, 'google_cache_expires_at should be Date');
      assert.ok(result.osm_imported_at instanceof Date, 'osm_imported_at should be Date');
      assert.ok(result.mapped_at instanceof Date, 'mapped_at should be Date');
      assert.ok(result.last_verified_at instanceof Date, 'last_verified_at should be Date');
      assert.strictEqual(result.google_enriched_at.toISOString(), '2025-06-15T12:00:00.000Z');

      // Arrays preserved
      assert.ok(Array.isArray(result.google_types), 'google_types should be array');
      assert.strictEqual(result.google_types.length, 4);
      assert.strictEqual(result.google_types[0], 'restaurant');
      assert.ok(Array.isArray(result.google_photos), 'google_photos should be array');
      assert.strictEqual(result.google_photos.length, 2);
      assert.ok(Array.isArray(result.google_reviews), 'google_reviews should be array');
      assert.strictEqual(result.google_reviews.length, 2);
      assert.ok(Array.isArray(result.google_address_components), 'google_address_components should be array');

      // Nested objects preserved with structure intact
      assert.strictEqual(typeof result.google_display_name, 'object');
      assert.strictEqual(result.google_display_name.text, 'Thai Kitchen Restaurant');
      assert.strictEqual(result.google_display_name.languageCode, 'en');

      assert.strictEqual(typeof result.google_opening_hours, 'object');
      assert.strictEqual(result.google_opening_hours.openNow, true);
      assert.ok(Array.isArray(result.google_opening_hours.weekdayDescriptions));

      assert.strictEqual(typeof result.google_service_options, 'object');
      assert.strictEqual(result.google_service_options.dineIn, true);
      assert.strictEqual(result.google_service_options.delivery, false, 'Boolean false should be preserved');

      assert.strictEqual(typeof result.google_amenities, 'object');
      assert.strictEqual(result.google_amenities.restroom, true);
      assert.strictEqual(result.google_amenities.paymentOptions.acceptsCreditCards, true, 'Deeply nested values should be preserved');

      assert.strictEqual(typeof result.osm_tags, 'object');
      assert.strictEqual(result.osm_tags.brand, 'Thai Kitchen');

      // Nested objects inside arrays preserved
      assert.strictEqual(result.google_reviews[0].authorAttribution.displayName, 'John Doe');
      assert.strictEqual(result.google_reviews[0].rating, 5);
      assert.strictEqual(result.google_reviews[0].text.text, 'Best Thai food in Bangkok!');
      assert.strictEqual(result.google_photos[0].name, 'places/ChIJ456/photos/abc');

      // Enrichment metadata added
      assert.ok(result._enrichment, 'Should have _enrichment');
      assert.strictEqual(result._enrichment.status, 'complete');
    });
  });

  describe('getDiningBudget', () => {
    it('should aggregate city dining budget by Google price level', async () => {
      mockPool.setResponse('geonames_cities', dbResult([{
        geoname_id: 2988507,
        name: 'Paris',
        country_code: 'FR',
        latitude: 48.8566,
        longitude: 2.3522,
        population: 2148000,
      }]));
      mockPool.setResponse('google_places', dbResult([
        { google_price_level: 'PRICE_LEVEL_INEXPENSIVE', count: 3 },
        { google_price_level: 'PRICE_LEVEL_MODERATE', count: 12 },
        { google_price_level: 'PRICE_LEVEL_EXPENSIVE', count: 5 },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getDiningBudget({ cityName: 'Paris', countryCode: 'FR' });

      assert.strictEqual(result.city, 'Paris');
      assert.strictEqual(result.country_code, 'FR');
      assert.strictEqual(result.sample_size, 20);
      assert.strictEqual(result.data_quality, 'good');
      assert.deepStrictEqual(result.estimated_usd_per_person, {
        currency: 'USD',
        low: 8,
        median: 30,
        high: 110,
      });
      assert.strictEqual(result.price_levels.length, 3);
    });

    it('should mark sparse dining budget data without returning ranges', async () => {
      mockPool.setResponse('geonames_cities', dbResult([{
        geoname_id: 1609350,
        name: 'Bangkok',
        country_code: 'TH',
        latitude: 13.75,
        longitude: 100.5,
        population: 8000000,
      }]));
      mockPool.setResponse('google_places', dbResult([
        { google_price_level: 'PRICE_LEVEL_MODERATE', count: 2 },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getDiningBudget({ cityName: 'Bangkok', countryCode: 'TH', cuisine: ['thai'] });

      assert.strictEqual(result.sample_size, 2);
      assert.strictEqual(result.data_quality, 'sparse');
      assert.strictEqual(result.estimated_usd_per_person, null);
      const calls = mockPool.getCalls();
      const budgetCall = calls.find(c => c.sql.includes('g.price_level') && c.sql.includes('p.cuisine ILIKE'));
      assert.ok(budgetCall, 'Should filter budget estimates by cuisine');
      assert.ok(budgetCall.params.includes('%thai%'));
    });
  });

  describe('findFoodDistricts', () => {
    it('should build a PostGIS clustering query for food districts', async () => {
      mockPool.setResponse('geonames_cities', dbResult([{
        geoname_id: 1609350,
        name: 'Bangkok',
        country_code: 'TH',
        latitude: 13.75,
        longitude: 100.5,
        population: 8000000,
      }]));
      mockPool.setResponse('ST_ClusterDBSCAN', dbResult([{
        cluster_id: 0,
        name: 'Sukhumvit',
        restaurant_count: 12,
        centroid_latitude: 13.74,
        centroid_longitude: 100.56,
        top_cuisines: ['thai', 'japanese'],
        price_range: ['PRICE_LEVEL_MODERATE'],
        name_source: 'nearest_landmark',
      }]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.findFoodDistricts({
        cityName: 'Bangkok',
        countryCode: 'TH',
        minRestaurants: 6,
        limit: 4,
      });

      const calls = mockPool.getCalls();
      const clusterCall = calls.find(c => c.sql.includes('ST_ClusterDBSCAN'));
      assert.ok(clusterCall, 'Should use ST_ClusterDBSCAN');
      assert.ok(clusterCall.sql.includes('ST_Transform(location, 3857)'), 'Should cluster in projected meters');
      assert.ok(clusterCall.sql.includes('array_agg(DISTINCT cuisine)'), 'Should aggregate cuisines');
      assert.ok(clusterCall.sql.includes('google_price_level'), 'Should include price levels');
      assert.strictEqual(clusterCall.params[3], 350, 'Should use meter-based cluster radius');
      assert.strictEqual(clusterCall.params[4], 6, 'Should bind min restaurant count');
      assert.deepStrictEqual(result.districts[0].top_cuisines, ['thai', 'japanese']);
    });

    it('should return null when city is not found for food districts', async () => {
      mockPool.setResponse('geonames_cities', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.findFoodDistricts({ cityName: 'Atlantis' });

      assert.strictEqual(result, null);
    });
  });

  describe('addFavoriteStatus', () => {
    it('should return POIs unchanged when no userId', async () => {
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.addFavoriteStatus(samplePOIs, null);

      assert.deepStrictEqual(result, samplePOIs);
    });

    it('should return POIs unchanged when empty array', async () => {
      db = new TravelDatabase({ pool: mockPool });
      const result = await db.addFavoriteStatus([], 'user123');

      assert.deepStrictEqual(result, []);
    });

    it('should add favorite status to POIs', async () => {
      mockPool.setResponse('user_favorites', dbResult([
        { poi_osm_id: 12345, created_at: new Date(), notes: 'Great hotel!' }
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.addFavoriteStatus(samplePOIs, 'user123');

      assert.strictEqual(result[0].is_favorite, true);
      assert.strictEqual(result[0].favorite_notes, 'Great hotel!');
      assert.strictEqual(result[1].is_favorite, false);
    });
  });

  describe('getCityByName', () => {
    it('should return city when found', async () => {
      mockPool.setResponse('geonames_cities', dbResult([{
        geoname_id: 1609350,
        name: 'Bangkok',
        latitude: 13.75,
        longitude: 100.5,
      }]));

      db = new TravelDatabase({ pool: mockPool });
      const city = await db.getCityByName('Bangkok', 'TH');

      assert.ok(city);
      assert.strictEqual(city.name, 'Bangkok');
    });

    it('should return null when city not found', async () => {
      mockPool.setResponse('geonames_cities', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const city = await db.getCityByName('Nonexistent', 'XX');

      assert.strictEqual(city, null);
    });
  });

  describe('getRandomPOI', () => {
    const samplePOIDetail = {
      osm_id: 12345,
      poi_type: 'hotel',
      osm_name: 'Random Hotel',
      osm_latitude: 13.75,
      osm_longitude: 100.5,
      city: 'Bangkok',
      country_code: 'TH',
      google_place_id: 'ChIJ123',
      mapping_status: 'active',
    };

    it('should return random POI with Google enrichment', async () => {
      // Mock finding an enriched POI (now queries osm_google_mappings directly)
      mockPool.setResponse('osm_google_mappings', dbResult([{ osm_id: 12345 }]));
      // Mock getPOIDetails call
      mockPool.setResponse('WHERE osm_id', dbResult([samplePOIDetail]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.ok(result);
      assert.strictEqual(result.osm_id, 12345);
    });

    it('should fallback to non-enriched POI if no enriched ones exist', async () => {
      // First query returns empty (no enriched POIs via osm_google_mappings)
      mockPool.setResponse('mapping_status', emptyResult());
      // Fallback query finds a non-enriched POI
      mockPool.setResponse('osm_pois', dbResult([{ osm_id: 99999 }]));
      // getPOIDetails for that POI
      const noEnrichmentPOI = { ...samplePOIDetail, osm_id: 99999, google_place_id: null };
      mockPool.setResponse('WHERE osm_id', dbResult([noEnrichmentPOI]));

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.ok(result);
      assert.strictEqual(result.osm_id, 99999);
    });

    it('should return null when no POIs exist', async () => {
      mockPool.setResponse('osm_google_mappings', emptyResult());
      mockPool.setResponse('osm_pois', emptyResult());

      db = new TravelDatabase({ pool: mockPool });
      const result = await db.getRandomPOI();

      assert.strictEqual(result, null);
    });
  });

  describe('batchEnrichPOIs', () => {
    it('should enrich due POIs serially in database-scheduled order', async () => {
      mockPool.setResponse('FROM unnest', dbResult([
        { osm_id: 300 },
        { osm_id: 100 },
        { osm_id: 200 },
      ]));

      db = new TravelDatabase({ pool: mockPool });
      const calls = [];
      db.enrichOSMPOI = async (osmId) => {
        calls.push(osmId);
      };

      await db.batchEnrichPOIs([100, 200, 300]);

      assert.deepStrictEqual(calls, [300, 100, 200]);
    });
  });
});
