#!/usr/bin/env node

/**
 * MCP Server with PostgreSQL backend
 * Provides travel information tools using GeoNames and OSM data
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TravelDatabase } from './database.js';
import * as telemetry from './telemetry.js';
import { render } from './templates/index.js';
import { toolsConfig, resourcesConfig, executeToolHandler, handleReadResource } from './tools-config.js';
import { versionInfo, getVersionString } from './version.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Debug logging - writes to file since stdio is used for MCP protocol
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', 'mcp-debug.log');

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] [${level}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] [${level}] ${message}`;

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

const server = new Server(
  {
    name: 'travel-mcp-server',
    version: getVersionString(),
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('INFO', 'ListTools request received');
  return { tools: toolsConfig };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log('INFO', `Tool call received: ${name}`, args);

  // Add breadcrumb for debugging
  telemetry.addBreadcrumb(`Tool call: ${name}`, 'mcp.tool', args);

  return telemetry.withTransaction(`mcp.tool.${name}`, 'mcp.request', async () => {
    try {
      const result = await executeToolHandler(name, args, db);
      log('INFO', `${name} completed successfully`);
      return result;
    } catch (error) {
      log('ERROR', `Tool ${name} failed`, { error: error.message, stack: error.stack });
      telemetry.captureException(error, { tool: name, args });
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });
});

// List available resources (MCP Apps)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  log('INFO', 'ListResources request received');
  return resourcesConfig;
});

// Read resource content (MCP Apps)
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  log('INFO', `ReadResource request received: ${uri}`);
  return handleReadResource(uri, db, render);
});

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
