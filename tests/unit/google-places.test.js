/**
 * Unit Tests for GooglePlacesClient
 *
 * Tests the Google Places client initialization and helper methods.
 * Note: API request methods are tested via integration tests with mocks.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { GooglePlacesClient } from '../../src/google-places.js';

describe('GooglePlacesClient', () => {
  // Suppress console.warn during tests that intentionally test disabled clients
  let originalWarn;

  beforeEach(() => {
    originalWarn = console.warn;
    console.warn = () => {};
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

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

  describe('resolvePhotoUrl', () => {
    it('should return null when client is disabled', async () => {
      const client = new GooglePlacesClient(null, false);
      const photoName = 'places/ChIJxxx/photos/AUc7xyz';
      const url = await client.resolvePhotoUrl(photoName, 800, 600);

      assert.strictEqual(url, null);
    });

    it('should return null when photoName is empty', async () => {
      const client = new GooglePlacesClient('test-api-key', true);
      const url = await client.resolvePhotoUrl(null);

      assert.strictEqual(url, null);
    });
  });
});
