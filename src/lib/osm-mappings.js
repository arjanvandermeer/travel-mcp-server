/**
 * OSM POI Mappings and Extraction Functions
 *
 * Pure functions for mapping OpenStreetMap tags to our POI types
 * and extracting structured data from OSM items.
 *
 * @module lib/osm-mappings
 */

import { getEnglishName } from './transliterate-thai.js';

/**
 * POI type mappings: OSM tag pattern -> our normalized poi_type
 *
 * Keys are in format "key=value" matching OSM tag conventions.
 * Values are our internal POI type identifiers.
 */
export const POI_MAPPINGS = {
  // Accommodation
  'tourism=hotel': 'hotel',
  'tourism=hostel': 'hostel',
  'tourism=guest_house': 'guest_house',
  'tourism=motel': 'motel',
  'tourism=resort': 'resort',
  'tourism=apartment': 'apartment',
  'tourism=camp_site': 'camp_site',
  'tourism=chalet': 'chalet',
  'tourism=bed_and_breakfast': 'bed_and_breakfast',

  // Tourism
  'tourism=attraction': 'attraction',
  'tourism=museum': 'museum',
  'tourism=viewpoint': 'viewpoint',
  'tourism=artwork': 'artwork',
  'tourism=gallery': 'gallery',
  'tourism=theme_park': 'theme_park',
  'tourism=zoo': 'zoo',

  // Food & Drink
  'amenity=restaurant': 'restaurant',
  'amenity=cafe': 'cafe',
  'amenity=bar': 'bar',
  'amenity=pub': 'pub',
  'amenity=fast_food': 'fast_food',
  'amenity=food_court': 'food_court',
  'amenity=pharmacy': 'pharmacy',

  // Transit
  'highway=bus_stop': 'bus_stop',
  'railway=station': 'train_station',
  'railway=halt': 'train_station',
  'railway=subway_entrance': 'subway_station',
  'railway=tram_stop': 'tram_stop',
  'public_transport=station': 'transit_station',

  // Historic
  'historic=monument': 'monument',
  'historic=memorial': 'memorial',
  'historic=castle': 'castle',
  'historic=ruins': 'ruins',
  'historic=archaeological_site': 'archaeological_site',

  // Places of worship
  'amenity=place_of_worship': 'place_of_worship',

  // Entertainment
  'amenity=cinema': 'cinema',
  'amenity=theatre': 'theatre',
  'amenity=nightclub': 'nightclub',

  // Shopping
  'shop=mall': 'shopping_mall',
  'shop=department_store': 'department_store',
  'shop=supermarket': 'supermarket',
};

/**
 * Get all valid POI types
 * @returns {string[]} Array of valid POI type strings
 */
export function getValidPOITypes() {
  return [...new Set(Object.values(POI_MAPPINGS))];
}

/**
 * Get all POI type categories grouped by OSM key
 * @returns {Object} Object with keys like 'tourism', 'amenity', etc.
 */
export function getPOICategories() {
  const categories = {};
  for (const [osmTag, poiType] of Object.entries(POI_MAPPINGS)) {
    const [key] = osmTag.split('=');
    if (!categories[key]) {
      categories[key] = [];
    }
    categories[key].push(poiType);
  }
  return categories;
}

/**
 * Check if an OSM tag pattern matches the given tags
 *
 * @param {Object} tags - OSM tags object (key-value pairs)
 * @param {string} osmTag - Tag pattern like "tourism=hotel"
 * @returns {boolean} True if tags match the pattern
 *
 * @example
 * evaluatePOICondition({ tourism: 'hotel', name: 'Grand Hotel' }, 'tourism=hotel')
 * // returns true
 *
 * @example
 * evaluatePOICondition({ amenity: 'restaurant' }, 'tourism=hotel')
 * // returns false
 */
export function evaluatePOICondition(tags, osmTag) {
  if (!tags || typeof tags !== 'object') {
    return false;
  }
  const [key, value] = osmTag.split('=');
  return tags[key] === value;
}

/**
 * Match OSM tags against POI type mappings
 *
 * @param {Object} tags - OSM tags object
 * @param {string} requestedType - 'all' for any match, or specific type like 'hotel'
 * @returns {string|null} Matched POI type or null if no match
 *
 * @example
 * matchPOIType({ tourism: 'hotel', stars: '4' }, 'all')
 * // returns 'hotel'
 *
 * @example
 * matchPOIType({ amenity: 'restaurant', cuisine: 'thai' }, 'restaurant')
 * // returns 'restaurant'
 *
 * @example
 * matchPOIType({ amenity: 'restaurant' }, 'hotel')
 * // returns null (restaurant doesn't match hotel)
 *
 * @example
 * matchPOIType({ building: 'yes' }, 'all')
 * // returns null (no POI tags)
 */
export function matchPOIType(tags, requestedType) {
  if (!tags || typeof tags !== 'object') {
    return null;
  }

  // Match against all POI types if 'all' is requested
  if (requestedType === 'all') {
    for (const [osmTag, poiType] of Object.entries(POI_MAPPINGS)) {
      if (evaluatePOICondition(tags, osmTag)) {
        return poiType;
      }
    }
    return null;
  }

  // Match specific type - find the mapping for this POI type
  for (const [osmTag, poiType] of Object.entries(POI_MAPPINGS)) {
    if (poiType === requestedType && evaluatePOICondition(tags, osmTag)) {
      return poiType;
    }
  }

  return null;
}

/**
 * Truncate a string to a maximum length
 *
 * @param {string|null|undefined} str - String to truncate
 * @param {number} maxLen - Maximum length
 * @returns {string|null} Truncated string or null
 */
function truncate(str, maxLen) {
  if (!str) return null;
  return str.length > maxLen ? str.substring(0, maxLen) : str;
}

/**
 * Parse and validate a star rating from OSM tags
 *
 * @param {Object} tags - OSM tags object
 * @returns {number|null} Star rating (1-5) or null
 */
function parseStarRating(tags) {
  let stars = tags.stars || tags['stars:DEHOGA'] || null;
  if (!stars) return null;

  // Normalize to just the number
  stars = stars.replace(/[^0-9]/g, '');
  const rating = parseInt(stars, 10);

  if (rating > 0 && rating <= 5) {
    return rating;
  }
  return null;
}

/**
 * Parse and validate a room/bed count from OSM tags
 *
 * @param {string|undefined} value - The tag value
 * @param {number} [maxValue=100000] - Maximum valid value
 * @returns {number|null} Parsed count or null
 */
function parseCount(value, maxValue = 100000) {
  if (!value) return null;
  const count = parseInt(value, 10);
  if (isNaN(count) || count < 0 || count > maxValue) {
    return null;
  }
  return count;
}

/**
 * Build an address string from OSM address tags
 *
 * @param {Object} tags - OSM tags object
 * @returns {string|null} Formatted address or null
 */
function buildAddress(tags) {
  const parts = [];
  const streetLine = [tags['addr:housenumber'], tags['addr:street']]
    .filter(Boolean)
    .join(' ');
  if (streetLine) parts.push(streetLine);
  if (tags['addr:city']) parts.push(tags['addr:city']);
  if (tags['addr:postcode']) parts.push(tags['addr:postcode']);
  if (tags['addr:country']) parts.push(tags['addr:country']);

  if (parts.length === 0) return null;
  return truncate(parts.join(', '), 500);
}

/**
 * Extract structured POI data from an OSM item
 *
 * @param {Object} item - OSM item with id, type, lat, lon, tags
 * @param {number} item.id - OSM ID
 * @param {string} [item.type='node'] - OSM type (node, way, relation)
 * @param {number} item.lat - Latitude
 * @param {number} item.lon - Longitude
 * @param {Object} item.tags - OSM tags
 * @param {string} poiType - Our normalized POI type
 * @param {string} regionName - Source region name
 * @returns {Object} Structured POI data ready for database insertion
 *
 * @example
 * const poi = extractPOIData({
 *   id: 12345,
 *   type: 'node',
 *   lat: 13.75,
 *   lon: 100.50,
 *   tags: { tourism: 'hotel', name: 'Grand Hotel', stars: '5', rooms: '200' }
 * }, 'hotel', 'thailand');
 * // Returns structured POI object
 */
export function extractPOIData(item, poiType, regionName) {
  const tags = item.tags || {};

  return {
    osm_id: item.id,
    osm_type: item.type || 'node',
    poi_type: poiType,
    name: truncate(tags.name, 500),
    name_en: truncate(getEnglishName(tags.name, tags), 500),
    latitude: item.lat,
    longitude: item.lon,
    address: buildAddress(tags),
    phone: truncate(tags.phone || tags['contact:phone'], 100),
    email: truncate(tags.email || tags['contact:email'], 200),
    website: truncate(tags.website || tags['contact:website'] || tags.url, 500),
    opening_hours: truncate(tags.opening_hours, 500),
    cuisine: truncate(tags.cuisine, 200),
    wheelchair: truncate(tags.wheelchair, 20),
    stars: parseStarRating(tags),
    rooms: parseCount(tags.rooms),
    beds: parseCount(tags.beds),
    source_region: regionName,
    osm_tags: tags,
  };
}

/**
 * Check if a POI should be filtered out (no name or invalid name)
 *
 * @param {Object} poi - POI object with name field
 * @returns {boolean} True if POI should be filtered out
 *
 * @example
 * shouldFilterPOI({ name: 'Grand Hotel' }) // false
 * shouldFilterPOI({ name: '' }) // true
 * shouldFilterPOI({ name: 'unknown' }) // true
 * shouldFilterPOI({ name: null }) // true
 */
export function shouldFilterPOI(poi) {
  if (!poi.name || poi.name.trim() === '') {
    return true;
  }
  if (poi.name.toLowerCase() === 'unknown') {
    return true;
  }
  return false;
}

export default {
  POI_MAPPINGS,
  getValidPOITypes,
  getPOICategories,
  evaluatePOICondition,
  matchPOIType,
  extractPOIData,
  shouldFilterPOI,
};
