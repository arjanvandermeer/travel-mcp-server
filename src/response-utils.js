/**
 * Recursively remove null and undefined fields from response payloads.
 *
 * Arrays keep their original shape, while objects lose only absent fields.
 * Dates are preserved as-is so serialization remains controlled by callers.
 */
export function removeNullFields(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeNullFields);
  }

  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.entries(obj)
      .filter(([_, value]) => value !== null && value !== undefined)
      .reduce((acc, [key, value]) => ({ ...acc, [key]: removeNullFields(value) }), {});
  }

  return obj;
}

/**
 * Add MCP resource URIs to POI response payloads.
 */
export function addResourceUris(pois, baseUrl) {
  let uiHost = '';

  if (baseUrl) {
    try {
      uiHost = new URL(baseUrl).host;
    } catch {
      uiHost = '';
    }
  }

  if (Array.isArray(pois)) {
    return pois.map(poi => ({
      ...poi,
      resource_uri: `ui://${uiHost}/poi/${poi.osm_id}`,
    }));
  }

  if (pois && pois.osm_id) {
    return {
      ...pois,
      resource_uri: `ui://${uiHost}/poi/${pois.osm_id}`,
    };
  }

  return pois;
}
