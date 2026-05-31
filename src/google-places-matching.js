import { GOOGLE_PLACES_MIN_CONFIDENCE } from './config.js';
import { getEnglishName } from './lib/transliterate-thai.js';

export function isTypeCompatible(poiType, googleTypes) {
  if (!poiType || !googleTypes || googleTypes.length === 0) {
    return true;
  }

  const compatibilityRules = {
    hotel: ['lodging', 'hotel', 'guest_house', 'hostel'],
    hostel: ['lodging', 'hotel', 'guest_house', 'hostel'],
    guest_house: ['lodging', 'hotel', 'guest_house', 'hostel'],
    motel: ['lodging', 'motel', 'hotel'],
    resort: ['lodging', 'resort', 'hotel'],
    apartment: ['lodging', 'hotel'],
    camp_site: ['campground', 'rv_park', 'lodging'],
    chalet: ['lodging'],
    bed_and_breakfast: ['bed_and_breakfast', 'lodging'],
    restaurant: ['restaurant', 'food', 'meal_delivery', 'meal_takeaway'],
  };

  const requiredTypes = compatibilityRules[poiType];
  if (!requiredTypes) {
    return true;
  }

  return googleTypes.some(t => requiredTypes.includes(t));
}

// Convert a centre point + radius (metres) to a lat/lon bounding box.
// Used because Text Search locationRestriction only accepts rectangle, not circle.
export function radiusToBBox(lat, lon, radiusMeters) {
  const deltaLat = radiusMeters / 111320;
  const deltaLon = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
  return {
    low:  { latitude: lat - deltaLat, longitude: lon - deltaLon },
    high: { latitude: lat + deltaLat, longitude: lon + deltaLon },
  };
}

export function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'at', 'to', 'for',
  'bar', 'restaurant', 'restaurants', 'cafe', 'hotel', 'hotels', 'hostel',
  'hostels', 'bistro', 'resort', 'resorts', 'guesthouse', 'guesthouses',
]);

const LEADING_ARTICLES = new Set(['the', 'a', 'an']);

const WEAK_IDENTITY_TOKENS = new Set([
  'airport', 'central', 'center', 'centre', 'city', 'downtown', 'east', 'grand',
  'historic', 'main', 'new', 'north', 'old', 'palace', 'park', 'plaza', 'royal',
  'south', 'station', 'west', 'york',
]);

const TOKEN_ALIASES = new Map([
  ['intl', 'international'],
  ['int', 'international'],
  ['rd', 'road'],
  ['st', 'street'],
  ['ave', 'avenue'],
  ['av', 'avenue'],
  ['blvd', 'boulevard'],
  ['ctr', 'center'],
  ['centre', 'center'],
]);

const STREET_TOKEN_ALIASES = new Map([
  ['aly', 'alley'],
  ['ave', 'avenue'],
  ['av', 'avenue'],
  ['blvd', 'boulevard'],
  ['c', 'calle'],
  ['ctr', 'center'],
  ['ct', 'court'],
  ['dr', 'drive'],
  ['e', 'east'],
  ['hwy', 'highway'],
  ['ln', 'lane'],
  ['n', 'north'],
  ['pkwy', 'parkway'],
  ['pl', 'place'],
  ['prta', 'puerta'],
  ['pta', 'puerta'],
  ['rd', 'road'],
  ['s', 'south'],
  ['sq', 'square'],
  ['st', 'street'],
  ['ter', 'terrace'],
  ['w', 'west'],
]);

const ORDINAL_WORD_ALIASES = new Map([
  ['first', '1'],
  ['second', '2'],
  ['third', '3'],
  ['fourth', '4'],
  ['fifth', '5'],
  ['sixth', '6'],
  ['seventh', '7'],
  ['eighth', '8'],
  ['ninth', '9'],
  ['tenth', '10'],
  ['eleventh', '11'],
  ['twelfth', '12'],
]);

const STREET_PHRASE_ALIASES = new Map([
  ['avenue of the americas', '6 avenue'],
  ['sixth avenue', '6 avenue'],
]);

const STREET_PREFIX_TOKENS = new Set([
  'avenida', 'calle', 'place', 'plaza', 'piazza', 'rue', 'strada', 'street',
]);

const STREET_PREFIX_ARTICLES = new Set([
  'da', 'de', 'del', 'della', 'der', 'des', 'di', 'do', 'dos', 'du', 'el',
  'la', 'las', 'le', 'les', 'los', 'the',
]);

function normalizeName(str) {
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(?!(?:st|nd|rd|th)\b)(\p{L})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalToken(token) {
  const normalized = TOKEN_ALIASES.get(token) || token;
  if (normalized.length > 4 && normalized.endsWith('s')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function canonicalStreetToken(token) {
  const ordinal = token.replace(/^(\d+)(st|nd|rd|th)$/u, '$1');
  return ORDINAL_WORD_ALIASES.get(ordinal) || STREET_TOKEN_ALIASES.get(ordinal) || ordinal;
}

function stripLeadingStreetPrefix(tokens) {
  const stripped = [...tokens];
  if (!STREET_PREFIX_TOKENS.has(stripped[0])) {
    return stripped;
  }

  stripped.shift();
  while (stripped.length > 0 && STREET_PREFIX_ARTICLES.has(stripped[0])) {
    stripped.shift();
  }

  return stripped.length > 0 ? stripped : tokens;
}

function getComparableTokens(str) {
  return normalizeName(str)
    .split(' ')
    .map(canonicalToken)
    .filter(w => w.length > 1 && !FILLER_WORDS.has(w));
}

function stripLeadingArticles(str) {
  const tokens = normalizeName(str).split(' ').filter(Boolean);
  while (tokens.length > 0 && LEADING_ARTICLES.has(tokens[0])) {
    tokens.shift();
  }
  return tokens.join(' ');
}

function hasComparableIdentity(tokens) {
  return tokens.length > 0;
}

function isPhrasePrefix(longer, shorter) {
  return longer === shorter || longer.startsWith(`${shorter} `);
}

function hasDistinctiveTokenOverlap(name1, name2) {
  const tokens1 = getComparableTokens(name1).filter(token => !WEAK_IDENTITY_TOKENS.has(token));
  const tokens2 = getComparableTokens(name2).filter(token => !WEAK_IDENTITY_TOKENS.has(token));
  return tokens1.some(token => tokens2.some(other => tokensMatch(token, other)));
}

function tokensMatch(token1, token2) {
  if (token1 === token2) return true;
  if (token1.length < 4 || token2.length < 4) return false;
  return token1.includes(token2) || token2.includes(token1);
}

function tokenOverlapScore(tokens1, tokens2) {
  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const remaining = [...tokens2];
  let matches = 0;
  for (const token of tokens1) {
    const idx = remaining.findIndex(other => tokensMatch(token, other));
    if (idx >= 0) {
      matches++;
      remaining.splice(idx, 1);
    }
  }

  return matches > 0 ? (matches * 2) / (tokens1.length + tokens2.length) : 0;
}

function sortedTokenScore(tokens1, tokens2) {
  if (tokens1.length < 2 || tokens2.length < 2) return 0;
  const sorted1 = [...tokens1].sort().join(' ');
  const sorted2 = [...tokens2].sort().join(' ');
  const maxLen = Math.max(sorted1.length, sorted2.length);
  return maxLen > 0 ? 1 - (levenshteinDistance(sorted1, sorted2) / maxLen) : 0;
}

function nameVariants(name) {
  const variants = [name];
  const transliterated = getEnglishName(name);
  if (transliterated && transliterated !== name) {
    variants.push(transliterated);
  }
  return variants.filter((variant, index, all) => variant && all.indexOf(variant) === index);
}

function calculateNameSimilarityPair(name1, name2) {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);

  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1.0;

  const words1 = getComparableTokens(n1);
  const words2 = getComparableTokens(n2);

  let wordOverlapScore = tokenOverlapScore(words1, words2);
  if (words1.length === 1 && words2.length === 1 && n1 !== n2) {
    wordOverlapScore = Math.min(wordOverlapScore, 0.65);
  }
  const reorderedScore = sortedTokenScore(words1, words2);

  const maxLen = Math.max(n1.length, n2.length);
  const levenshteinScore = maxLen > 0
    ? 1 - (levenshteinDistance(n1, n2) / maxLen)
    : 0;

  let prefixScore = 0;
  if (n2.startsWith(n1) || n1.startsWith(n2)) {
    const shorter = Math.min(n1.length, n2.length);
    const longer = Math.max(n1.length, n2.length);
    prefixScore = 0.7 + 0.3 * (shorter / longer);
  }

  const n1WithoutLeadingArticles = stripLeadingArticles(n1);
  const n2WithoutLeadingArticles = stripLeadingArticles(n2);
  let articleInsensitivePrefixScore = 0;
  if (
    hasComparableIdentity(words1) &&
    n1WithoutLeadingArticles &&
    isPhrasePrefix(n2WithoutLeadingArticles, n1WithoutLeadingArticles)
  ) {
    articleInsensitivePrefixScore = 1.0;
  }
  if (
    hasComparableIdentity(words2) &&
    n2WithoutLeadingArticles &&
    isPhrasePrefix(n1WithoutLeadingArticles, n2WithoutLeadingArticles)
  ) {
    articleInsensitivePrefixScore = 1.0;
  }

  let containsScore = 0;
  if (n1.includes(n2) || n2.includes(n1)) {
    containsScore = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
  }

  return Math.max(
    wordOverlapScore,
    reorderedScore,
    levenshteinScore,
    containsScore,
    prefixScore,
    articleInsensitivePrefixScore,
  );
}

export function calculateNameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;

  let bestScore = 0;
  for (const variant1 of nameVariants(name1)) {
    for (const variant2 of nameVariants(name2)) {
      bestScore = Math.max(bestScore, calculateNameSimilarityPair(variant1, variant2));
    }
  }
  return bestScore;
}

export function findBestNameMatch(targetName, results, minConfidence = GOOGLE_PLACES_MIN_CONFIDENCE) {
  if (!results || results.length === 0) {
    return null;
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const result of results) {
    const resultName = result.displayName?.text || result.displayName || '';
    const score = calculateNameSimilarity(targetName, resultName);

    if (process.env.DEBUG_MATCHING) {
      console.error(`  Match score: "${targetName}" vs "${resultName}" = ${score.toFixed(3)}`);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  if (bestScore >= minConfidence) {
    if (process.env.DEBUG_MATCHING) {
      const matchName = bestMatch.displayName?.text || bestMatch.displayName;
      console.error(`  Best match: "${matchName}" with score ${bestScore.toFixed(3)}`);
    }
    return bestMatch;
  }

  if (process.env.DEBUG_MATCHING) {
    console.error(`  No confident match found (best score: ${bestScore.toFixed(3)} < ${minConfidence})`);
  }
  return null;
}

export function findBestNameMatchMulti(names, results, minConfidence = GOOGLE_PLACES_MIN_CONFIDENCE) {
  let bestMatch = null;
  let bestScore = 0;

  for (const name of names) {
    for (const result of results) {
      const resultName = result.displayName?.text || result.displayName || '';
      const score = calculateNameSimilarity(name, resultName);

      if (process.env.DEBUG_MATCHING) {
        console.error(`  Match score: "${name}" vs "${resultName}" = ${score.toFixed(3)}`);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }
  }

  if (bestScore >= minConfidence) {
    if (process.env.DEBUG_MATCHING) {
      const matchName = bestMatch.displayName?.text || bestMatch.displayName;
      console.error(`  Best match: "${matchName}" with score ${bestScore.toFixed(3)}`);
    }
    return bestMatch;
  }

  if (process.env.DEBUG_MATCHING) {
    console.error(`  No confident match found (best score: ${bestScore.toFixed(3)} < ${minConfidence})`);
  }
  return null;
}

function getDisplayName(place) {
  return place?.displayName?.text || place?.displayName || place?.name || '';
}

function parseAddressLine(address) {
  if (!address || typeof address !== 'string') return {};
  const parts = address.split(',').map(part => part.trim()).filter(Boolean);
  const firstLine = parts[0];
  if (!firstLine) return {};

  const match = firstLine.match(/^([A-Za-z]?\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s+(.+)$/u);
  if (match) {
    return {
      houseNumber: match[1],
      street: match[2],
    };
  }

  const trailingHouseNumber = parts[1]?.match(/^([A-Za-z]?\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)$/u);
  if (trailingHouseNumber && /\p{L}/u.test(firstLine)) {
    return {
      houseNumber: trailingHouseNumber[1],
      street: firstLine,
    };
  }

  return {};
}

function componentValue(component) {
  return component?.longText || component?.shortText || component?.long_name || component?.short_name || null;
}

function findAddressComponent(components, type) {
  if (!Array.isArray(components)) return null;
  const component = components.find(item => Array.isArray(item?.types) && item.types.includes(type));
  return componentValue(component);
}

function extractPOIAddressParts(poi) {
  const tags = poi?.tags || poi?.osm_tags || {};
  const parsed = parseAddressLine(poi?.address || poi?.osm_address);
  return {
    houseNumber: tags['addr:housenumber'] || parsed.houseNumber || null,
    street: tags['addr:street'] || parsed.street || null,
  };
}

function extractPlaceAddressParts(place) {
  const components = place?.addressComponents || place?.address_components;
  const parsed = parseAddressLine(
    place?.formattedAddress ||
    place?.formatted_address ||
    place?.shortFormattedAddress ||
    place?.short_formatted_address,
  );
  return {
    houseNumber: findAddressComponent(components, 'street_number') || parsed.houseNumber || null,
    street: findAddressComponent(components, 'route') || parsed.street || null,
  };
}

function normalizeHouseNumber(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[\s.]/g, '').trim();
}

export function normalizeStreetName(value) {
  if (typeof value !== 'string') return '';
  const normalized = normalizeName(value);
  if (!normalized) return '';
  const directAlias = STREET_PHRASE_ALIASES.get(normalized);
  if (directAlias) return directAlias;

  const tokens = normalized
    .split(' ')
    .map(canonicalStreetToken)
    .filter(Boolean);
  const phrase = tokens.join(' ');
  const alias = STREET_PHRASE_ALIASES.get(phrase);
  if (alias) return alias;

  const strippedPhrase = stripLeadingStreetPrefix(tokens).join(' ');
  return STREET_PHRASE_ALIASES.get(strippedPhrase) || strippedPhrase || phrase;
}

export function comparePlaceAddress(poi, place) {
  const osm = extractPOIAddressParts(poi);
  const google = extractPlaceAddressParts(place);
  const osmHouse = normalizeHouseNumber(osm.houseNumber);
  const googleHouse = normalizeHouseNumber(google.houseNumber);
  const osmStreet = normalizeStreetName(osm.street);
  const googleStreet = normalizeStreetName(google.street);

  const hasHouseNumberEvidence = Boolean(osmHouse && googleHouse);
  const hasStreetEvidence = Boolean(osmStreet && googleStreet);
  const houseNumberMatch = hasHouseNumberEvidence && osmHouse === googleHouse;
  const streetMatch = hasStreetEvidence && osmStreet === googleStreet;

  return {
    osmHouseNumber: osm.houseNumber || null,
    googleHouseNumber: google.houseNumber || null,
    osmStreet: osm.street || null,
    googleStreet: google.street || null,
    normalizedOsmStreet: osmStreet || null,
    normalizedGoogleStreet: googleStreet || null,
    hasHouseNumberEvidence,
    hasStreetEvidence,
    houseNumberMatch,
    houseNumberMismatch: hasHouseNumberEvidence && !houseNumberMatch,
    streetMatch,
    streetMismatch: hasStreetEvidence && !streetMatch,
  };
}

export function distanceMetersBetween(lat1, lon1, lat2, lon2) {
  const fromLat = Number(lat1);
  const fromLon = Number(lon1);
  const toLat = Number(lat2);
  const toLon = Number(lon2);
  if (![fromLat, fromLon, toLat, toLon].every(Number.isFinite)) return null;

  const earthRadiusMeters = 6371000;
  const dLat = (toLat - fromLat) * Math.PI / 180;
  const dLon = (toLon - fromLon) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(fromLat * Math.PI / 180) * Math.cos(toLat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function distanceScore(distanceMeters) {
  if (distanceMeters === null) return 0;
  if (distanceMeters <= 30) return 1;
  if (distanceMeters <= 75) return 0.85;
  if (distanceMeters <= 150) return 0.6;
  if (distanceMeters <= 500) return 0.2;
  return 0;
}

export function scorePlaceCandidate(poi, names, place, minConfidence = GOOGLE_PLACES_MIN_CONFIDENCE) {
  const matchNames = Array.isArray(names) ? names.filter(Boolean) : [names].filter(Boolean);
  const placeName = getDisplayName(place);
  let nameScore = 0;
  let bestName = null;
  let hasDistinctiveNameEvidence = false;

  for (const name of matchNames) {
    const score = calculateNameSimilarity(name, placeName);
    if (score > nameScore) {
      nameScore = score;
      bestName = name;
    }
    if (hasDistinctiveTokenOverlap(name, placeName)) {
      hasDistinctiveNameEvidence = true;
    }
  }

  const typeCompatible = isTypeCompatible(poi?.poi_type, place?.types);
  const distanceMeters = distanceMetersBetween(
    poi?.latitude ?? poi?.osm_latitude,
    poi?.longitude ?? poi?.osm_longitude,
    place?.location?.latitude ?? place?.latitude ?? place?.google_latitude,
    place?.location?.longitude ?? place?.longitude ?? place?.google_longitude,
  );
  const address = comparePlaceAddress(poi, place);
  const closeDistance = distanceMeters !== null && distanceMeters <= 50;
  const strongAddressEvidence = address.houseNumberMatch && address.streetMatch;
  const closeHouseNumberEvidence =
    address.houseNumberMatch &&
    closeDistance &&
    !address.streetMismatch &&
    distanceMeters !== null &&
    distanceMeters <= 25;

  const directNameMatch = nameScore >= minConfidence;
  const addressRescue =
    nameScore >= 0.45 &&
    hasDistinctiveNameEvidence &&
    closeDistance &&
    (strongAddressEvidence || closeHouseNumberEvidence);
  const accepted = typeCompatible && (directNameMatch || addressRescue);

  const evidenceScore = Math.min(
    0.95,
    nameScore +
      (distanceScore(distanceMeters) * 0.12) +
      (address.houseNumberMatch ? 0.08 : 0) +
      (address.streetMatch ? 0.10 : 0),
  );
  const confidence = directNameMatch
    ? nameScore
    : addressRescue
      ? Math.max(minConfidence, evidenceScore)
      : nameScore;

  return {
    accepted,
    confidence,
    nameScore,
    bestName,
    placeName,
    typeCompatible,
    hasDistinctiveNameEvidence,
    distanceMeters,
    address,
    directNameMatch,
    addressRescue,
  };
}

export function findBestPlaceMatch(poi, names, results, minConfidence = GOOGLE_PLACES_MIN_CONFIDENCE) {
  if (!results || results.length === 0) {
    return null;
  }

  let bestMatch = null;
  let bestEvidence = null;

  for (const result of results) {
    const evidence = scorePlaceCandidate(poi, names, result, minConfidence);

    if (process.env.DEBUG_MATCHING) {
      const dist = evidence.distanceMeters === null ? 'n/a' : `${Math.round(evidence.distanceMeters)}m`;
      const addressBits = [
        evidence.address.houseNumberMatch ? 'house' : null,
        evidence.address.streetMatch ? 'street' : null,
        evidence.address.streetMismatch ? 'street_mismatch' : null,
      ].filter(Boolean).join(',');
      console.error(
        `  Candidate score: "${evidence.bestName}" vs "${evidence.placeName}" ` +
        `name=${evidence.nameScore.toFixed(3)} confidence=${evidence.confidence.toFixed(3)} ` +
        `distance=${dist} address=${addressBits || 'none'} accepted=${evidence.accepted}`,
      );
    }

    if (evidence.accepted && (!bestEvidence || evidence.confidence > bestEvidence.confidence)) {
      bestMatch = result;
      bestEvidence = evidence;
    }
  }

  if (bestMatch && process.env.DEBUG_MATCHING) {
    const matchName = getDisplayName(bestMatch);
    console.error(`  Best evidence match: "${matchName}" with confidence ${bestEvidence.confidence.toFixed(3)}`);
  }

  if (!bestMatch && process.env.DEBUG_MATCHING) {
    console.error(`  No confident evidence match found (< ${minConfidence})`);
  }

  return bestMatch;
}

export function getOSMNameVariants(poi) {
  return [
    poi?.name,
    poi?.name_en,
    getEnglishName(poi?.name),
    poi?.tags?.['name:en'],
    poi?.tags?.brand,
  ].filter((name, index, names) => name && names.indexOf(name) === index);
}

export function isPlaceDetailsNameCompatible(poi, placeDetails, minConfidence = GOOGLE_PLACES_MIN_CONFIDENCE) {
  const googleName = placeDetails?.displayName?.text || placeDetails?.displayName || placeDetails?.name;
  if (!googleName) {
    return false;
  }

  const names = getOSMNameVariants(poi);
  return scorePlaceCandidate(poi, names, placeDetails, minConfidence).accepted;
}
