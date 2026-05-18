const HTTP_URL_PROTOCOLS = new Set(['http:', 'https:']);

export function sanitizeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return HTTP_URL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function sanitizeHttpUrlList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const sanitized = [];

  for (const value of values) {
    const url = sanitizeHttpUrl(value);
    if (url && !seen.has(url)) {
      seen.add(url);
      sanitized.push(url);
    }
  }

  return sanitized;
}

export function displayHostname(value) {
  const url = sanitizeHttpUrl(value);
  if (!url) return null;

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function sanitizePhoneHref(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[^\d+]/g, '');
  if (!/^\+?\d{3,20}$/.test(compact)) return null;
  return `tel:${compact}`;
}

export function sanitizeEmailHref(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

export function sanitizePoiExternalUrls(poi) {
  if (!poi || typeof poi !== 'object') return poi;
  const sanitized = { ...poi };

  for (const field of ['photo_url', 'primary_photo_url', 'google_maps_url', 'google_website', 'osm_website', 'website']) {
    if (field in sanitized) {
      sanitized[field] = sanitizeHttpUrl(sanitized[field]);
    }
  }

  if (Array.isArray(sanitized.photo_urls)) {
    sanitized.photo_urls = sanitizeHttpUrlList(sanitized.photo_urls);
  }

  for (const field of ['google_photos', 'photos']) {
    if (Array.isArray(sanitized[field])) {
      sanitized[field] = sanitized[field]
        .map(photo => {
          if (!photo || typeof photo !== 'object') return null;
          const next = { ...photo };
          if ('url' in next) next.url = sanitizeHttpUrl(next.url);
          if ('url_thumbnail' in next) next.url_thumbnail = sanitizeHttpUrl(next.url_thumbnail);
          return next.url || next.url_thumbnail ? next : null;
        })
        .filter(Boolean);
    }
  }

  return sanitized;
}

export function sanitizePoiExternalUrlsArray(pois) {
  return Array.isArray(pois) ? pois.map(sanitizePoiExternalUrls) : pois;
}
