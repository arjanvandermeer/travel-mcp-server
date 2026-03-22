import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateCoordinates, validateLimit, validateCountryCode } from '../../src/validation.js';

describe('validateCoordinates', () => {
  it('should accept valid coordinates', () => {
    const result = validateCoordinates(40.7128, -74.006);
    assert.deepStrictEqual(result, { valid: true, lat: 40.7128, lon: -74.006 });
  });

  it('should accept string coordinates', () => {
    const result = validateCoordinates('51.5074', '-0.1278');
    assert.deepStrictEqual(result, { valid: true, lat: 51.5074, lon: -0.1278 });
  });

  it('should reject NaN latitude', () => {
    const result = validateCoordinates('abc', 10);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Invalid coordinate values');
  });

  it('should reject NaN longitude', () => {
    const result = validateCoordinates(10, 'xyz');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Invalid coordinate values');
  });

  it('should reject latitude > 90', () => {
    const result = validateCoordinates(91, 0);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Latitude must be between -90 and 90');
  });

  it('should reject latitude < -90', () => {
    const result = validateCoordinates(-91, 0);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Latitude must be between -90 and 90');
  });

  it('should reject longitude > 180', () => {
    const result = validateCoordinates(0, 181);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Longitude must be between -180 and 180');
  });

  it('should reject longitude < -180', () => {
    const result = validateCoordinates(0, -181);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Longitude must be between -180 and 180');
  });

  it('should accept edge case: 90, 180', () => {
    const result = validateCoordinates(90, 180);
    assert.deepStrictEqual(result, { valid: true, lat: 90, lon: 180 });
  });

  it('should accept edge case: -90, -180', () => {
    const result = validateCoordinates(-90, -180);
    assert.deepStrictEqual(result, { valid: true, lat: -90, lon: -180 });
  });
});

describe('validateLimit', () => {
  it('should return parsed value when valid', () => {
    assert.strictEqual(validateLimit(10, 5, 50), 10);
  });

  it('should parse string values', () => {
    assert.strictEqual(validateLimit('25', 5, 50), 25);
  });

  it('should return default for null', () => {
    assert.strictEqual(validateLimit(null, 5, 50), 5);
  });

  it('should return default for undefined', () => {
    assert.strictEqual(validateLimit(undefined, 5, 50), 5);
  });

  it('should return default for NaN', () => {
    assert.strictEqual(validateLimit('abc', 5, 50), 5);
  });

  it('should return default for negative value', () => {
    assert.strictEqual(validateLimit(-1, 5, 50), 5);
  });

  it('should return default for zero', () => {
    assert.strictEqual(validateLimit(0, 5, 50), 5);
  });

  it('should clamp to max', () => {
    assert.strictEqual(validateLimit(200, 5, 50), 50);
  });

  it('should allow value equal to max', () => {
    assert.strictEqual(validateLimit(50, 5, 50), 50);
  });
});

describe('validateCountryCode', () => {
  it('should accept valid uppercase code', () => {
    assert.strictEqual(validateCountryCode('US'), 'US');
  });

  it('should uppercase lowercase input', () => {
    assert.strictEqual(validateCountryCode('nl'), 'NL');
  });

  it('should trim whitespace', () => {
    assert.strictEqual(validateCountryCode(' TH '), 'TH');
  });

  it('should reject null', () => {
    assert.strictEqual(validateCountryCode(null), null);
  });

  it('should reject undefined', () => {
    assert.strictEqual(validateCountryCode(undefined), null);
  });

  it('should reject empty string', () => {
    assert.strictEqual(validateCountryCode(''), null);
  });

  it('should reject single character', () => {
    assert.strictEqual(validateCountryCode('A'), null);
  });

  it('should reject three characters', () => {
    assert.strictEqual(validateCountryCode('USA'), null);
  });

  it('should reject numeric input', () => {
    assert.strictEqual(validateCountryCode(42), null);
  });

  it('should reject codes with digits', () => {
    assert.strictEqual(validateCountryCode('U1'), null);
  });
});
