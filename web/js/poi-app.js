import { apiGet } from './api.js';
import { createFormatStore, safeHttpUrl } from './format-store.js';

const format = createFormatStore();
const root = document.getElementById('poi-content');
const enrichmentPollIntervalMs = 5000;
const enrichmentPollMaxMs = 5 * 60 * 1000;

function poiIdFromPath() {
  const match = window.location.pathname.match(/^\/poi\/(\d+)\/?$/);
  return match?.[1] || null;
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

  const actions = element('div', { className: 'hero-actions' }, [iconButton(maps, 'Open in Maps', 'Map')]);
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
    poi = await apiGet(`/api/v1/poi/${encodeURIComponent(osmId)}`);
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
      poi = await apiGet(`/api/v1/poi/${encodeURIComponent(osmId)}`);
      if (!renderSafely(poi, poi?._enrichment?.status === 'pending')) return;
    } catch (error) {
      console.warn('[Travel] POI enrichment poll failed:', error);
    }
  }
}

loadPoi(poiIdFromPath());
