/**
 * Database Interface Factory
 *
 * Provides dependency injection for database connections.
 * This module allows creating TravelDatabase instances with:
 * - Default pool (production mode)
 * - Injected pool (for testing with mocks)
 *
 * @module db-interface
 */

import pg from 'pg';
import TravelDatabase from './database.js';

const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://traveluser:travelpass@localhost:5432/travel';

/**
 * Create a database instance with optional pool injection
 *
 * @param {Object} options - Configuration options
 * @param {pg.Pool} options.pool - Optional: inject a custom pool (for testing)
 * @param {string} options.connectionString - Optional: custom connection string
 * @returns {TravelDatabase} Database instance
 *
 * @example
 * // Production usage (uses default pool)
 * const db = createDatabase();
 *
 * @example
 * // Testing with mock pool
 * const mockPool = createMockDatabase({ ... });
 * const db = createDatabase({ pool: mockPool });
 *
 * @example
 * // Custom connection string
 * const db = createDatabase({ connectionString: 'postgresql://...' });
 */
export function createDatabase(options = {}) {
  const { pool, connectionString } = options;

  if (pool) {
    // Use injected pool (for testing)
    return new TravelDatabase({ pool });
  }

  // Create real pool with connection string
  const connStr = connectionString || CONNECTION_STRING;
  const realPool = new pg.Pool({ connectionString: connStr });
  return new TravelDatabase({ pool: realPool });
}

/**
 * Create a pool-like interface from a mock database
 * This adapts the mock database format to pg.Pool interface
 *
 * @param {Object} mockDb - Mock database from createMockDatabase()
 * @returns {Object} Pool-like object compatible with TravelDatabase
 */
export function createPoolFromMock(mockDb) {
  return {
    query: mockDb.query.bind(mockDb),
    connect: mockDb.connect.bind(mockDb),
    end: mockDb.end.bind(mockDb),
    // Add pool-specific methods
    on: () => {},
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  };
}

export default { createDatabase, createPoolFromMock };
