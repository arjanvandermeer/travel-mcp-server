#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { HotelDatabase } from './database.js';
import { toolsConfig, executeToolHandler } from './tools-config.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new HotelDatabase();

// Create MCP server
const server = new Server(
  {
    name: 'hotel-info',
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

// SSE endpoint
app.get('/sse', async (req, res) => {
  console.log('New SSE connection');
  const transport = new SSEServerTransport('/message', res);
  await server.connect(transport);
});

// POST endpoint for messages
app.post('/message', express.json(), async (req, res) => {
  // This is handled by the SSE transport
  res.status(200).send();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: db.getStats() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Hotel MCP Server (HTTP) running on http://localhost:${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('\nTo use with Claude Desktop, add to config:');
  console.log(`{
  "mcpServers": {
    "hotel-info": {
      "url": "http://localhost:${PORT}/sse"
    }
  }
}`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nClosing database...');
  db.close();
  process.exit(0);
});
