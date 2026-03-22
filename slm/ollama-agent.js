#!/usr/bin/env node

/**
 * Ollama Agent for Travel Questions
 *
 * Uses a local SLM (via Ollama) to answer travel questions by calling
 * the travel-mcp-server tools through REST API or MCP protocol.
 *
 * Usage:
 *   node slm/ollama-agent.js "what's the distance between coco51 and hua hin station"
 *   node slm/ollama-agent.js --mode mcp-http "hotels in hua hin"
 *   node slm/ollama-agent.js --mode mcp-stdio "find restaurants near coco51"
 *   node slm/ollama-agent.js                  # interactive REPL mode
 *
 * Environment:
 *   OLLAMA_MODEL    — default: qwen3.5:latest
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
const MAX_CONTEXT_MESSAGES = 30;

const SYSTEM_PROMPT = `You are a travel assistant with access to a database of hotels, restaurants, and points of interest.
Use the provided tools to look up real data. Never guess locations or distances.
Keep answers concise and factual.

## Tool usage patterns

Distance between two places:
1. search_pois(query="place A") → get latitude/longitude
2. search_pois(query="place B") → get latitude/longitude
3. calculate_distance(lat1, lon1, lat2, lon2) → get distance in km

Find places near a known place:
1. search_pois(query="known place") → get latitude/longitude
2. search_restaurants(latitude=..., longitude=...) → list nearby restaurants
   OR search_hotels(latitude=..., longitude=...) → list nearby hotels

Search by city:
1. search_hotels(city="Hua Hin") → list hotels in that city`;

const CALCULATE_DISTANCE_TOOL = {
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
};

const DEFAULT_TOOLS = [
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
  CALCULATE_DISTANCE_TOOL,
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

// --- MCP → Ollama tool conversion ---

function mcpToolToOllama(mcpTool) {
  return {
    type: 'function',
    function: {
      name: mcpTool.name,
      description: mcpTool.description || '',
      parameters: mcpTool.inputSchema,
    },
  };
}

// --- Conversation memory trimming ---

function trimMessages(messages, maxMessages = MAX_CONTEXT_MESSAGES) {
  if (messages.length <= maxMessages) return messages;
  // Always keep system prompt (first message)
  const system = messages[0];
  const recent = messages.slice(-(maxMessages - 1));
  return [system, ...recent];
}

// --- REST Backend ---

class RestBackend {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.tools = DEFAULT_TOOLS;
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
    this.tools = DEFAULT_TOOLS; // overwritten after connect with discovered tools
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

    // Dynamic tool discovery
    await this._discoverTools();
  }

  async _discoverTools() {
    const result = await this.client.listTools();
    const mcpTools = (result.tools || [])
      .filter(t => !t.name.endsWith('_ui'))  // Skip UI variants (return HTML)
      .map(mcpToolToOllama);

    // Always include local calculate_distance
    this.tools = [...mcpTools, CALCULATE_DISTANCE_TOOL];
    process.stderr.write(`  Discovered ${mcpTools.length} MCP tools + calculate_distance\n`);
  }

  async callTool(name, args) {
    if (name === 'calculate_distance') {
      return calculateDistance(args.lat1, args.lon1, args.lat2, args.lon2);
    }

    const result = await this.client.callTool({ name, arguments: args });

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

// --- Ollama Chat (non-streaming, for tool-calling turns) ---

async function chatWithOllama(messages, tools, temperature) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      tools,
      stream: false,
      options: { temperature },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  return res.json();
}

// --- Agent Loop ---

async function runAgent(question, backend, messages = [], temperature = 0.2) {
  if (messages.length === 0) {
    messages.push({ role: 'system', content: SYSTEM_PROMPT });
  }
  messages.push({ role: 'user', content: question });

  let emptyTurns = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await chatWithOllama(messages, backend.tools, temperature);
    const msg = response.message;

    if (!msg) {
      console.error('No message in Ollama response');
      break;
    }

    messages.push(msg);

    // If the model produced tool calls, execute them in parallel
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      emptyTurns = 0;

      // Log all calls
      for (const call of msg.tool_calls) {
        process.stderr.write(`  → ${call.function.name}(${JSON.stringify(call.function.arguments)})\n`);
      }

      // Execute in parallel
      const results = await Promise.all(
        msg.tool_calls.map(async (call) => {
          const { name, arguments: args } = call.function;
          try {
            const result = await backend.callTool(name, args);
            process.stderr.write(`  ← ${name}: ${JSON.stringify(result).slice(0, 200)}\n`);
            return { role: 'tool', content: JSON.stringify(result) };
          } catch (err) {
            const errMsg = `Error calling ${name}: ${err.message}`;
            process.stderr.write(`  ← ${errMsg}\n`);
            return { role: 'tool', content: JSON.stringify({ error: errMsg }) };
          }
        })
      );
      messages.push(...results);

    } else if (msg.content) {
      // Model produced a final answer — print it
      // Filter out any <think> blocks from the output
      const answer = msg.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      console.log(`\n${answer}`);
      return trimMessages(messages);

    } else {
      emptyTurns++;
      if (emptyTurns >= 2) {
        console.log("\nI couldn't find the information you're looking for. Try asking differently.");
        return trimMessages(messages);
      }
    }
  }

  console.log('\nReached maximum iterations. Here is what I have so far.');
  return trimMessages(messages);
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  let mode = 'rest';
  let temperature = 0.2;
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[++i];
    } else if (args[i] === '--temperature' && args[i + 1]) {
      temperature = parseFloat(args[++i]);
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node slm/ollama-agent.js [options] [question]

Options:
  --mode rest|mcp-http|mcp-stdio   Backend mode (default: rest)
  --temperature N                  Sampling temperature (default: 0.2)
  -h, --help                       Show this help

Modes:
  rest       (default) HTTP calls to ${TRAVEL_API_URL}/api/v1/*
  mcp-http   MCP client via StreamableHTTP to ${TRAVEL_API_URL}/mcp
  mcp-stdio  MCP client spawning node src/index.js via stdio

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
      await runAgent(positional.join(' '), backend, [], temperature);
    } else {
      // Interactive REPL mode
      let messages = [{ role: 'system', content: SYSTEM_PROMPT }];

      console.log(`Travel Agent (${OLLAMA_MODEL}, ${mode} mode). Type your question or Ctrl-C to exit.\n`);

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = () => rl.question('> ', async (line) => {
        const q = line.trim();
        if (!q) return ask();
        messages = await runAgent(q, backend, messages, temperature);
        console.log('');
        ask();
      });
      ask();

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
