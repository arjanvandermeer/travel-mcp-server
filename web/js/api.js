/**
 * API client — fetch wrapper with cookie auth and JSON parsing
 */

const BASE = '';  // Same-origin

function requestHeaders(token, headers = {}) {
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

async function parseResponse(res) {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  const error = new Error(body.message || body.error || `HTTP ${res.status}`);
  error.status = res.status;
  error.code = body.code;
  throw error;
}

export async function apiGet(path, params = {}, { token } = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, v);
  });

  const res = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: requestHeaders(token),
  });
  return parseResponse(res);
}

export async function apiPost(path, body = {}, { token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: requestHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiPatch(path, body = {}, { token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: requestHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiDelete(path, { token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: requestHeaders(token),
  });
  return parseResponse(res);
}
