# Architecture And Request Flows

This document names the authoritative layers in the Travel MCP Server and the request paths that should guide future changes.

## Layers

| Layer | Authoritative modules | Responsibility |
|---|---|---|
| Transport | `src/index.js`, `src/index-http.js` | Owns MCP stdio, Streamable HTTP, HTTP routes, sessions, startup, shutdown, and telemetry bootstrap. |
| Tools contract | `src/tools-config.js`, `src/resources-config.js` | Owns MCP tool schemas, widget resource declarations, argument validation, and handler dispatch. |
| Database and business logic | `src/database.js`, `src/database-*-methods.js` | Owns Postgres access, query composition, POI ranking/scoring, favorites, import tracking, and user data methods. |
| Enrichment | `src/google-places.js`, `src/google-places-matching.js`, enrichment methods on `TravelDatabase` | Owns Google Places matching, quota accounting, cache status, place details, photos, and mapping state. |
| Auth worker | Cloudflare OAuth issuer documented in `doc/authentication.md` | Owns Google OAuth login, PKCE, dynamic client registration, token issuance, and introspection responses. |
| MCP widgets | Handlebars templates in `src/templates/`, `src/resources-config.js`, `src/poi-view-utils.js` | Owns rendered MCP App widgets and resource templates used by ChatGPT integrations. |
| Data import | `scripts/import-*.js`, `scripts/refresh-imports.js`, `scripts/optimize-db.js`, `data/schema.sql` | Owns GeoNames/OSM ingestion, source refresh state, import history, and database optimization. |

Keep cross-layer dependencies pointed downward: transports call tool/API handlers, handlers call `TravelDatabase`, and database methods call external clients such as Google Places. Avoid importing transport or UI concerns into database modules.

## Canonical Request Flows

### MCP Tool Call

1. Client sends a tool request over stdio (`src/index.js`) or Streamable HTTP (`src/index-http.js`).
2. Transport logs and wraps the request in telemetry.
3. `executeToolHandler()` in `src/tools-config.js` validates arguments and selects a handler.
4. The handler calls `TravelDatabase` for data access and business logic.
5. Results are normalized with resource URIs and returned as MCP `content` plus `structuredContent` when useful.

### REST API Request

1. An external client calls `/api/v1/*`.
2. `src/index-http.js` routes the request through `ApiRouter`.
3. The route module in `src/api/` validates query/body input and calls `TravelDatabase`.
4. Optional auth context is resolved from bearer tokens when a route needs user-specific data.
5. JSON is returned with route-level HTTP status handling.

### Token Introspection

1. HTTP clients send `Authorization: Bearer <token>`.
2. `src/index-http.js` first checks local database tokens through `getUserByToken()`.
3. If no local token matches, it resolves the OAuth introspection URL from config or environment.
4. Active OAuth tokens are auto-provisioned through `upsertGoogleUser()`.
5. User context is cached briefly and passed to MCP tools and API routes.

## Schema Naming

The canonical import history table is `import_log`. The canonical source registry table is `import_sources`.

Older notes may mention an `imports` table. That was the historical name before `data/migrations/001_import_sources.sql` renamed it to `import_log`. `scripts/db-init.js --reset` still drops `imports` as a legacy cleanup step, but new code and docs should refer to `import_log`.
