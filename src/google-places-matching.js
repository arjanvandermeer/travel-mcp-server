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

function normalizeName(str) {
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
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
  return names.some(name => calculateNameSimilarity(name, googleName) >= minConfidence);
}
