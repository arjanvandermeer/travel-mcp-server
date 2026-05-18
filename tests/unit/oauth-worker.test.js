import { describe, it } from 'node:test';
import assert from 'node:assert';
import worker from '../../cloudflare-oauth-worker/src/index.js';

class MockKV {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  keys() {
    return [...this.store.keys()];
  }
}

function createEnv() {
  const env = {
    OAUTH_KV: new MockKV(),
    GOOGLE_CLIENT_ID: 'google-client',
    MCP_SERVER_URL: 'https://mcp.example.com',
    OAUTH_ISSUER: 'https://oauth.example.com',
  };
  env.GOOGLE_CLIENT_SECRET = 'mock-secret'; // credential-scan: allow
  return env;
}

function jsonRequest(path, body) {
  return new Request(`https://oauth.example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formRequest(path, body, headers = {}) {
  return new Request(`https://oauth.example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
  });
}

async function pkceChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(hash).toString('base64url');
}

async function registerClient(env, metadata = {}) {
  const response = await worker.fetch(jsonRequest('/register', {
    redirect_uris: ['https://client.example.com/callback'],
    token_endpoint_auth_method: 'none',
    ...metadata,
  }), env);
  assert.strictEqual(response.status, 201);
  return response.json();
}

async function seedAuthCode(env, client, overrides = {}) {
  const verifier = overrides.verifier || 'correct-horse-battery-staple';
  const code = overrides.code || crypto.randomUUID();
  const redirectUri = overrides.redirectUri || client.redirect_uris[0];
  await env.OAUTH_KV.put(`auth_code:${code}`, JSON.stringify({
    clientId: client.client_id,
    redirectUri,
    scope: 'openid profile email',
    state: 'client-state',
    codeChallenge: await pkceChallenge(verifier),
    codeChallengeMethod: 'S256',
    user: {
      sub: 'google-subject',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://example.com/pic.jpg',
    },
    createdAt: Date.now(),
    ...overrides.authData,
  }));
  return { code, verifier, redirectUri };
}

describe('Cloudflare OAuth worker', () => {
  it('rejects dynamic client registration without valid redirect URIs', async () => {
    const env = createEnv();
    const response = await worker.fetch(jsonRequest('/register', {
      client_name: 'Bad client',
      redirect_uris: ['javascript:alert(1)'],
    }), env);

    assert.strictEqual(response.status, 400);
    assert.strictEqual((await response.json()).error, 'invalid_redirect_uri');
  });

  it('stores client secrets hashed and returns public clients without a secret', async () => {
    const env = createEnv();
    const publicClient = await registerClient(env, { token_endpoint_auth_method: 'none' });

    assert.ok(publicClient.client_id);
    assert.strictEqual(publicClient.client_secret, undefined);
    const storedPublicClient = JSON.parse(await env.OAUTH_KV.get(`client:${publicClient.client_id}`));
    assert.strictEqual(storedPublicClient.client_secret_hash, null);

    const confidential = await registerClient(env, { token_endpoint_auth_method: 'client_secret_post' });
    assert.ok(confidential.client_secret);
    const storedConfidential = JSON.parse(await env.OAUTH_KV.get(`client:${confidential.client_id}`));
    assert.notStrictEqual(storedConfidential.client_secret_hash, confidential.client_secret);
  });

  it('requires registered clients, exact redirect URIs, and S256 PKCE on authorization', async () => {
    const env = createEnv();
    const client = await registerClient(env);

    const unknown = await worker.fetch(new Request('https://oauth.example.com/authorize?response_type=code&client_id=missing&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&code_challenge=abc&code_challenge_method=S256'), env);
    assert.strictEqual(unknown.status, 401);

    const badRedirect = await worker.fetch(new Request(`https://oauth.example.com/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=https%3A%2F%2Fevil.example.com%2Fcallback&code_challenge=abc&code_challenge_method=S256`), env);
    assert.strictEqual(badRedirect.status, 400);

    const missingPkce = await worker.fetch(new Request(`https://oauth.example.com/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback`), env);
    assert.strictEqual(missingPkce.status, 400);

    const valid = await worker.fetch(new Request(`https://oauth.example.com/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&code_challenge=abc&code_challenge_method=S256&scope=openid%20email`), env);
    assert.strictEqual(valid.status, 302);
    assert.match(valid.headers.get('location'), /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  });

  it('requires PKCE on token exchange and stores issued tokens by hash', async () => {
    const env = createEnv();
    const client = await registerClient(env);
    let seeded = await seedAuthCode(env, client);

    const missingVerifier = await worker.fetch(formRequest('/token', {
      grant_type: 'authorization_code',
      code: seeded.code,
      redirect_uri: seeded.redirectUri,
      client_id: client.client_id,
    }), env);
    assert.strictEqual(missingVerifier.status, 400);

    seeded = await seedAuthCode(env, client);
    const response = await worker.fetch(formRequest('/token', {
      grant_type: 'authorization_code',
      code: seeded.code,
      redirect_uri: seeded.redirectUri,
      client_id: client.client_id,
      code_verifier: seeded.verifier,
    }), env);

    assert.strictEqual(response.status, 200);
    const tokens = await response.json();
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);
    assert.strictEqual(env.OAUTH_KV.keys().includes(`token:${tokens.access_token}`), false);
    assert.strictEqual(env.OAUTH_KV.keys().includes(`refresh:${tokens.refresh_token}`), false);
    assert.ok(env.OAUTH_KV.keys().some(key => key.startsWith('token:')));
    assert.ok(env.OAUTH_KV.keys().some(key => key.startsWith('refresh:')));

    const introspection = await worker.fetch(formRequest('/introspect', { token: tokens.access_token }), env);
    const introspectionBody = await introspection.json();
    assert.strictEqual(introspectionBody.active, true);
    assert.strictEqual(introspectionBody.sub, 'google-subject');
    assert.strictEqual(introspectionBody.email, 'user@example.com');
    assert.strictEqual(introspectionBody.name, 'Test User');
    assert.strictEqual(introspectionBody.picture, 'https://example.com/pic.jpg');
    assert.strictEqual(introspectionBody.token_type, 'Bearer');
    assert.strictEqual(typeof introspectionBody.exp, 'number');
    assert.strictEqual(typeof introspectionBody.iat, 'number');

    const refresh = await worker.fetch(formRequest('/token', {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    }), env);
    assert.strictEqual(refresh.status, 200);
    const refreshedTokens = await refresh.json();
    assert.ok(refreshedTokens.access_token);
    assert.ok(refreshedTokens.refresh_token);
    assert.strictEqual(env.OAUTH_KV.keys().includes(`refresh:${refreshedTokens.refresh_token}`), false);
  });

  it('authenticates confidential clients before issuing tokens', async () => {
    const env = createEnv();
    const client = await registerClient(env, { token_endpoint_auth_method: 'client_secret_basic' });
    let seeded = await seedAuthCode(env, client);

    const unauthenticated = await worker.fetch(formRequest('/token', {
      grant_type: 'authorization_code',
      code: seeded.code,
      redirect_uri: seeded.redirectUri,
      code_verifier: seeded.verifier,
    }), env);
    assert.strictEqual(unauthenticated.status, 401);

    seeded = await seedAuthCode(env, client);
    const credentials = Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64');
    const authenticated = await worker.fetch(formRequest('/token', {
      grant_type: 'authorization_code',
      code: seeded.code,
      redirect_uri: seeded.redirectUri,
      code_verifier: seeded.verifier,
    }, { Authorization: `Basic ${credentials}` }), env);

    assert.strictEqual(authenticated.status, 200);
    assert.ok((await authenticated.json()).access_token);
  });
});
