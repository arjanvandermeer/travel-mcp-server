/**
 * Unit Tests for GooglePlacesClient
 *
 * Tests the Google Places client initialization and helper methods.
 * Note: API request methods are tested via integration tests with mocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GooglePlacesClient } from '../../src/google-places.js';

describe('GooglePlacesClient', () => {
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

  describe('makeRequest', () => {
    it('should throw error when client is disabled', async () => {
      const client = new GooglePlacesClient(null, true);

      await assert.rejects(
        async () => client.makeRequest('https://example.com', {}, 'fields'),
        /Google Places API is not enabled/
      );
    });
  });

  describe('makeGetRequest', () => {
    it('should throw error when client is disabled', async () => {
      const client = new GooglePlacesClient(null, true);

      await assert.rejects(
        async () => client.makeGetRequest('https://example.com', 'fields'),
        /Google Places API is not enabled/
      );
    });
  });

  describe('getPhotoUrl', () => {
    it('should generate photo URL with dimensions', () => {
      const client = new GooglePlacesClient('test-api-key', true);
      const photoName = 'places/ChIJxxx/photos/AUc7xyz';
      const url = client.getPhotoUrl(photoName, 800, 600);

      assert.ok(url.includes('googleapis.com'));
      assert.ok(url.includes('800'));
      assert.ok(url.includes('600'));
      assert.ok(url.includes('test-api-key'));
    });

    it('should use default dimensions when not provided', () => {
      const client = new GooglePlacesClient('test-api-key', true);
      const photoName = 'places/ChIJxxx/photos/AUc7xyz';
      const url = client.getPhotoUrl(photoName);

      assert.ok(url.includes('googleapis.com'));
      // Default dimensions should be used
      assert.ok(url.includes('400') || url.includes('300'));
    });
  });
});
