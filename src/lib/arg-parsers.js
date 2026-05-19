/**
 * CLI Argument Parsers
 *
 * Pure functions for parsing command-line arguments.
 * These are extracted from their respective scripts to enable unit testing.
 *
 * @module lib/arg-parsers
 */

/**
 * Parse command line arguments for refresh-imports.js
 *
 * @param {string[]} args - Array of CLI arguments (e.g., process.argv.slice(2))
 * @returns {Object} Parsed options object
 * @returns {boolean} options.dryRun - Show what would be refreshed without importing
 * @returns {number|null} options.max - Maximum regions to refresh
 * @returns {string|null} options.region - Specific region to refresh
 * @returns {boolean} options.force - Refresh even if not due yet
 * @returns {boolean} options.list - Just list import sources
 * @returns {boolean} options.optimize - Run optimization after imports
 * @returns {boolean} options.refreshGeonames - Also refresh GeoNames data
 * @returns {string|null} options.geonamesCountryCode - Optional country code for GeoNames refresh
 * @returns {boolean} options.refreshGoogle - Refresh stale Google Places cache entries
 * @returns {boolean} options.skipOsm - Skip OSM region refreshes
 * @returns {boolean} options.help - Help was requested (caller should show help)
 *
 * @example
 * const options = parseRefreshArgs(['--dry-run', '--max=3']);
 * // { dryRun: true, max: 3, region: null, force: false, list: false, optimize: false, help: false }
 *
 * @example
 * const options = parseRefreshArgs(['--region=thailand', '--force']);
 * // { dryRun: false, max: null, region: 'thailand', force: true, list: false, optimize: false, help: false }
 */
export function parseRefreshArgs(args) {
  const options = {
    dryRun: false,
    max: null,
    region: null,
    force: false,
    list: false,
    optimize: false,
    refreshGeonames: false,
    geonamesCountryCode: null,
    refreshGoogle: false,
    skipOsm: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--optimize') {
      options.optimize = true;
    } else if (arg === '--refresh-geonames') {
      options.refreshGeonames = true;
    } else if (arg.startsWith('--geonames-country=')) {
      options.geonamesCountryCode = arg.split('=')[1]?.trim().toUpperCase() || null;
    } else if (arg === '--refresh-google') {
      options.refreshGoogle = true;
    } else if (arg === '--skip-osm') {
      options.skipOsm = true;
    } else if (arg.startsWith('--max=')) {
      const value = parseInt(arg.split('=')[1], 10);
      options.max = isNaN(value) ? null : value;
    } else if (arg.startsWith('--region=')) {
      options.region = arg.split('=')[1] || null;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Parse command line arguments for init-osm.js.
 *
 * @param {string[]} args - Array of CLI arguments (e.g., process.argv.slice(2))
 * @returns {Object} Parsed options object
 * @returns {string|null} options.region - Import source keyword
 * @returns {string} options.poiType - POI type to import
 * @returns {boolean} options.skipDbInit - Skip database initialization
 * @returns {boolean} options.geonames - Import GeoNames before OSM
 * @returns {boolean} options.optimize - Run database optimization after OSM
 * @returns {boolean} options.help - Help was requested
 */
export function parseInitOsmArgs(args) {
  const options = {
    region: null,
    poiType: 'all',
    skipDbInit: false,
    geonames: false,
    optimize: false,
    help: false,
  };

  const positional = [];
  for (const arg of args) {
    if (arg === '--skip-db-init') {
      options.skipDbInit = true;
    } else if (arg === '--geonames') {
      options.geonames = true;
    } else if (arg === '--optimize') {
      options.optimize = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  options.region = positional[0] || null;
  options.poiType = positional[1] || 'all';
  return options;
}

/**
 * Parse command line arguments for optimize-db.js
 *
 * @param {string[]} args - Array of CLI arguments (e.g., process.argv.slice(2))
 * @returns {Object} Parsed options object
 * @returns {boolean} options.full - Run VACUUM FULL
 * @returns {boolean} options.reindex - Also rebuild indexes
 * @returns {string|null} options.table - Only optimize specific table
 * @returns {boolean} options.dryRun - Show what would be done
 * @returns {boolean} options.help - Help was requested
 *
 * @example
 * const options = parseOptimizeArgs(['--full', '--reindex']);
 * // { full: true, reindex: true, table: null, dryRun: false, help: false }
 *
 * @example
 * const options = parseOptimizeArgs(['--table=osm_pois', '--dry-run']);
 * // { full: false, reindex: false, table: 'osm_pois', dryRun: true, help: false }
 */
export function parseOptimizeArgs(args) {
  const options = {
    full: false,
    reindex: false,
    table: null,
    dryRun: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--full') {
      options.full = true;
    } else if (arg === '--reindex') {
      options.reindex = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--table=')) {
      options.table = arg.split('=')[1] || null;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Parse command line arguments for import-osm-pbf.js
 *
 * @param {string[]} args - Array of CLI arguments (e.g., process.argv.slice(2))
 * @returns {Object} Parsed options object
 * @returns {string|null} options.input - Keyword or file path
 * @returns {string} options.poiType - POI type to import ('all', 'hotel', etc.)
 *
 * @example
 * const options = parseImportArgs(['thailand']);
 * // { input: 'thailand', poiType: 'all' }
 *
 * @example
 * const options = parseImportArgs(['france', 'hotel']);
 * // { input: 'france', poiType: 'hotel' }
 *
 * @example
 * const options = parseImportArgs(['/path/to/file.osm.pbf', 'restaurant']);
 * // { input: '/path/to/file.osm.pbf', poiType: 'restaurant' }
 */
export function parseImportArgs(args) {
  return {
    input: args[0] || null,
    poiType: args[1] || 'all',
  };
}

export default {
  parseRefreshArgs,
  parseInitOsmArgs,
  parseOptimizeArgs,
  parseImportArgs,
};
