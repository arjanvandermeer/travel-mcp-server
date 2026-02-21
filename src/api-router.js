/**
 * Lightweight API router for /api/v1/* and /auth/* routes.
 * No external dependencies — just method + path matching.
 */

import { parse } from 'url';
import * as telemetry from './telemetry.js';

export class ApiRouter {
  constructor() {
    this.routes = [];
  }

  /**
   * Register a route handler
   * @param {string} method - HTTP method (GET, POST, DELETE)
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
    this.routes.push({ method: method.toUpperCase(), regex, paramNames, handler });
  }

  get(pattern, handler) { this.add('GET', pattern, handler); }
  post(pattern, handler) { this.add('POST', pattern, handler); }
  delete(pattern, handler) { this.add('DELETE', pattern, handler); }

  /**
   * Try to match and handle a request
   * @returns {boolean} true if a route matched (even if handler errored)
   */
  async handle(req, res, context) {
    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;

      // Extract path params
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      try {
        await route.handler(req, res, {
          params,
          query: parsedUrl.query,
          ...context,
        });
      } catch (err) {
        console.error(`[API] Error in ${method} ${pathname}:`, err.message);
        telemetry.captureException(err, { context: 'api_route', method, pathname });
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Internal server error' });
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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Parse JSON request body
 */
export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
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
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}
