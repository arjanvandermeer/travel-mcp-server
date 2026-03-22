# SLM — Local AI Travel Agent

A local AI travel assistant that uses a small language model (SLM) running in [Ollama](https://ollama.com) to answer travel questions by querying the travel-mcp-server database. Useful for testing the server's tools end-to-end without a cloud LLM, running offline demos, and experimenting with how small models handle tool-calling workflows.

## Files

| File | Description |
|------|-------------|
| [ollama-agent.js](ollama-agent.js) | The agent — connects a local Ollama model to the travel database via tool calling. Supports REST API, MCP-over-HTTP, and MCP-over-stdio backends. Includes an interactive REPL for multi-turn conversations. |
| [test-ollama-agent.js](test-ollama-agent.js) | Test harness — runs 20 diverse travel questions through the agent and validates that each gets a non-empty answer, uses the expected tools, and doesn't hit the iteration limit. Useful for evaluating model quality after switching models or changing prompts. |
| [README.md](README.md) | This documentation. |

## When Is This Useful?

- **Offline development** — test the full tool-calling loop without cloud API keys or internet
- **Model evaluation** — compare how different Ollama models (Qwen, Llama, Mistral, etc.) handle the travel tools
- **Prompt tuning** — iterate on system prompts and few-shot examples, then validate with the 20-question test suite
- **Integration testing** — verify the REST API and MCP endpoints work correctly from a real agent's perspective
- **Demos** — show the travel database in action with a conversational interface

## How It Works

The agent sends your question to a local Ollama model along with tool definitions. The model decides which tools to call, the agent executes them against the travel database, feeds the results back, and the model generates a streamed natural language answer.

```
You: "what's the distance between coco51 and hua hin station"

Agent → Ollama: (question + tool definitions)
Agent ← Ollama: search_pois("coco51"), search_pois("hua hin station")  [parallel]
Agent → REST API: GET /api/v1/search/pois?q=coco51
Agent → REST API: GET /api/v1/search/pois?q=hua+hin+station            [concurrent]
Agent ← REST API: { name: "Coco 51", lat: 12.57, lon: 99.95 }
Agent ← REST API: { name: "Hua Hin Railway Station", lat: 12.56, lon: 99.95 }
Agent → Ollama: (both tool results)
Agent ← Ollama: calculate_distance(lat1=12.57, lon1=99.95, lat2=12.56, lon2=99.95)
Agent: (computes locally) → { distance_km: 1.23 }
Agent → Ollama: (tool result)
Agent ← Ollama: "Coco 51 is about 1.2 km from Hua Hin Railway Station" [streamed]
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

### ollama-agent.js

The agent supports three backend modes for communicating with the travel server, plus an interactive REPL.

```bash
# Single question (REST mode, default)
node slm/ollama-agent.js "hotels in hua hin"

# MCP over HTTP mode (auto-discovers all server tools)
node slm/ollama-agent.js --mode mcp-http "find restaurants near coco51"

# MCP over stdio mode (spawns its own MCP server process)
node slm/ollama-agent.js --mode mcp-stdio "attractions in bangkok"

# Custom temperature (default: 0.2)
node slm/ollama-agent.js --temperature 0.5 "tell me about coco 51"

# Interactive REPL (multi-turn conversation)
node slm/ollama-agent.js
```

### test-ollama-agent.js

The test harness runs each question as a separate subprocess, captures stdout (the answer) and stderr (tool call logs), then checks:
- The answer is non-empty and doesn't say "couldn't find information"
- At least one expected tool was called
- The answer matches an expected regex pattern
- The agent didn't time out or hit max iterations

```bash
npm run test:agent                            # run all 20 tests
node slm/test-ollama-agent.js --dry-run       # list questions only
node slm/test-ollama-agent.js --filter 3      # run single test
node slm/test-ollama-agent.js --filter 1-5    # run range
```

## Backend Modes

| Mode | Flag | Connects To | Notes |
|------|------|------------|-------|
| REST API | `--mode rest` (default) | `localhost:3000/api/v1/*` | Simplest, uses existing HTTP endpoints |
| MCP HTTP | `--mode mcp-http` | `localhost:3000/mcp` | Auto-discovers all MCP tools via `listTools()` |
| MCP stdio | `--mode mcp-stdio` | spawns `node src/index.js` | Auto-discovers tools, no HTTP server needed |

## Available Tools

**REST mode** exposes 5 hardcoded tools:

| Tool | Description |
|------|-------------|
| `search_pois` | Search any place by name (hotels, restaurants, attractions, stations) |
| `search_hotels` | Search specifically for hotels and accommodation |
| `search_restaurants` | Search specifically for restaurants and food places |
| `get_poi_details` | Get full details of a place by its OSM ID |
| `calculate_distance` | Calculate straight-line distance between two coordinates (local, no API call) |

**MCP modes** dynamically discover all server tools (excluding `_ui` variants) and add `calculate_distance` locally.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `OLLAMA_MODEL` | `qwen3.5:latest` | Ollama model to use |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `TRAVEL_API_URL` | `http://localhost:3000` | Travel MCP server URL |

| CLI Flag | Default | Description |
|----------|---------|-------------|
| `--mode` | `rest` | Backend: `rest`, `mcp-http`, or `mcp-stdio` |
| `--temperature` | `0.2` | Sampling temperature (lower = more deterministic) |

## Example Questions

- "What's the distance between coco51 and hua hin station?"
- "Find hotels in Hua Hin"
- "Are there any restaurants near Coco 51?"
- "What attractions are in Bangkok?"
- "Tell me about Wat Arun" (searches and gets details)

## Connecting Your Own Application

You can build your own agent that talks to Ollama and the travel REST API. The pattern is a simple loop: send a question with tool definitions → execute any tool calls → feed results back → repeat until the model gives a final answer.

### 1. Setup

Make sure Ollama is running with a model that supports tool calling:

```bash
ollama pull qwen3.5
ollama serve   # if not already running
```

Start the travel server:

```bash
docker compose up -d
node src/index-http.js
```

### 2. The tool-calling loop

```
┌─────────────────────────────────────────────┐
│  Send messages + tools to Ollama            │
│  POST http://localhost:11434/api/chat       │
└──────────────────┬──────────────────────────┘
                   │
           ┌───────▼───────┐
           │ tool_calls    │──yes──▶ Execute tools against REST API
           │ in response?  │        Append results to messages
           └───────┬───────┘        Loop back to top
                   │ no
                   ▼
           Print final answer
```

### 3. Define tools (Ollama uses the OpenAI function calling format)

```json
{
  "type": "function",
  "function": {
    "name": "search_pois",
    "description": "Search for places by name",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Place name" }
      },
      "required": ["query"]
    }
  }
}
```

### 4. Call Ollama

```bash
curl http://localhost:11434/api/chat -d '{
  "model": "qwen3.5",
  "stream": false,
  "messages": [
    {"role": "system", "content": "You are a travel assistant. Use tools to look up data."},
    {"role": "user", "content": "hotels in hua hin"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_hotels",
        "description": "Search hotels by name or city",
        "parameters": {
          "type": "object",
          "properties": {
            "city_name": {"type": "string"},
            "query": {"type": "string"}
          }
        }
      }
    }
  ]
}'
```

If the response contains `tool_calls`, execute them against the REST API:

```bash
# The model will request something like:
# search_hotels(city_name="Hua Hin")
# Execute it:
curl "http://localhost:3000/api/v1/search/pois?poi_type=hotel&city_name=Hua+Hin&limit=5"
```

Then send the result back as a `tool` message and let the model generate the final answer.

### 5. REST API endpoints for tools

| Tool | REST Endpoint |
|------|--------------|
| `search_pois` | `GET /api/v1/search/pois?q={query}&poi_type={type}&city_name={city}&limit=5` |
| `search_hotels` | `GET /api/v1/search/pois?q={query}&poi_type=hotel&city_name={city}&limit=5` |
| `search_restaurants` | `GET /api/v1/search/pois?q={query}&poi_type=restaurant&city_name={city}&limit=5` |
| `get_poi_details` | `GET /api/v1/poi/{osm_id}` |

All search endpoints also accept `latitude`, `longitude` for coordinate-based search and `country_code` for filtering.

### 6. Minimal Python example

```python
import requests, json

OLLAMA = "http://localhost:11434/api/chat"
API = "http://localhost:3000/api/v1"
TOOLS = [...]  # tool definitions as above

messages = [
    {"role": "system", "content": "You are a travel assistant. Use tools to look up data."},
    {"role": "user", "content": "hotels in hua hin"},
]

for _ in range(10):  # max iterations
    resp = requests.post(OLLAMA, json={
        "model": "qwen3.5", "messages": messages, "tools": TOOLS, "stream": False
    }).json()

    msg = resp["message"]
    messages.append(msg)

    if not msg.get("tool_calls"):
        print(msg["content"])
        break

    for call in msg["tool_calls"]:
        name = call["function"]["name"]
        args = call["function"]["arguments"]
        # Execute against REST API
        result = requests.get(f"{API}/search/pois", params={"q": args.get("query"), "limit": 5}).json()
        messages.append({"role": "tool", "content": json.dumps(result)})
```

### 7. Tips for small models

- **Keep tool count low** (5-7 tools max) — fewer choices = better decisions
- **Trim results** — strip fields the model doesn't need (coordinates, IDs)
- **Use low temperature** (0.1-0.3) for reliable tool calling
- **Add few-shot examples** to the system prompt showing the expected tool sequence
- **Set a max iteration limit** — small models can loop

## Design Notes

**Non-streaming for reliability**: All Ollama requests use `stream: false` for reliable JSON parsing. The final answer has `<think>` blocks stripped automatically (Qwen 3.5 reasoning mode).

**Parallel tool execution**: When the model issues multiple tool calls in one turn (e.g., searching for two places at once), they execute concurrently via `Promise.all()`.

**Few-shot system prompt**: The system prompt includes concrete examples of tool-calling patterns (distance, nearby, city search) to guide the model.

**Dynamic MCP tool discovery**: In MCP mode, the agent calls `listTools()` after connecting and converts MCP schemas to Ollama format automatically. New server tools are available without code changes.

**Result trimming**: Search results are trimmed to essential fields (name, type, coordinates, city) before being sent back to the SLM. This keeps the context window small.

**Conversation memory**: In REPL mode, message history is trimmed to the last 30 messages (keeping the system prompt) to prevent context overflow.

**Temperature**: Defaults to 0.2 for deterministic tool calling. Override with `--temperature` for more creative responses.

**Local distance calculation**: The `calculate_distance` tool runs Haversine math locally — no API call needed.
