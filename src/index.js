#!/usr/bin/env node

// IMPORTANT: Import Sentry first for auto-instrumentation of pg, http, etc.
import './sentry-init.js';

/**
 * MCP Server with PostgreSQL backend
 * Provides travel information tools using GeoNames and OSM data
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TravelDatabase } from './database.js';
import * as telemetry from './telemetry.js';
import { createTravelMCPServer } from './mcp-server-factory.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Debug logging - writes to file since stdio is used for MCP protocol
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', 'mcp-debug.log');
const LOG_FILE_ROTATED = LOG_FILE + '.1';
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function rotateLogIfNeeded() {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= LOG_MAX_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE_ROTATED);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] [${level}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] [${level}] ${message}`;

  // Rotate if over 10 MB
  rotateLogIfNeeded();

  // Write to log file
  fs.appendFileSync(LOG_FILE, logLine + '\n');

  // Also write to stderr for immediate visibility
  console.error(logLine);
}

log('INFO', 'MCP Server starting...');
log('INFO', 'Log file', LOG_FILE);

let db;
try {
  db = new TravelDatabase();
  log('INFO', 'TravelDatabase instance created');
} catch (err) {
  log('ERROR', 'Failed to create TravelDatabase', err.message);
  process.exit(1);
}

const server = createTravelMCPServer({ db, log });

// Start server
async function main() {
  // Test database connection before starting
  log('INFO', 'Testing database connection...');
  try {
    await db.testConnection();
    log('INFO', 'Database connection successful');
  } catch (err) {
    // Handle AggregateError (multiple connection attempts failed)
    const errorMsg = err.code || err.message || (err.errors ? err.errors.map(e => e.code || e.message).join(', ') : 'Unknown error');
    log('ERROR', 'Database connection failed', { error: errorMsg, code: err.code });
    console.error(`FATAL: Cannot connect to database: ${errorMsg}`);
    console.error('Make sure PostgreSQL is running (docker start travel-postgres or brew services start postgresql@16)');
    process.exit(1);
  }

  log('INFO', 'Initializing Google Places client...');
  try {
    await db.initializeGooglePlaces();
    log('INFO', 'Google Places client initialized');
  } catch (err) {
    log('WARN', 'Failed to initialize Google Places client', err.message);
  }

  // Initialize telemetry (after database is ready to load config)
  log('INFO', 'Initializing telemetry...');
  try {
    const telemetryConfig = await db.getTelemetryConfig();
    await telemetry.initTelemetry(telemetryConfig);
    if (telemetry.isEnabled()) {
      log('INFO', 'Telemetry initialized successfully');
      telemetry.setTag('server.type', 'stdio');
    } else {
      log('INFO', 'Telemetry is disabled (no SENTRY_DSN configured)');
    }
  } catch (err) {
    log('WARN', 'Failed to initialize telemetry', err.message);
    // Continue without telemetry
  }

  log('INFO', 'Creating StdioServerTransport...');
  const transport = new StdioServerTransport();

  log('INFO', 'Connecting server to transport...');
  await server.connect(transport);

  log('INFO', 'Travel MCP Server (PostgreSQL) running on stdio');
  console.error('Travel MCP Server (PostgreSQL) running on stdio');
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  log('INFO', 'SIGTERM received, shutting down...');
  await telemetry.flush();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log('INFO', 'SIGINT received, shutting down...');
  await telemetry.flush();
  process.exit(0);
});

main().catch(async (error) => {
  log('ERROR', 'Server startup failed', { error: error.message, stack: error.stack });
  telemetry.captureException(error, { context: 'server_startup' });
  await telemetry.flush();
  console.error('Server error:', error);
  process.exit(1);
});
