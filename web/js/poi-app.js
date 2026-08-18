import { apiDelete, apiGet, apiPost } from './api.js';
import { createFormatStore, safeHttpUrl } from './format-store.js';

const format = createFormatStore();
const root = document.getElementById('poi-content');
const enrichmentPollIntervalMs = 5000;
const enrichmentPollMaxMs = 5 * 60 * 1000;
const authControls = document.getElementById('auth-controls');
const authStorageKey = 'travel.web-oauth.tokens';
const authPendingKey = 'travel.web-oauth.pending';
const authClientKey = 'travel.web-oauth.client';
const auth = {
  issuer: '',
  user: null,
  accessToken: '',
  refreshToken: '',
  expiresAt: 0,
  message: '',
};

function poiIdFromPath() {
  const match = window.location.pathname.match(/^\/poi\/(\d+)\/?$/);
  return match?.[1] || null;
}

function parseStoredJson(key) {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function storeJson(key, value) {
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function randomUrlSafeString() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function pkceChallenge(verifier) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return base64Url(bytes);
}

function callbackUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.href;
}

function saveTokens(tokens) {
  auth.accessToken = tokens.access_token || '';
  auth.refreshToken = tokens.refresh_token || '';
  auth.expiresAt = Date.now() + Math.max(0, Number(tokens.expires_in || 0)) * 1000;
  storeJson(authStorageKey, {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: auth.expiresAt,
  });
}

function clearTokens() {
  auth.accessToken = '';
  auth.refreshToken = '';
  auth.expiresAt = 0;
  auth.user = null;
  window.sessionStorage.removeItem(authStorageKey);
}

async function loadAuthConfig() {
  const config = await apiGet('/api/v1/auth/config');
  auth.issuer = config.oauth_issuer;
}

async function refreshAccessToken() {
  if (!auth.issuer || !auth.refreshToken) return false;
  const response = await fetch(`${auth.issuer}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }),
  });
  if (!response.ok) {
    clearTokens();
    return false;
  }
  saveTokens(await response.json());
  return true;
}

async function loadCurrentUser() {
  if (!auth.accessToken) return null;
  let profile = await apiGet('/api/v1/auth/me', {}, { token: auth.accessToken });
  if (!profile.authenticated && await refreshAccessToken()) {
    profile = await apiGet('/api/v1/auth/me', {}, { token: auth.accessToken });
  }
  auth.user = profile.authenticated ? profile.user : null;
  if (!auth.user) clearTokens();
  return auth.user;
}

async function completeLoginFromCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;
  const pending = parseStoredJson(authPendingKey);
  window.sessionStorage.removeItem(authPendingKey);
  if (error) throw new Error(`Google sign-in was cancelled: ${error}`);
  if (!pending || state !== pending.state || !code) throw new Error('Google sign-in could not be verified. Please try again.');

  const response = await fetch(`${auth.issuer}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    }),
  });
  if (!response.ok) throw new Error('Google sign-in token exchange failed. Please try again.');
  saveTokens(await response.json());
  window.history.replaceState({}, '', `${url.pathname}${url.hash}`);
  return true;
}

async function startLogin() {
  auth.message = '';
  try {
    if (!auth.issuer) await loadAuthConfig();
    const redirectUri = callbackUrl();
    const cachedClient = parseStoredJson(authClientKey);
    let clientId = cachedClient?.issuer === auth.issuer && cachedClient.redirectUri === redirectUri
      ? cachedClient.clientId
      : '';
    if (!clientId) {
      const response = await fetch(`${auth.issuer}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Travel web',
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
        }),
      });
      if (!response.ok) throw new Error('Google sign-in is temporarily unavailable.');
      const client = await response.json();
      clientId = client.client_id;
      storeJson(authClientKey, { issuer: auth.issuer, redirectUri, clientId });
    }
    const state = randomUrlSafeString();
    const verifier = randomUrlSafeString();
    storeJson(authPendingKey, { state, verifier, clientId, redirectUri });
    const authorizationUrl = new URL('/authorize', auth.issuer);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    }).toString();
    window.location.assign(authorizationUrl.href);
  } catch (error) {
    auth.message = error.message || 'Google sign-in is unavailable.';
    renderAuthControls();
  }
}

function signOut() {
  clearTokens();
  auth.message = '';
  renderAuthControls();
  loadPoi(poiIdFromPath());
}

function renderAuthControls() {
  if (!authControls) return;
  if (auth.user) {
    const label = auth.user.name || auth.user.email || 'Signed in';
    authControls.replaceChildren(element('button', {
      className: 'account-button', type: 'button', text: `Sign out ${label}`, onClick: signOut,
    }));
    return;
  }
  const button = element('button', {
    className: 'account-button google-sign-in', type: 'button', onClick: startLogin,
  }, [element('span', { className: 'google-mark', text: 'G', 'aria-hidden': 'true' }), element('span', { text: 'Continue with Google' })]);
  authControls.replaceChildren(button);
  if (auth.message) authControls.append(element('span', { className: 'auth-message', role: 'status', text: auth.message }));
}

async function initializeAuth() {
  try {
    await loadAuthConfig();
    const stored = parseStoredJson(authStorageKey);
    if (stored) {
      auth.accessToken = stored.accessToken || '';
      auth.refreshToken = stored.refreshToken || '';
      auth.expiresAt = Number(stored.expiresAt || 0);
    }
    await completeLoginFromCallback();
    await loadCurrentUser();
  } catch (error) {
    clearTokens();
    auth.message = error.message || 'Google sign-in is unavailable.';
  }
  renderAuthControls();
}

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(options)) {
    if (value == null || value === false) continue;
    if (name === 'className') {
      node.className = value;
    } else if (name === 'text') {
      node.textContent = value;
    } else if (name === 'style') {
      node.style.cssText = value;
    } else if (name.startsWith('on')) {
      node.addEventListener(name.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) node.append(child);
  }
  return node;
}

function replaceContent(content) {
  root.replaceChildren(content);
}

function phoneUrl(poi) {
  const compact = String(format.bestPhone(poi) || '').replace(/[^\d+]/g, '');
  return /^\+?\d{3,20}$/.test(compact) ? `tel:${compact}` : '';
}

function iconButton(href, label, svg) {
  return element('a', {
    className: 'hero-icon-button',
    href,
    target: href.startsWith('tel:') ? null : '_blank',
    rel: href.startsWith('tel:') ? null : 'noopener',
    'aria-label': label,
    title: label,
  }, element('span', { text: svg, 'aria-hidden': 'true' }));
}

function contactRow(label, value, href, external = false) {
  return element('a', {
    className: 'place-contact-row',
    href,
    target: external ? '_blank' : null,
    rel: external ? 'noopener' : null,
  }, [element('span', { text: label }), element('strong', { text: value })]);
}

function carousel(items, className, buildItem, scrollAmount, label) {
  if (!items.length) return null;
  const strip = element('div', { className, tabindex: '0', 'aria-label': label });
  for (const item of items) strip.append(buildItem(item));
  const previous = element('button', {
    className: 'carousel-arrow left',
    type: 'button',
    'aria-label': `Previous ${label.toLowerCase()}`,
    text: '<',
    onClick: () => strip.scrollBy({ left: -scrollAmount, behavior: 'smooth' }),
  });
  const next = element('button', {
    className: 'carousel-arrow right',
    type: 'button',
    'aria-label': `Next ${label.toLowerCase()}`,
    text: '>',
    onClick: () => strip.scrollBy({ left: scrollAmount, behavior: 'smooth' }),
  });
  return element('div', { className: `${className === 'photo-strip' ? 'media-carousel' : 'review-carousel-shell'}` }, [previous, strip, next]);
}

function renderPhotos(poi) {
  const photos = format.detailPhotos(poi);
  const carouselNode = carousel(photos, 'photo-strip', photo => element('img', {
    className: 'photo-tile', src: photo, alt: '', loading: 'lazy',
  }), 320, 'Photos');
  if (!carouselNode) return null;
  carouselNode.append(element('div', { className: 'carousel-dots', 'aria-hidden': 'true' }, photos.map(() => element('span'))));
  return carouselNode;
}

function renderReviews(poi) {
  const reviews = format.reviewCards(poi);
  const carouselNode = carousel(reviews, 'review-strip', review => {
    const top = element('div', { className: 'review-card-top' }, [
      element('strong', { text: review.author }),
      element('span', { text: review.ratingStars }),
    ]);
    const children = [top, element('p', { text: review.text })];
    if (review.relativeTime) children.push(element('small', { text: review.relativeTime }));
    return element('article', { className: 'review-card' }, children);
  }, 280, 'Reviews');
  if (!carouselNode) return null;
  carouselNode.append(element('div', { className: 'carousel-dots', 'aria-hidden': 'true' }, reviews.map(() => element('span'))));
  return element('section', { className: 'review-section' }, [
    element('div', { className: 'section-heading' }, [
      element('span', { text: 'Reviews' }),
      element('strong', { text: `${reviews.length} shown` }),
    ]),
    carouselNode,
  ]);
}

function renderDataModal(poi) {
  const dialog = element('section', {
    className: 'data-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Raw place data',
  });
  const backdrop = element('div', {
    className: 'data-modal-backdrop',
    onClick: event => { if (event.target === backdrop) backdrop.remove(); },
  });
  const close = element('button', { className: 'close-button', type: 'button', text: 'x', onClick: () => backdrop.remove() });
  dialog.append(
    element('div', { className: 'data-modal-header' }, [element('h2', { text: 'Raw place data' }), close]),
    element('pre', { className: 'data-pane', text: JSON.stringify(poi, null, 2) }),
  );
  backdrop.append(dialog);
  return backdrop;
}

async function toggleFavorite(poi, button) {
  if (!auth.accessToken) {
    await startLogin();
    return;
  }
  button.disabled = true;
  try {
    if (poi.is_favorite) {
      await apiDelete(`/api/v1/favorites/${encodeURIComponent(poi.osm_id)}`, { token: auth.accessToken });
      poi.is_favorite = false;
      button.textContent = 'Save';
      button.setAttribute('aria-pressed', 'false');
    } else {
      await apiPost('/api/v1/favorites', { osm_id: poi.osm_id }, { token: auth.accessToken });
      poi.is_favorite = true;
      button.textContent = 'Saved';
      button.setAttribute('aria-pressed', 'true');
    }
  } catch (error) {
    if (error.status === 401) {
      clearTokens();
      renderAuthControls();
      await startLogin();
      return;
    }
    auth.message = error.message || 'We could not update this saved place.';
    renderAuthControls();
  } finally {
    button.disabled = false;
  }
}

function favoriteButton(poi) {
  const saved = Boolean(poi.is_favorite);
  return element('button', {
    className: `secondary-button compact favorite-button${saved ? ' active' : ''}`,
    type: 'button',
    text: saved ? 'Saved' : 'Save',
    'aria-pressed': String(saved),
    title: saved ? 'Remove saved place' : 'Save place',
    onClick: event => toggleFavorite(poi, event.currentTarget),
  });
}

function renderPoi(poi, polling) {
  document.title = `${poi.name || poi.osm_name || 'Place'} | Travel`;
  const address = format.bestAddress(poi);
  const maps = format.bestMapsUrl(poi);
  const website = format.bestWebsite(poi);
  const phone = format.bestPhone(poi);
  const call = phoneUrl(poi);
  const heroCopy = element('div', { className: 'dossier-hero-copy' }, [
    element('div', { className: 'eyebrow', text: poi.google_primary_type_display || poi.poi_type || 'Property' }),
    element('h1', { text: poi.name || poi.osm_name || 'Place details' }),
    element('p', { text: address || format.placeMeta(poi) }),
  ]);
  const pills = element('div', { className: 'hero-pills' });
  const hours = format.hoursDetail(poi);
  const openStatus = element('div', { className: `open-compact hero-open-status ${format.openStatusClass(poi)}` }, [element('span', { text: format.openStatus(poi) })]);
  if (hours) openStatus.append(element('small', { text: hours }));
  pills.append(openStatus);
  const price = format.priceLabel(poi);
  if (price) pills.append(element('span', { className: 'price-pill', text: price }));
  if (poi.google_rating) pills.append(element('span', { text: `${Number(poi.google_rating).toFixed(1)} stars` }));
  if (poi.google_review_count) pills.append(element('span', { text: `${poi.google_review_count} reviews` }));
  heroCopy.append(pills);

  const actions = element('div', { className: 'hero-actions' }, [favoriteButton(poi), iconButton(maps, 'Open in Maps', 'Map')]);
  if (website) actions.append(iconButton(website, 'Open website', 'Web'));
  if (call) actions.append(iconButton(call, 'Call', 'Call'));
  const hero = element('div', { className: 'dossier-hero', style: format.heroStyle(poi) }, [heroCopy, actions]);

  const copy = element('div', { className: 'copy-block' });
  if (address || phone || website) {
    const rows = element('div', { className: 'place-contact-rows' });
    if (address) rows.append(contactRow('Address', address, maps, true));
    if (phone && call) rows.append(contactRow('Phone', phone, call));
    if (website) rows.append(contactRow('Website', format.websiteLabel(poi), website, true));
    copy.append(element('div', { className: 'place-contact-box' }, [element('h2', { text: poi.name || poi.osm_name || 'Place details' }), rows]));
  }

  if (poi.ai_homepage_summary || poi.ai_review_summary) {
    const summaries = element('div', { className: 'ai-summary-grid' });
    if (poi.ai_homepage_summary) {
      const homepage = [element('span', { text: 'Homepage' }), element('p', { text: poi.ai_homepage_summary })];
      const source = safeHttpUrl(poi.ai_homepage_url);
      if (source) homepage.push(element('a', { href: source, target: '_blank', rel: 'noopener', text: 'Source website' }));
      summaries.append(element('article', { className: 'ai-summary-card' }, homepage));
    }
    if (poi.ai_review_summary) summaries.append(element('article', { className: 'ai-summary-card' }, [element('span', { text: 'Reviews' }), element('p', { text: poi.ai_review_summary })]));
    const heading = element('div', { className: 'section-heading' }, [element('span', { text: 'AI summary' })]);
    if (poi.ai_homepage_summary && poi.ai_review_summary) heading.append(element('strong', { text: 'Website + reviews' }));
    copy.append(element('div', { className: 'ai-summary-section' }, [heading, summaries]));
  }

  const reviews = renderReviews(poi);
  if (reviews) copy.append(reviews);
  if (polling && poi._enrichment?.status === 'pending') {
    copy.append(element('div', { className: 'inline-loading' }, [element('span', { className: 'tiny-spinner', 'aria-hidden': 'true' }), element('span', { text: 'Refreshing place details' })]));
  }

  const article = element('article', { className: 'dossier-shell' }, [hero]);
  const photos = renderPhotos(poi);
  if (photos) article.append(photos);
  article.append(element('div', { className: 'dossier-grid dossier-grid-single' }, element('section', { className: 'dossier-main' }, copy)));
  article.append(element('div', { className: 'dossier-data-footer' }, element('button', {
    className: 'secondary-button compact', type: 'button', text: 'Data', onClick: () => article.append(renderDataModal(poi)),
  })));
  replaceContent(article);
}

function renderError(message) {
  replaceContent(element('div', { className: 'empty-panel wide' }, [
    element('h1', { text: 'Place unavailable' }),
    element('p', { text: message }),
    element('a', { className: 'secondary-button compact', href: '/', text: 'Return to nearby restaurants' }),
  ]));
}

function renderSafely(poi, polling) {
  try {
    renderPoi(poi, polling);
    return true;
  } catch (error) {
    console.error('[Travel] POI render failed:', error);
    renderError('We could not display this place. Please try again.');
    return false;
  }
}

async function loadPoi(osmId) {
  if (!osmId) {
    renderError('This place URL is invalid.');
    return;
  }
  let poi;
  try {
    poi = await apiGet(`/api/v1/poi/${encodeURIComponent(osmId)}`, {}, { token: auth.accessToken });
  } catch (error) {
    console.error('[Travel] POI load failed:', error);
    renderError('We could not load this place. Please try again.');
    return;
  }

  const startedAt = Date.now();
  if (!renderSafely(poi, poi?._enrichment?.status === 'pending')) return;
  while (poi?._enrichment?.status === 'pending' && Date.now() - startedAt <= enrichmentPollMaxMs) {
    await new Promise(resolve => window.setTimeout(resolve, enrichmentPollIntervalMs));
    try {
      poi = await apiGet(`/api/v1/poi/${encodeURIComponent(osmId)}`, {}, { token: auth.accessToken });
      if (!renderSafely(poi, poi?._enrichment?.status === 'pending')) return;
    } catch (error) {
      console.warn('[Travel] POI enrichment poll failed:', error);
    }
  }
}

await initializeAuth();
loadPoi(poiIdFromPath());
