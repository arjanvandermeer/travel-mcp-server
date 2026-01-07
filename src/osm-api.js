/**
 * OSM Overpass API helper functions
 */

// Rate limiting: minimum delay between API requests (in ms)
const MIN_REQUEST_DELAY = 1000; // 1 second between requests
let lastRequestTime = 0;

/**
 * Sleep for a specified duration
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate-limited API request wrapper
 * Ensures minimum delay between requests
 */
async function rateLimitedFetch(url, options, retries = 3) {
  // Enforce minimum delay between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
    await sleep(MIN_REQUEST_DELAY - timeSinceLastRequest);
  }
  lastRequestTime = Date.now();

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Handle rate limiting (429) and server errors (5xx)
      if (response.status === 429 || response.status === 504 || response.status >= 500) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 30000); // Exponential backoff, max 30s

        console.log(`OSM API ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(delayMs);
        continue;
      }

      return response;
    } catch (error) {
      if (attempt === retries - 1) throw error;
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`Network error, retrying in ${delayMs}ms (attempt ${attempt + 1}/${retries}): ${error.message}`);
      await sleep(delayMs);
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * Split large bounding box into smaller tiles
 * @param {number} south
 * @param {number} west
 * @param {number} north
 * @param {number} east
 * @param {number} maxTiles - Maximum number of tiles (default: 4, for 2x2 grid)
 * @returns {Array<{south, west, north, east}>} Array of tile bounding boxes
 */
export function splitBoundingBox(south, west, north, east, maxTiles = 4) {
  const latSpan = north - south;
  const lonSpan = east - west;

  // If area is small enough, don't split
  if (latSpan < 0.2 && lonSpan < 0.2) {
    return [{ south, west, north, east }];
  }

  // Calculate grid dimensions
  const gridSize = Math.ceil(Math.sqrt(maxTiles));
  const latStep = latSpan / gridSize;
  const lonStep = lonSpan / gridSize;

  const tiles = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      tiles.push({
        south: south + i * latStep,
        west: west + j * lonStep,
        north: south + (i + 1) * latStep,
        east: west + (j + 1) * lonStep,
      });
    }
  }

  return tiles;
}

/**
 * Query Overpass API for hotel count in a bounding box
 * @param {number} south
 * @param {number} west
 * @param {number} north
 * @param {number} east
 * @returns {Promise<number>} Count of hotels in the region
 */
export async function queryHotelCount(south, west, north, east) {
  const query = `
    [out:json][timeout:25];
    (
      node["tourism"="hotel"](${south},${west},${north},${east});
      way["tourism"="hotel"](${south},${west},${north},${east});
      relation["tourism"="hotel"](${south},${west},${north},${east});
    );
    out count;
  `;

  try {
    const response = await rateLimitedFetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      console.error(`OSM API error: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.elements?.[0]?.tags?.total || 0;
  } catch (error) {
    console.error(`Error querying OSM count: ${error.message}`);
    return null;
  }
}

/**
 * Fetch hotels from Overpass API for a bounding box
 * @param {number} south
 * @param {number} west
 * @param {number} north
 * @param {number} east
 * @returns {Promise<Array>} Array of OSM elements
 */
export async function fetchHotels(south, west, north, east) {
  const query = `
    [out:json][timeout:60];
    (
      node["tourism"="hotel"](${south},${west},${north},${east});
      way["tourism"="hotel"](${south},${west},${north},${east});
      relation["tourism"="hotel"](${south},${west},${north},${east});
    );
    out body center;
  `;

  try {
    const response = await rateLimitedFetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      console.error(`OSM API error: HTTP ${response.status}: ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    return data.elements || [];
  } catch (error) {
    console.error(`Error fetching hotels from OSM: ${error.message}`);
    return [];
  }
}

/**
 * Parse OSM element into hotel object
 * @param {object} element - OSM element (node/way/relation)
 * @returns {object|null} Hotel object or null if invalid
 */
export function parseOSMElement(element) {
  const tags = element.tags || {};

  // Get coordinates - use center for ways/relations
  let lat, lon;
  if (element.type === 'node') {
    lat = element.lat;
    lon = element.lon;
  } else if (element.center) {
    lat = element.center.lat;
    lon = element.center.lon;
  } else {
    return null; // Skip if no coordinates
  }

  // Extract basic info
  const name = tags.name || tags['name:en'] || 'Unnamed Hotel';

  // Build address
  const addressParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
  ].filter(Boolean);
  const address = addressParts.join(' ') || null;

  const city = tags['addr:city'] || null;
  const countryCode = tags['addr:country'] || null;

  // Contact info
  const phone = tags.phone || tags['contact:phone'] || null;
  const website = tags.website || tags['contact:website'] || null;
  const email = tags.email || tags['contact:email'] || null;

  // Hotel-specific info
  const stars = parseInt(tags.stars) || null;
  const rooms = parseInt(tags.rooms) || null;

  // Extract amenities
  const amenities = [];
  const amenityMapping = {
    'internet_access': 'wifi',
    'internet_access:fee': (value) => value === 'no' ? 'free_wifi' : null,
    'parking': 'parking',
    'parking:fee': (value) => value === 'no' ? 'free_parking' : null,
    'swimming_pool': 'pool',
    'air_conditioning': 'air_conditioning',
    'restaurant': 'restaurant',
    'bar': 'bar',
    'gym': 'gym',
    'spa': 'spa',
    'wheelchair': 'wheelchair_accessible',
    'breakfast': 'breakfast',
  };

  for (const [osmKey, amenityName] of Object.entries(amenityMapping)) {
    if (tags[osmKey]) {
      if (typeof amenityName === 'function') {
        const result = amenityName(tags[osmKey]);
        if (result) amenities.push(result);
      } else if (tags[osmKey] === 'yes' || tags[osmKey] === 'true') {
        amenities.push(amenityName);
      }
    }
  }

  return {
    osm_id: `${element.type}/${element.id}`,
    name,
    latitude: lat,
    longitude: lon,
    address,
    city,
    country_code: countryCode,
    phone,
    website,
    email,
    stars,
    rooms,
    amenities: amenities.length > 0 ? amenities : null,
  };
}

/**
 * Fetch single hotel by OSM ID
 * @param {string} osmId - OSM ID (e.g., "node/123456")
 * @returns {Promise<object|null>} Hotel object or null
 */
export async function fetchHotelById(osmId) {
  const [type, id] = osmId.split('/');

  const query = `
    [out:json][timeout:25];
    ${type}(${id});
    out body center;
  `;

  try {
    const response = await rateLimitedFetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      console.error(`OSM API error: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.elements && data.elements.length > 0) {
      return parseOSMElement(data.elements[0]);
    }
    return null;
  } catch (error) {
    console.error(`Error fetching hotel ${osmId} from OSM: ${error.message}`);
    return null;
  }
}
