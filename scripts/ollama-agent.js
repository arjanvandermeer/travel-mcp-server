#!/usr/bin/env node

/**
 * Ollama Agent for Travel Questions
 *
 * Uses a local SLM (via Ollama) to answer travel questions by calling
 * the travel-mcp-server tools through REST API or MCP protocol.
 *
 * Usage:
 *   node src/ollama-agent.js "what's the distance between coco51 and hua hin station"
 *   node src/ollama-agent.js --mode mcp-http "hotels in hua hin"
 *   node src/ollama-agent.js --mode mcp-stdio "find restaurants near coco51"
 *   node src/ollama-agent.js                  # interactive REPL mode
 *
 * Environment:
 *   OLLAMA_MODEL    — default: qwen2.5:3b
 *   OLLAMA_URL      — default: http://localhost:11434
 *   TRAVEL_API_URL  — default: http://localhost:3000
 */

import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:latest';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const TRAVEL_API_URL = process.env.TRAVEL_API_URL || 'http://localhost:3000';
const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are a travel assistant with access to a database of hotels, restaurants, and points of interest.
Use the provided tools to look up real data. Never guess locations or distances.
When asked about distance between places, first search for each place to get its coordinates, then use calculate_distance with those coordinates.
When asked about places near something, first search for that place to get its coordinates, then search with those coordinates.
Keep answers concise and factual.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_pois',
      description: 'Search for any place (hotel, restaurant, attraction, station, etc.) by name. Returns name, type, coordinates, and city.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Place name to search for' },
          poi_type: { type: 'string', description: 'Filter by type: hotel, restaurant, cafe, bar, attraction, museum, monument, etc.' },
          city_name: { type: 'string', description: 'Filter by city name' },
          country_code: { type: 'string', description: '2-letter country code, e.g. TH, JP' },
          latitude: { type: 'number', description: 'Search near this latitude' },
          longitude: { type: 'number', description: 'Search near this longitude' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_hotels',
      description: 'Search for hotels, hostels, guest houses, or resorts. Use when specifically looking for accommodation.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Hotel name to search for' },
          city_name: { type: 'string', description: 'City to search in' },
          country_code: { type: 'string', description: '2-letter country code' },
          latitude: { type: 'number', description: 'Search near this latitude' },
          longitude: { type: 'number', description: 'Search near this longitude' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_restaurants',
      description: 'Search for restaurants, cafes, bars, or food places. Use when specifically looking for food and drink.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Restaurant name to search for' },
          city_name: { type: 'string', description: 'City to search in' },
          country_code: { type: 'string', description: '2-letter country code' },
          latitude: { type: 'number', description: 'Search near this latitude' },
          longitude: { type: 'number', description: 'Search near this longitude' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_poi_details',
      description: 'Get full details of a specific place by its OSM ID. Use after searching to get more information like phone, website, opening hours.',
      parameters: {
        type: 'object',
        properties: {
          osm_id: { type: 'number', description: 'The OSM ID of the place' },
        },
        required: ['osm_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_distance',
      description: 'Calculate the straight-line distance in kilometers between two coordinate pairs. Use after searching for places to find how far apart they are.',
      parameters: {
        type: 'object',
        properties: {
          lat1: { type: 'number', description: 'Latitude of first place' },
          lon1: { type: 'number', description: 'Longitude of first place' },
          lat2: { type: 'number', description: 'Latitude of second place' },
          lon2: { type: 'number', description: 'Longitude of second place' },
        },
        required: ['lat1', 'lon1', 'lat2', 'lon2'],
      },
    },
  },
];

// --- Haversine distance (copied from database.js:1443) ---

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = R * c;
  return { distance_km: Math.round(meters / 10) / 100, distance_meters: Math.round(meters) };
}

// --- Result trimming (keep responses small for SLM) ---

const POI_SEARCH_FIELDS = ['osm_id', 'name', 'name_en', 'poi_type', 'latitude', 'longitude', 'city_name', 'address'];
const POI_DETAIL_FIELDS = ['osm_id', 'name', 'name_en', 'poi_type', 'latitude', 'longitude', 'address', 'phone', 'website', 'opening_hours', 'rating', 'stars'];

function trimResult(data, fields) {
  if (Array.isArray(data)) {
    return data.map(item => trimResult(item, fields));
  }
  if (data && typeof data === 'object') {
    const trimmed = {};
    for (const key of fields) {
      if (data[key] != null) trimmed[key] = data[key];
    }
    return trimmed;
  }
  return data;
}

function trimToolResult(toolName, result) {
  if (toolName === 'get_poi_details') {
    return trimResult(result, POI_DETAIL_FIELDS);
  }
  if (result?.results) {
    return { results: trimResult(result.results, POI_SEARCH_FIELDS), count: result.count };
  }
  return result;
}

// --- REST Backend ---

class RestBackend {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async callTool(name, args) {
    if (name === 'calculate_distance') {
      return calculateDistance(args.lat1, args.lon1, args.lat2, args.lon2);
    }

    const url = this._buildUrl(name, args);
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json();
    return trimToolResult(name, data);
  }

  _buildUrl(name, args) {
    const params = new URLSearchParams();

    if (name === 'get_poi_details') {
      return `${this.baseUrl}/api/v1/poi/${args.osm_id}`;
    }

    // Map tool name to poi_type filter
    if (name === 'search_hotels') params.set('poi_type', 'hotel');
    if (name === 'search_restaurants') params.set('poi_type', 'restaurant');

    if (args.query) params.set('q', args.query);
    if (args.poi_type && name === 'search_pois') params.set('poi_type', args.poi_type);
    if (args.city_name) params.set('city_name', args.city_name);
    if (args.country_code) params.set('country_code', args.country_code);
    if (args.latitude) params.set('latitude', String(args.latitude));
    if (args.longitude) params.set('longitude', String(args.longitude));
    params.set('limit', String(args.limit || 5));

    return `${this.baseUrl}/api/v1/search/pois?${params}`;
  }

  async close() {}
}

// --- MCP Backend ---

class McpBackend {
  constructor(mode) {
    this.mode = mode; // 'mcp-http' or 'mcp-stdio'
    this.client = null;
    this.transport = null;
  }

  async connect() {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

    this.client = new Client({ name: 'ollama-agent', version: '1.0.0' });

    if (this.mode === 'mcp-http') {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      this.transport = new StreamableHTTPClientTransport(new URL(`${TRAVEL_API_URL}/mcp`));
    } else {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      this.transport = new StdioClientTransport({
        command: 'node',
        args: [path.join(__dirname, '..', 'src', 'index.js')],
        stderr: 'inherit',
      });
    }

    await this.client.connect(this.transport);
  }

  async callTool(name, args) {
    if (name === 'calculate_distance') {
      return calculateDistance(args.lat1, args.lon1, args.lat2, args.lon2);
    }

    // Map our simplified tool names to the MCP server's tool names
    const mcpName = name === 'search_hotels' || name === 'search_restaurants' ? name : name;

    // Build MCP tool arguments
    const mcpArgs = { ...args };
    if (name === 'search_pois' || name === 'search_hotels' || name === 'search_restaurants') {
      if (mcpArgs.query) { mcpArgs.name = mcpArgs.query; delete mcpArgs.query; }
      if (mcpArgs.city_name) { mcpArgs.city = mcpArgs.city_name; delete mcpArgs.city_name; }
    }

    const result = await this.client.callTool({ name: mcpName, arguments: mcpArgs });

    // MCP returns content as array of {type, text} — parse the text
    if (result?.content?.[0]?.text) {
      try {
        const parsed = JSON.parse(result.content[0].text);
        return trimToolResult(name, parsed);
      } catch {
        return result.content[0].text;
      }
    }
    return result;
  }

  async close() {
    if (this.client) await this.client.close();
  }
}

// --- Ollama Chat ---

async function chatWithOllama(messages) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      tools: TOOLS,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  return res.json();
}

// --- Agent Loop ---

async function runAgent(question, backend, messages = []) {
  if (messages.length === 0) {
    messages.push({ role: 'system', content: SYSTEM_PROMPT });
  }
  messages.push({ role: 'user', content: question });

  let emptyTurns = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await chatWithOllama(messages);
    const msg = response.message;

    if (!msg) {
      console.error('No message in Ollama response');
      break;
    }

    messages.push(msg);

    // If the model produced tool calls, execute them
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      emptyTurns = 0;
      for (const call of msg.tool_calls) {
        const { name, arguments: args } = call.function;
        process.stderr.write(`  → ${name}(${JSON.stringify(args)})\n`);

        try {
          const result = await backend.callTool(name, args);
          process.stderr.write(`  ← ${JSON.stringify(result).slice(0, 200)}\n`);
          messages.push({ role: 'tool', content: JSON.stringify(result) });
        } catch (err) {
          const errMsg = `Error calling ${name}: ${err.message}`;
          process.stderr.write(`  ← ${errMsg}\n`);
          messages.push({ role: 'tool', content: JSON.stringify({ error: errMsg }) });
        }
      }
    } else if (msg.content) {
      // Model produced a final answer
      console.log(`\n${msg.content}`);
      return messages;
    } else {
      emptyTurns++;
      if (emptyTurns >= 2) {
        console.log("\nI couldn't find the information you're looking for. Try asking differently.");
        return messages;
      }
    }
  }

  console.log('\nReached maximum iterations. Here is what I have so far.');
  return messages;
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  let mode = 'rest';
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node src/ollama-agent.js [--mode rest|mcp-http|mcp-stdio] [question]

  Modes:
    rest       (default) HTTP calls to ${TRAVEL_API_URL}/api/v1/*
    mcp-http   MCP client via StreamableHTTP to ${TRAVEL_API_URL}/mcp
    mcp-stdio  MCP client spawning node src/index.js via stdio (no HTTP server needed)

  Environment:
    OLLAMA_MODEL=${OLLAMA_MODEL}  OLLAMA_URL=${OLLAMA_URL}  TRAVEL_API_URL=${TRAVEL_API_URL}`);
      return;
    } else {
      positional.push(args[i]);
    }
  }

  // Create backend
  let backend;
  if (mode === 'rest') {
    backend = new RestBackend(TRAVEL_API_URL);
  } else if (mode === 'mcp-http' || mode === 'mcp-stdio') {
    backend = new McpBackend(mode);
    process.stderr.write(`Connecting via ${mode}...\n`);
    await backend.connect();
    process.stderr.write('Connected.\n');
  } else {
    console.error(`Unknown mode: ${mode}. Use rest, mcp-http, or mcp-stdio.`);
    process.exit(1);
  }

  try {
    if (positional.length > 0) {
      // Single question mode
      await runAgent(positional.join(' '), backend);
    } else {
      // Interactive REPL mode
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      let messages = [{ role: 'system', content: SYSTEM_PROMPT }];

      console.log(`Travel Agent (${OLLAMA_MODEL}, ${mode} mode). Type your question or Ctrl-C to exit.\n`);

      const ask = () => rl.question('> ', async (line) => {
        const q = line.trim();
        if (!q) return ask();
        messages.push({ role: 'user', content: q });
        // Remove the user message that runAgent will add (it adds its own)
        const lastUserMsg = messages.pop();
        messages = await runAgent(lastUserMsg.content, backend, messages);
        console.log('');
        ask();
      });
      ask();

      // Keep process alive
      await new Promise(() => {});
    }
  } finally {
    await backend.close();
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
