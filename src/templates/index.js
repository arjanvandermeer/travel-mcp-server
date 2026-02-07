/**
 * Template engine using Handlebars
 * Loads and compiles templates from .hbs files
 */

import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache compiled templates
const templateCache = new Map();

/**
 * Load and compile a template from a .hbs file
 * @param {string} name - Template name (without .hbs extension)
 * @returns {HandlebarsTemplateDelegate} Compiled template function
 */
export function getTemplate(name) {
  if (templateCache.has(name)) {
    return templateCache.get(name);
  }

  const templatePath = path.join(__dirname, `${name}.hbs`);
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  const compiled = Handlebars.compile(templateSource);

  templateCache.set(name, compiled);
  return compiled;
}

/**
 * Render a template with data
 * @param {string} name - Template name (without .hbs extension)
 * @param {object} data - Data to pass to the template
 * @returns {string} Rendered HTML
 */
export function render(name, data) {
  const template = getTemplate(name);
  return template(data);
}

// Register custom helpers

/**
 * Helper to format rating with star emoji
 * Usage: {{formatRating rating}}
 */
Handlebars.registerHelper('formatRating', function (rating) {
  if (!rating) return '';
  return `⭐ ${rating}`;
});

/**
 * Helper to create Google Maps URL
 * Usage: {{mapsUrl latitude longitude placeId}}
 * If placeId is provided, uses place link; otherwise falls back to coordinates
 */
Handlebars.registerHelper('mapsUrl', function (lat, lon, placeId) {
  // placeId might be the Handlebars options object if not provided
  if (placeId && typeof placeId === 'string') {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}&query_place_id=${placeId}`;
  }
  return `https://www.google.com/maps?q=${lat},${lon}`;
});

/**
 * Helper for equality comparison
 * Usage: {{#ifEq value1 value2}}...{{/ifEq}}
 */
Handlebars.registerHelper('ifEq', function (a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

/**
 * Helper to parse JSON string
 * Usage: {{#each (parseJson jsonString)}}...{{/each}}
 */
Handlebars.registerHelper('parseJson', function (jsonString) {
  if (!jsonString) return [];
  try {
    return JSON.parse(jsonString);
  } catch {
    return [];
  }
});

/**
 * Helper to return first truthy value (coalesce)
 * Usage: {{or google_name osm_name "Unknown"}}
 */
Handlebars.registerHelper('or', function (...args) {
  // Remove the Handlebars options object from the end
  args.pop();
  for (const val of args) {
    if (val) return val;
  }
  return '';
});

/**
 * Helper to format distance to 1 decimal place
 * Usage: {{formatDistance distance_km}}
 */
Handlebars.registerHelper('formatDistance', function (distance) {
  if (distance == null) return '';
  const num = parseFloat(distance);
  if (isNaN(num)) return distance;
  return num.toFixed(1);
});

/**
 * Helper to get best POI name (handles Google Places display_name JSON structure)
 * Usage: {{poiName this}}
 */
Handlebars.registerHelper('poiName', function (poi) {
  // Try Google display_name first (it's a JSON object with text/languageCode)
  if (poi.google_display_name) {
    if (typeof poi.google_display_name === 'object') {
      return poi.google_display_name.text || poi.osm_name || 'Unknown';
    }
    // If it's somehow a string, use it
    if (typeof poi.google_display_name === 'string') {
      try {
        const parsed = JSON.parse(poi.google_display_name);
        return parsed.text || poi.osm_name || 'Unknown';
      } catch {
        return poi.google_display_name;
      }
    }
  }
  return poi.osm_name || 'Unknown';
});

/**
 * Helper to format a date as a readable string (e.g., "January 15, 2025")
 * Usage: {{formatDate dateValue}}
 */
Handlebars.registerHelper('formatDate', function (date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
});

export default { render, getTemplate };
