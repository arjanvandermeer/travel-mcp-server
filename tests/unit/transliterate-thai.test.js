/**
 * Tests for Thai transliteration helper
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getEnglishName } from '../../src/lib/transliterate-thai.js';

describe('getEnglishName', () => {
  it('should return null for null name', () => {
    assert.strictEqual(getEnglishName(null), null);
  });

  it('should return null for empty string', () => {
    assert.strictEqual(getEnglishName(''), null);
  });

  it('should return null for English-only name', () => {
    assert.strictEqual(getEnglishName('Grand Hotel'), null);
  });

  it('should transliterate Thai name', () => {
    const result = getEnglishName('ภูเก็ต');
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('should return expected transliteration for known place', () => {
    assert.strictEqual(getEnglishName('ภูเก็ต'), 'phuket');
  });

  it('should prefer tags name:en over transliteration', () => {
    const result = getEnglishName('ภูเก็ต', { 'name:en': 'Phuket' });
    assert.strictEqual(result, 'Phuket');
  });

  it('should fall back to transliteration when name:en is empty', () => {
    const result = getEnglishName('ภูเก็ต', { 'name:en': '' });
    assert.ok(result);
    assert.notStrictEqual(result, '');
  });

  it('should trim whitespace from name:en', () => {
    const result = getEnglishName('ภูเก็ต', { 'name:en': '  Phuket  ' });
    assert.strictEqual(result, 'Phuket');
  });

  it('should return null for non-Thai non-Latin script', () => {
    // Chinese characters - not Thai, should return null
    const result = getEnglishName('东京');
    assert.strictEqual(result, null);
  });

  it('should handle tags being undefined', () => {
    const result = getEnglishName('ภูเก็ต', undefined);
    assert.ok(result);
  });
});
