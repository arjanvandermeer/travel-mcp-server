/**
 * Centralized input validation functions
 */

const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const INTEGER_PATTERN = /^[+]?\d+$/;

export function parseStrictNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStrictInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Validate and normalize latitude/longitude coordinates
 * @returns {{ valid: boolean, lat?: number, lon?: number, error?: string }}
 */
export function validateCoordinates(lat, lon) {
  const latNum = parseStrictNumber(lat);
  const lonNum = parseStrictNumber(lon);
  if (latNum === null || lonNum === null) return { valid: false, error: 'Invalid coordinate values' };
  if (latNum < -90 || latNum > 90) return { valid: false, error: 'Latitude must be between -90 and 90' };
  if (lonNum < -180 || lonNum > 180) return { valid: false, error: 'Longitude must be between -180 and 180' };
  return { valid: true, lat: latNum, lon: lonNum };
}

/**
 * Validate and clamp a limit value
 * @param {*} limit - Raw limit input
 * @param {number} defaultVal - Default if missing/invalid
 * @param {number} maxVal - Maximum allowed value
 * @returns {number}
 */
export function validateLimit(limit, defaultVal, maxVal) {
  if (limit === undefined || limit === null) return defaultVal;
  const parsed = parseStrictInteger(limit);
  if (parsed === null || parsed < 1) return defaultVal;
  return Math.min(parsed, maxVal);
}

export function validateRadiusKm(radius, defaultVal, maxVal) {
  if (radius === undefined || radius === null || radius === '') return defaultVal;
  const parsed = parseStrictNumber(radius);
  if (parsed === null || parsed <= 0) return defaultVal;
  return Math.min(parsed, maxVal);
}

/**
 * Validate country code (ISO 3166-1 alpha-2)
 * @param {*} code - Raw country code input
 * @returns {string|null} Uppercased 2-letter code or null if invalid
 */
export function validateCountryCode(code) {
  if (!code || typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  return upper;
}
