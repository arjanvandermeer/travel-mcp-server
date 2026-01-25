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
 * Usage: {{mapsUrl latitude longitude}}
 */
Handlebars.registerHelper('mapsUrl', function (lat, lon) {
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

export default { render, getTemplate };
