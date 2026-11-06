import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOAuthIssuer } from '../../src/oauth-issuer.js';

describe('normalizeOAuthIssuer', () => {
  it('keeps only a safe HTTPS origin', () => {
    assert.equal(normalizeOAuthIssuer('https://login.example.com/path?ignored=yes'), 'https://login.example.com');
    assert.equal(normalizeOAuthIssuer('https://user:password@login.example.com'), '');
  });

  it('allows HTTP only for local development', () => {
    assert.equal(normalizeOAuthIssuer('http://localhost:8787'), 'http://localhost:8787');
    assert.equal(normalizeOAuthIssuer('http://login.example.com'), '');
    assert.equal(normalizeOAuthIssuer('javascript:alert(1)'), '');
  });
});
