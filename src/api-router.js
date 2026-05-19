/**
 * Lightweight API router for /api/v1/* and /auth/* routes.
 * No external dependencies — just method + path matching.
 */

import * as telemetry from './telemetry.js';

export class ApiRouter {
  constructor() {
    this.routes = [];
  }

  /**
   * Register a route handler
   * @param {string} method - HTTP method (GET, POST, PATCH, DELETE)
   * @param {string} pattern - URL pattern (supports :param placeholders)
   * @param {Function} handler - async (req, res, { params, query, db, user }) => void
   */
  add(method, pattern, handler) {
    // Convert pattern like /api/v1/poi/:osm_id to a regex
    const paramNames = [];
    const regexStr = pattern.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const regex = new RegExp(`^${regexStr}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, regex, paramNames, handler });
  }

  get(pattern, handler) { this.add('GET', pattern, handler); }
  post(pattern, handler) { this.add('POST', pattern, handler); }
  patch(pattern, handler) { this.add('PATCH', pattern, handler); }
  delete(pattern, handler) { this.add('DELETE', pattern, handler); }

  /**
   * Try to match and handle a request
   * @returns {boolean} true if a route matched (even if handler errored)
   */
  async handle(req, res, context) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      sendJson(res, 400, createErrorEnvelope('invalid_url', 'Invalid request URL'));
      return true;
    }
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;

      // Extract path params
      const params = {};
      try {
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
      } catch {
        sendJson(res, 400, createErrorEnvelope('invalid_path_param', 'Malformed percent-encoding in path parameter'));
        return true;
      }

      try {
        await route.handler(req, res, {
          params,
          query: Object.fromEntries(url.searchParams),
          ...context,
        });
      } catch (err) {
        console.error(`[API] Error in ${method} ${pathname}:`, err.message);
        telemetry.captureException(err, { context: 'api_route', method, route: route.pattern });
        if (!res.headersSent) {
          if (err.message === 'Request body too large') {
            sendJson(res, 413, createErrorEnvelope('body_too_large', 'Request body too large'));
          } else if (err.message === 'Invalid JSON body') {
            sendJson(res, 400, createErrorEnvelope('invalid_json', 'Invalid JSON body'));
          } else {
            sendJson(res, 500, createErrorEnvelope('internal_error', 'Internal server error'));
          }
        }
      }
      return true;
    }

    return false; // No route matched
  }
}

/**
 * Send a JSON response
 */
export function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
  });
  res.end(JSON.stringify(data));
}

export function createErrorEnvelope(code, message, extra = {}) {
  return {
    error: message,
    code,
    message,
    ...extra,
  };
}

/**
 * Parse JSON request body (max 1MB)
 */
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Parse cookies from request headers
 * @returns {Object} key-value pairs of cookies
 */
export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    if (!name) return;
    try {
      cookies[name] = decodeURIComponent(rest.join('='));
    } catch {
      telemetry.incrementCounter('cookie.parse_rejected', 1, { reason: 'malformed_percent_encoding' });
    }
  });
  return cookies;
}
