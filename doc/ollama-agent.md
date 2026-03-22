# Ollama Agent

A local AI travel assistant that uses a small language model (SLM) running in [Ollama](https://ollama.com) to answer travel questions by querying the travel-mcp-server database.

## How It Works

The agent sends your question to a local Ollama model along with tool definitions. The model decides which tools to call, the agent executes them against the travel database, feeds the results back, and the model generates a natural language answer.

```
You: "what's the distance between coco51 and hua hin station"

Agent → Ollama: (question + tool definitions)
Agent ← Ollama: search_pois(query="coco51")
Agent → REST API: GET /api/v1/search/pois?q=coco51
Agent ← REST API: { name: "Coco 51", lat: 12.57, lon: 99.95 }
Agent → Ollama: (tool result)
Agent ← Ollama: search_pois(query="hua hin station")
Agent → REST API: GET /api/v1/search/pois?q=hua+hin+station
Agent ← REST API: { name: "Hua Hin Railway Station", lat: 12.56, lon: 99.95 }
Agent → Ollama: (tool result)
Agent ← Ollama: calculate_distance(lat1=12.57, lon1=99.95, lat2=12.56, lon2=99.95)
Agent: (computes locally) → { distance_km: 1.23 }
Agent → Ollama: (tool result)
Agent ← Ollama: "Coco 51 is about 1.2 km from Hua Hin Railway Station"
```

## Prerequisites

- [Ollama](https://ollama.com) installed and running
- A model pulled: `ollama pull qwen3.5`
- The travel-mcp-server database and HTTP server running

## Quick Start

```bash
# Start the database and HTTP server
docker compose up -d
node src/index-http.js &

# Ask a question
npm run agent "what's the distance between coco51 and hua hin station"

# Interactive mode
npm run agent
```

## Usage

```bash
# Single question (REST mode, default)
node scripts/ollama-agent.js "hotels in hua hin"

# MCP over HTTP mode
node scripts/ollama-agent.js --mode mcp-http "find restaurants near coco51"

# MCP over stdio mode (spawns its own MCP server process)
node scripts/ollama-agent.js --mode mcp-stdio "attractions in bangkok"

# Interactive REPL (multi-turn conversation)
node scripts/ollama-agent.js
```

## Backend Modes

| Mode | Flag | Connects To | Notes |
|------|------|------------|-------|
| REST API | `--mode rest` (default) | `localhost:3000/api/v1/*` | Simplest, uses existing HTTP endpoints |
| MCP HTTP | `--mode mcp-http` | `localhost:3000/mcp` | Uses MCP protocol over StreamableHTTP |
| MCP stdio | `--mode mcp-stdio` | spawns `node src/index.js` | Uses MCP protocol over stdio, no HTTP server needed |

## Available Tools

The agent exposes 5 tools to the SLM:

| Tool | Description |
|------|-------------|
| `search_pois` | Search any place by name (hotels, restaurants, attractions, stations) |
| `search_hotels` | Search specifically for hotels and accommodation |
| `search_restaurants` | Search specifically for restaurants and food places |
| `get_poi_details` | Get full details of a place by its OSM ID |
| `calculate_distance` | Calculate straight-line distance between two coordinates (local, no API call) |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `OLLAMA_MODEL` | `qwen3.5:latest` | Ollama model to use |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `TRAVEL_API_URL` | `http://localhost:3000` | Travel MCP server URL |

## Example Questions

- "What's the distance between coco51 and hua hin station?"
- "Find hotels in Hua Hin"
- "Are there any restaurants near Coco 51?"
- "What attractions are in Bangkok?"
- "Tell me about Wat Arun" (searches and gets details)

## Design Notes

**Result trimming**: Search results are trimmed to essential fields (name, type, coordinates, city) before being sent back to the SLM. This keeps the context window small and helps the model reason clearly.

**Tool count**: Only 5 tools are exposed (vs. 21 available MCP tools). Smaller models perform better with fewer, well-described tools.

**Max iterations**: The agent loop runs for at most 10 iterations to prevent runaway conversations. Most questions resolve in 2-4 iterations.

**Local distance calculation**: The `calculate_distance` tool runs Haversine math locally instead of calling the server — it's a pure utility that doesn't need database access.
