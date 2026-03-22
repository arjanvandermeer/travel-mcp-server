/**
 * Centralized input validation functions
 */

/**
 * Validate and normalize latitude/longitude coordinates
 * @returns {{ valid: boolean, lat?: number, lon?: number, error?: string }}
 */
export function validateCoordinates(lat, lon) {
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (isNaN(latNum) || isNaN(lonNum)) return { valid: false, error: 'Invalid coordinate values' };
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
  const parsed = parseInt(limit, 10);
  if (isNaN(parsed) || parsed < 1) return defaultVal;
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
