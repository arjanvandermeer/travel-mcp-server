import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUserPreferenceInput,
  userPreferencesFromConfig,
} from '../../src/user-preferences.js';

describe('user preferences', () => {
  it('normalizes currency, language, and home location', () => {
    const preferences = normalizeUserPreferenceInput({
      currency: 'usd',
      language: 'en-us',
      home_location: {
        city_name: '  New York ',
        country_code: 'us',
        state: 'NY',
        latitude: '40.7128',
        longitude: -74.006,
      },
    });

    assert.deepStrictEqual(preferences, {
      currency: 'USD',
      language: 'en-US',
      home_location: {
        city_name: 'New York',
        country_code: 'US',
        state: 'NY',
        latitude: 40.7128,
        longitude: -74.006,
      },
    });
  });

  it('requires at least one preference', () => {
    assert.throws(
      () => normalizeUserPreferenceInput({}),
      /At least one preference is required/
    );
  });

  it('rejects partial home coordinates', () => {
    assert.throws(
      () => normalizeUserPreferenceInput({ home_location: { latitude: 10 } }),
      /latitude and longitude must be provided together/
    );
  });

  it('parses home location from user config', () => {
    const preferences = userPreferencesFromConfig({
      currency: 'EUR',
      language: 'nl-NL',
      home_location: '{"city_name":"Amsterdam","country_code":"NL"}',
    });

    assert.deepStrictEqual(preferences, {
      currency: 'EUR',
      language: 'nl-NL',
      home_location: { city_name: 'Amsterdam', country_code: 'NL' },
    });
  });
});
