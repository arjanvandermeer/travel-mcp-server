const PREFERENCE_KEYS = ['currency', 'language', 'home_location'];

function normalizeCurrency(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('currency must be a 3-letter ISO 4217 code');
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error('currency must be a 3-letter ISO 4217 code');
  }
  return normalized;
}

function normalizeLanguage(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('language must be a BCP 47 language tag');
  }
  const normalized = value.trim();
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(normalized)) {
    throw new Error('language must be a BCP 47 language tag, such as en or en-US');
  }
  return normalized
    .split('-')
    .map((part, index) => (index === 0 ? part.toLowerCase() : part.length === 2 ? part.toUpperCase() : part))
    .join('-');
}

function normalizeString(value, field, maxLength = 120) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function normalizeCoordinate(value, field) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${field} must be a number`);
  }
  if (field === 'latitude' && (number < -90 || number > 90)) {
    throw new Error('latitude must be between -90 and 90');
  }
  if (field === 'longitude' && (number < -180 || number > 180)) {
    throw new Error('longitude must be between -180 and 180');
  }
  return number;
}

function normalizeHomeLocation(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('home_location must be an object');
  }

  const homeLocation = {
    city_name: normalizeString(value.city_name, 'home_location.city_name'),
    country_code: normalizeString(value.country_code, 'home_location.country_code', 2)?.toUpperCase(),
    state: normalizeString(value.state, 'home_location.state'),
    latitude: normalizeCoordinate(value.latitude, 'latitude'),
    longitude: normalizeCoordinate(value.longitude, 'longitude'),
  };

  Object.keys(homeLocation).forEach(key => {
    if (homeLocation[key] === undefined) delete homeLocation[key];
  });

  if (homeLocation.country_code && !/^[A-Z]{2}$/.test(homeLocation.country_code)) {
    throw new Error('home_location.country_code must be a 2-letter country code');
  }

  const hasPlace = !!(homeLocation.city_name && homeLocation.country_code);
  const hasCoordinates = homeLocation.latitude !== undefined && homeLocation.longitude !== undefined;
  const partialCoordinates = homeLocation.latitude !== undefined || homeLocation.longitude !== undefined;
  if (partialCoordinates && !hasCoordinates) {
    throw new Error('home_location latitude and longitude must be provided together');
  }
  if (!hasPlace && !hasCoordinates) {
    throw new Error('home_location must include city_name and country_code, or latitude and longitude');
  }

  return homeLocation;
}

function parseHomeLocation(value) {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function normalizeUserPreferenceInput(input = {}) {
  const normalized = {};

  const currency = normalizeCurrency(input.currency);
  const language = normalizeLanguage(input.language);
  const homeLocation = normalizeHomeLocation(input.home_location);

  if (currency !== undefined) normalized.currency = currency;
  if (language !== undefined) normalized.language = language;
  if (homeLocation !== undefined) normalized.home_location = homeLocation;

  if (Object.keys(normalized).length === 0) {
    throw new Error('At least one preference is required');
  }

  return normalized;
}

export function userPreferencesFromConfig(config = {}) {
  const preferences = {};
  if (config.currency) preferences.currency = config.currency;
  if (config.language) preferences.language = config.language;

  const homeLocation = parseHomeLocation(config.home_location);
  if (homeLocation) preferences.home_location = homeLocation;

  return preferences;
}

export async function saveUserPreferences(db, userId, preferences) {
  for (const key of PREFERENCE_KEYS) {
    if (!(key in preferences)) continue;
    const value = key === 'home_location'
      ? JSON.stringify(preferences[key])
      : preferences[key];
    await db.setUserConfig(userId, key, value);
  }
}
