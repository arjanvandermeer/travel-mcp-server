/**
 * Normalize the only OAuth issuer a browser client may contact.
 * OAuth endpoints are origin-based; paths and credentials are never retained.
 */
export function normalizeOAuthIssuer(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
    const isLocalHttp = url.protocol === 'http:' && localHostnames.has(url.hostname);
    if ((url.protocol !== 'https:' && !isLocalHttp) || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}
