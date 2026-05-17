import { GOOGLE_PLACES_MIN_CONFIDENCE } from './config.js';

export function isTypeCompatible(poiType, googleTypes) {
  if (!poiType || !googleTypes || googleTypes.length === 0) {
    return true;
  }

  const compatibilityRules = {
    hotel: ['lodging', 'hotel', 'guest_house', 'hostel'],
    hostel: ['lodging', 'hotel', 'guest_house', 'hostel'],
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

export function calculateNameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;

  const normalize = (str) => str.toLowerCase().trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const n1 = normalize(name1);
  const n2 = normalize(name2);

  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1.0;

  const fillerWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'at', 'to', 'for', 'bar', 'restaurant', 'cafe', 'hotel', 'hostel', 'bistro']);
  const getWords = (str) => str.split(' ').filter(w => w.length > 1 && !fillerWords.has(w));

  const words1 = getWords(n1);
  const words2 = getWords(n2);

  const commonWords = words1.filter(w => words2.some(w2 => w === w2 || w.includes(w2) || w2.includes(w)));
  const wordOverlapScore = commonWords.length > 0
    ? (commonWords.length * 2) / (words1.length + words2.length)
    : 0;

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

  let containsScore = 0;
  if (n1.includes(n2) || n2.includes(n1)) {
    containsScore = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
  }

  return Math.max(wordOverlapScore, levenshteinScore, containsScore, prefixScore);
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
