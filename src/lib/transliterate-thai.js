import { transliterate, isMostlyThai } from 'thai-transliterate';

/**
 * Generate an English name for a POI.
 *
 * Priority:
 * 1. OSM name:en tag (human-curated English name)
 * 2. Transliteration of the Thai name via thai-transliterate
 * 3. null (if name is not Thai)
 *
 * @param {string|null} name - The POI's primary name
 * @param {Object} tags - All OSM tags for this POI
 * @returns {string|null} English name or null if not applicable
 */
export function getEnglishName(name, tags = {}) {
  if (!name) return null;

  const nameEn = tags['name:en'];
  if (nameEn && nameEn.trim()) {
    return nameEn.trim();
  }

  if (isMostlyThai(name)) {
    return transliterate(name) || null;
  }

  return null;
}
