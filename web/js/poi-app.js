import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3/dist/module.esm.js';
import { apiGet } from './api.js';
import { createFormatStore } from './format-store.js';

const ENRICHMENT_POLL_INTERVAL_MS = 5000;
const ENRICHMENT_POLL_MAX_MS = 5 * 60 * 1000;

function poiIdFromPath() {
  const match = window.location.pathname.match(/^\/poi\/(\d+)\/?$/);
  return match?.[1] || null;
}

Alpine.store('format', createFormatStore());

Alpine.store('poi', {
  current: null,
  loading: true,
  error: '',
  enrichmentPolling: false,
  dataOpen: false,
  _loadId: null,
  _pollTimer: null,
  _pollStartedAt: 0,

  async load(osmId) {
    this.stopEnrichmentPoll();
    this._loadId = osmId;
    this.loading = true;
    this.error = '';
    this.current = null;

    if (!osmId) {
      this.error = 'This place URL is invalid.';
      this.loading = false;
      return;
    }

    try {
      const poi = await apiGet(`/api/v1/poi/${encodeURIComponent(osmId)}`);
      if (String(this._loadId) !== String(osmId)) return;
      this.current = poi;
      this.dataOpen = false;
      const message = poi?._enrichment?.message;
      if (message) console.info('[Travel] POI enrichment status:', message);
      this.startEnrichmentPollIfNeeded();
    } catch (error) {
      if (String(this._loadId) !== String(osmId)) return;
      this.error = 'We could not load this place. Please try again.';
      console.error('[Travel] POI load failed:', error);
    } finally {
      if (String(this._loadId) === String(osmId)) this.loading = false;
    }
  },

  isEnriching() {
    return this.current?._enrichment?.status === 'pending' && this.enrichmentPolling;
  },

  startEnrichmentPollIfNeeded() {
    if (this.current?._enrichment?.status !== 'pending' || this._pollTimer) return;
    this.enrichmentPolling = true;
    this._pollStartedAt = Date.now();
    this._pollTimer = window.setTimeout(() => this.pollEnrichment(), ENRICHMENT_POLL_INTERVAL_MS);
  },

  stopEnrichmentPoll() {
    if (this._pollTimer) window.clearTimeout(this._pollTimer);
    this._pollTimer = null;
    this._pollStartedAt = 0;
    this.enrichmentPolling = false;
  },

  async pollEnrichment() {
    this._pollTimer = null;
    const osmId = this.current?.osm_id;
    if (!osmId || String(this._loadId) !== String(osmId)) {
      this.stopEnrichmentPoll();
      return;
    }
    if (Date.now() - this._pollStartedAt > ENRICHMENT_POLL_MAX_MS) {
      this.stopEnrichmentPoll();
      return;
    }

    try {
      const poi = await apiGet(`/api/v1/poi/${encodeURIComponent(osmId)}`);
      if (String(this._loadId) !== String(osmId)) return;
      this.current = poi;
      const message = poi?._enrichment?.message;
      if (message) console.info('[Travel] POI enrichment status:', message);
      if (poi?._enrichment?.status === 'pending') {
        this.enrichmentPolling = true;
        this._pollTimer = window.setTimeout(() => this.pollEnrichment(), ENRICHMENT_POLL_INTERVAL_MS);
        return;
      }
      this.stopEnrichmentPoll();
    } catch (error) {
      console.warn('[Travel] POI enrichment poll failed:', error);
      this.enrichmentPolling = true;
      this._pollTimer = window.setTimeout(() => this.pollEnrichment(), ENRICHMENT_POLL_INTERVAL_MS);
    }
  },

  mapsUrl() {
    return Alpine.store('format').bestMapsUrl(this.current || {});
  },

  websiteUrl() {
    return Alpine.store('format').bestWebsite(this.current || {});
  },

  phoneNumber() {
    return Alpine.store('format').bestPhone(this.current || {});
  },

  phoneUrl() {
    const phone = this.phoneNumber();
    const compactPhone = phone.replace(/[^\d+]/g, '');
    return /^\+?\d{3,20}$/.test(compactPhone) ? `tel:${compactPhone}` : '';
  },

  rawJson() {
    return JSON.stringify(this.current || {}, null, 2);
  },
});

window.Alpine = Alpine;
Alpine.start();
Alpine.store('poi').load(poiIdFromPath());
