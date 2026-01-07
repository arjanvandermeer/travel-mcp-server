#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { HotelDatabase } from './database.js';
import { toolsConfig, executeToolHandler } from './tools-config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Log errors to file for debugging
function logError(message, error = null) {
  const logPath = join(__dirname, '../mcp-server.log');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}${error ? '\n' + error.stack : ''}\n`;
  try {
    writeFileSync(logPath, logMessage, { flag: 'a' });
  } catch (e) {
    // Silently fail if we can't write logs
  }
}

// Initialize database with absolute path
try {
  const dbPath = join(__dirname, '../data/hotels.db');
  logError(`Initializing database at: ${dbPath}`);
  var db = new HotelDatabase(dbPath);
  logError('Database initialized successfully');
} catch (error) {
  logError('Failed to initialize database', error);
  process.exit(1);
}

// Create MCP server
const server = new Server(
  {
    name: 'hotel-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools using shared configuration
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: toolsConfig,
  };
});

// Handle tool execution using shared handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return executeToolHandler(name, args, db);
});

/**
 * Start the server
 */
async function main() {
  try {
    logError('Starting MCP server...');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logError('MCP server connected successfully');
  } catch (error) {
    logError('Error in main()', error);
    throw error;
  }
}

main().catch((error) => {
  logError('Fatal error in main', error);
  console.error('Fatal error:', error);
  process.exit(1);
});