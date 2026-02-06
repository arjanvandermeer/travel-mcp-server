/**
 * Mock Database Implementation for Unit Testing
 *
 * This module provides a mock database that can be injected into functions
 * instead of a real PostgreSQL connection. It allows tests to:
 * - Define expected query responses
 * - Track all queries made during a test
 * - Simulate errors and edge cases
 *
 * @example
 * import { createMockDatabase } from '../mocks/db-mock.js';
 *
 * const db = createMockDatabase({
 *   'SELECT * FROM cities': { rows: [{ id: 1, name: 'Bangkok' }], rowCount: 1 }
 * });
 *
 * const result = await db.query('SELECT * FROM cities');
 * assert.strictEqual(result.rows[0].name, 'Bangkok');
 *
 * // Check what queries were made
 * const calls = db.getCalls();
 * assert.strictEqual(calls.length, 1);
 */

/**
 * Create a mock database for testing
 *
 * @param {Object} responses - Map of SQL patterns to responses
 * @param {Object} options - Configuration options
 * @param {boolean} options.throwOnUnmatched - Throw error if query doesn't match any pattern
 * @returns {Object} Mock database object with query(), connect(), end() methods
 */
export function createMockDatabase(responses = {}, options = {}) {
  const { throwOnUnmatched = false } = options;
  const calls = [];
  let connected = false;

  /**
   * Find a matching response for the given SQL
   * Matches by substring - the SQL just needs to contain the pattern
   */
  function findResponse(sql) {
    // Try exact match first
    if (responses[sql]) {
      return responses[sql];
    }

    // Try substring match
    for (const [pattern, response] of Object.entries(responses)) {
      if (sql.includes(pattern)) {
        return response;
      }
    }

    // Try regex match (patterns starting with /)
    for (const [pattern, response] of Object.entries(responses)) {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        const regex = new RegExp(pattern.slice(1, -1));
        if (regex.test(sql)) {
          return response;
        }
      }
    }

    return null;
  }

  return {
    /**
     * Execute a query against the mock database
     *
     * @param {string} sql - SQL query string
     * @param {Array} params - Query parameters
     * @returns {Promise<Object>} Query result with rows and rowCount
     */
    query: async (sql, params = []) => {
      calls.push({ sql, params, timestamp: Date.now() });

      const response = findResponse(sql);

      if (response) {
        // If response is a function, call it with params
        if (typeof response === 'function') {
          return response(sql, params);
        }

        // If response is an Error, throw it
        if (response instanceof Error) {
          throw response;
        }

        return response;
      }

      if (throwOnUnmatched) {
        throw new Error(`No mock response configured for query: ${sql}`);
      }

      // Default empty response
      return { rows: [], rowCount: 0 };
    },

    /**
     * Simulate getting a client connection
     * Returns an object with query() and release() methods
     */
    connect: async () => {
      connected = true;
      const clientCalls = [];

      return {
        query: async (sql, params = []) => {
          clientCalls.push({ sql, params, timestamp: Date.now() });
          calls.push({ sql, params, timestamp: Date.now(), viaClient: true });

          const response = findResponse(sql);

          if (response) {
            if (typeof response === 'function') {
              return response(sql, params);
            }
            if (response instanceof Error) {
              throw response;
            }
            return response;
          }

          if (throwOnUnmatched) {
            throw new Error(`No mock response configured for query: ${sql}`);
          }

          return { rows: [], rowCount: 0 };
        },
        release: () => {
          connected = false;
        },
        getCalls: () => clientCalls,
      };
    },

    /**
     * Simulate closing the connection pool
     */
    end: async () => {
      connected = false;
    },

    /**
     * Get all queries that were made
     * Useful for assertions about what queries were executed
     */
    getCalls: () => [...calls],

    /**
     * Get the last query that was made
     */
    getLastCall: () => calls[calls.length - 1] || null,

    /**
     * Clear all recorded calls
     */
    clearCalls: () => {
      calls.length = 0;
    },

    /**
     * Check if a specific query pattern was called
     */
    wasCalled: (pattern) => {
      return calls.some((call) => call.sql.includes(pattern));
    },

    /**
     * Get how many times a query pattern was called
     */
    callCount: (pattern) => {
      return calls.filter((call) => call.sql.includes(pattern)).length;
    },

    /**
     * Check if currently connected
     */
    isConnected: () => connected,

    /**
     * Add a response dynamically (useful for setting up specific test scenarios)
     */
    setResponse: (pattern, response) => {
      responses[pattern] = response;
    },

    /**
     * Remove a response
     */
    removeResponse: (pattern) => {
      delete responses[pattern];
    },
  };
}

/**
 * Create a mock database that simulates errors
 *
 * @param {Error} error - Error to throw on every query
 * @returns {Object} Mock database that throws on query
 */
export function createFailingDatabase(error = new Error('Database connection failed')) {
  return createMockDatabase({}, { throwOnUnmatched: false });
}

/**
 * Create a mock database pre-configured for common travel queries
 * Useful as a starting point for integration tests
 */
export function createTravelMockDatabase() {
  return createMockDatabase({
    // Cities
    'FROM geonames_cities': {
      rows: [
        { id: 1, name: 'Bangkok', country_code: 'TH', population: 8280925, latitude: 13.75, longitude: 100.5 },
        { id: 2, name: 'Chiang Mai', country_code: 'TH', population: 127240, latitude: 18.79, longitude: 98.98 },
      ],
      rowCount: 2,
    },

    // Countries
    'FROM geonames_countries': {
      rows: [
        { iso: 'TH', name: 'Thailand', capital: 'Bangkok', population: 69950850 },
        { iso: 'JP', name: 'Japan', capital: 'Tokyo', population: 126476461 },
      ],
      rowCount: 2,
    },

    // POIs
    'FROM osm_pois': {
      rows: [
        { osm_id: 'n123', name: 'Grand Palace Hotel', poi_type: 'hotel', latitude: 13.75, longitude: 100.49 },
        { osm_id: 'n456', name: 'Sukhumvit Restaurant', poi_type: 'restaurant', latitude: 13.74, longitude: 100.56 },
      ],
      rowCount: 2,
    },

    // Import sources
    'FROM import_sources': {
      rows: [
        { id: 1, keyword: 'thailand', display_name: 'Thailand', enabled: true, refresh_interval_days: 30 },
        { id: 2, keyword: 'japan', display_name: 'Japan', enabled: true, refresh_interval_days: 30 },
      ],
      rowCount: 2,
    },

    // Import log
    'FROM import_log': {
      rows: [],
      rowCount: 0,
    },

    // Default INSERT response
    INSERT: {
      rows: [{ id: 1 }],
      rowCount: 1,
    },

    // Default UPDATE response
    UPDATE: {
      rows: [],
      rowCount: 1,
    },

    // Default DELETE response
    DELETE: {
      rows: [],
      rowCount: 0,
    },
  });
}

export default { createMockDatabase, createFailingDatabase, createTravelMockDatabase };
