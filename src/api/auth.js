/**
 * Browser authentication helpers.
 *
 * Tokens remain client-held bearer credentials. These routes expose only the
 * public OAuth issuer and the already-authenticated user profile.
 */

import { createErrorEnvelope, sendJson } from '../api-router.js';
import { normalizeOAuthIssuer } from '../oauth-issuer.js';

export function registerAuthRoutes(router) {
  router.get('/api/v1/auth/config', async (req, res, { db }) => {
    const oauthIssuer = normalizeOAuthIssuer(await db.getConfigCached('oauth_issuer') || process.env.OAUTH_ISSUER);
    if (!oauthIssuer) {
      return sendJson(res, 503, createErrorEnvelope('oauth_unavailable', 'Google sign-in is not configured'));
    }
    sendJson(res, 200, { oauth_issuer: oauthIssuer });
  });

  router.get('/api/v1/auth/me', async (req, res, { user }) => {
    if (!user) return sendJson(res, 200, { authenticated: false });
    sendJson(res, 200, {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || null,
        picture_url: user.picture_url || null,
      },
    });
  });
}
