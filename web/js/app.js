import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3/dist/module.esm.js';
import { apiDelete, apiGet, apiPatch, apiPost } from './api.js';
import { LAYERS } from './constants.js';
import { createFormatStore } from './format-store.js';
import { markerIcon } from './map-utils.js';

const DISCOVERY_MIN_POIS = 25;
const LOCATION_SEARCH_RADII_KM = [50, 150, 500, 1000];
const ENRICHMENT_POLL_INTERVAL_MS = 5000;
const ENRICHMENT_POLL_MAX_MS = 5 * 60 * 1000;

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

Alpine.store('auth', {
  checked: false,
  authenticated: false,
  user: null,
  async check() {
    try {
      const data = await apiGet('/auth/me');
      this.authenticated = data.authenticated;
      this.user = data.authenticated ? data : null;
    } catch {
      this.authenticated = false;
      this.user = null;
    }
    this.checked = true;
  },
  login() { window.location.href = '/auth/login'; },
  logout() { window.location.href = '/auth/logout'; },
});

Alpine.store('route', {
  page: 'home',
  poiOsmId: null,
  _lastPath: '',
  _booted: false,
  boot() {
    if (this._booted) return;
    this._booted = true;
    if (!this.normalizeHashRoute()) this.handleRoute();
    window.addEventListener('popstate', () => this.handleRoute());
    window.addEventListener('hashchange', () => {
      if (this.normalizeHashRoute()) return;
      this.handleRoute();
    });
  },
  pathFor(page, osmId = null) {
    if (page === 'poi') return `/poi/${encodeURIComponent(osmId)}`;
    if (page === 'atlas') return '/map';
    if (page === 'composer') return '/composer';
    return '/';
  },
  poiPath(osmId) {
    return this.pathFor('poi', osmId);
  },
  locationPath(countryCode, cityName) {
    if (!countryCode || !cityName) return this.pathFor('home');
    return `/location/${encodeURIComponent(String(countryCode).toUpperCase())}/${encodeURIComponent(cityName)}`;
  },
  setLocation(city, mode = 'replace') {
    const path = this.locationPath(city?.country_code, city?.name);
    if (window.location.pathname === path && !window.location.hash) return;
    if (mode === 'push') history.pushState({}, '', path);
    else history.replaceState({}, '', path);
  },
  navigate(path) {
    if (window.location.pathname === path && !window.location.hash) {
      this.handleRoute();
      return;
    }
    history.pushState({}, '', path);
    this.handleRoute();
  },
  normalizeHashRoute() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#/')) return false;
    const target = hash.startsWith('#/poi/')
      ? this.pathFor('poi', hash.replace('#/poi/', ''))
      : hash === '#/composer'
        ? this.pathFor('composer')
        : hash === '#/atlas'
          ? this.pathFor('atlas')
          : this.pathFor('home');
    history.replaceState({}, '', target);
    this.handleRoute();
    return true;
  },
  handleRoute() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    if (pathname === this._lastPath) return;
    this._lastPath = pathname;
    const poiMatch = pathname.match(/^\/poi\/([^/]+)$/);
    const locationMatch = pathname.match(/^\/location\/([^/]+)\/([^/]+)$/);
    if (poiMatch) {
      this.page = 'poi';
      this.poiOsmId = decodeURIComponent(poiMatch[1]);
      Alpine.store('poi').load(this.poiOsmId);
      return;
    }
    this.poiOsmId = null;
    if (locationMatch) {
      this.page = 'home';
      Alpine.store('discovery').loadLocation(decodeURIComponent(locationMatch[1]), decodeURIComponent(locationMatch[2]));
      return;
    }
    this.page = pathname === '/composer' ? 'composer' : ['/map', '/atlas'].includes(pathname) ? 'atlas' : 'home';
    if (this.page === 'atlas') Alpine.store('atlas').activate();
  },
  goHome() { this.navigate(this.pathFor('home')); },
  goAtlas() { this.navigate(this.pathFor('atlas')); },
  goComposer() { this.navigate(this.pathFor('composer')); },
});

Alpine.store('ui', {
  railTab: 'places',
  focusCommand() {
    document.getElementById('command-search')?.focus();
  },
});

Alpine.store('format', createFormatStore());

Alpine.store('discovery', {
  loading: false,
  error: '',
  source: 'loading',
  locationState: 'idle',
  coords: null,
  country: null,
  city: null,
  hotels: [],
  overview: null,
  heroImageUrl: '',
  heroImageCredit: '',
  locationError: '',
  _loadKey: '',
  async load() {
    if (Alpine.store('route').page !== 'home' || this.city || this.loading) return;
    await this.useLocation();
  },
  async useLocation() {
    this.loading = true;
    this.error = '';
    this.locationError = '';
    this.locationState = 'requesting';
    this.source = 'local';

    if (!window.isSecureContext) {
      this.locationState = 'blocked';
      this.locationError = 'Browser location requires a secure context. Use http://localhost:3001 instead of an IP address, or serve the app over HTTPS.';
      console.warn('[City Pulse] Geolocation unavailable:', this.locationError);
      await this.loadRandomCity({ historyMode: 'replace', force: true });
      return;
    }

    if (!navigator.geolocation) {
      this.locationState = 'unsupported';
      this.locationError = 'This browser does not expose the Geolocation API.';
      console.warn('[City Pulse] Geolocation unavailable:', this.locationError);
      await this.loadRandomCity({ historyMode: 'replace', force: true });
      return;
    }

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 9000,
          maximumAge: 300000,
        });
      });
      const { latitude, longitude } = position.coords;
      this.coords = { latitude, longitude };
      this.locationState = 'resolved';
      await this.loadNearestCity(latitude, longitude);
    } catch (err) {
      this.locationState = 'unavailable';
      this.locationError = this.describeLocationError(err);
      console.warn('[City Pulse] Geolocation failed:', this.locationError, err);
      await this.loadRandomCity({ historyMode: 'replace', force: true });
      return;
    }
    this.loading = false;
  },
  describeLocationError(err) {
    if (!err || typeof err.code !== 'number') return 'Location was not available.';
    if (err.code === 1) return 'Location permission is blocked or was denied for this site.';
    if (err.code === 2) return 'The browser could not determine your current position.';
    if (err.code === 3) return 'Location lookup timed out before the browser returned coordinates.';
    return err.message || 'Location was not available.';
  },
  async loadNearestCity(latitude, longitude) {
    let nearest = null;
    for (const radiusKm of LOCATION_SEARCH_RADII_KM) {
      const data = await apiGet('/api/v1/search/cities', {
        latitude,
        longitude,
        radius_km: radiusKm,
        min_pois: DISCOVERY_MIN_POIS,
        limit: 1,
      });
      [nearest] = data.results || [];
      if (nearest) break;
    }

    if (!nearest) {
      console.info('[City Pulse] No loaded city with enough POIs near coordinates; loading random city.');
      await this.loadRandomCity({ historyMode: 'replace', force: true });
      return;
    }

    this.city = nearest;
    this.country = { code: nearest.country_code, name: nearest.country_name || nearest.country_code };
    await this.loadOverview();
    await this.loadHeroImage();
    Alpine.store('route').setLocation(this.city, 'replace');
  },
  async loadLocation(countryCode, cityName) {
    const loadKey = `location:${String(countryCode).toUpperCase()}:${cityName}`;
    if (this.loading && this._loadKey === loadKey) return;
    this._loadKey = loadKey;
    this.loading = true;
    this.error = '';
    this.locationError = '';
    this.locationState = 'resolved';
    this.source = 'location';
    try {
      const data = await apiGet('/api/v1/search/cities', {
        q: cityName,
        country_code: countryCode,
        limit: 10,
      });
      const cities = data.results || [];
      const normalizedName = String(cityName).replaceAll('-', ' ').toLowerCase();
      const city = cities.find(item => String(item.name || item.ascii_name || '').toLowerCase() === normalizedName) || cities[0];
      if (!city) throw new Error(`${cityName} is not available in the loaded travel database.`);
      this.country = { code: city.country_code, name: city.country_name || city.country_code };
      this.city = city;
      this.hotels = [];
      this.overview = null;
      await this.loadOverview();
      await this.loadHeroImage();
    } catch (err) {
      this.error = err.message || 'That city is not available right now.';
      await this.loadRandomCity({ historyMode: 'replace' });
    }
    this.loading = false;
  },
  async loadRandomCity({ historyMode = 'push', force = false } = {}) {
    const loadKey = 'random';
    if (!force && this.loading && this._loadKey === loadKey) return;
    this._loadKey = loadKey;
    this.loading = true;
    this.error = '';
    this.source = 'random';
    try {
      const data = await apiGet('/api/v1/search/cities/random', {
        min_pois: DISCOVERY_MIN_POIS,
        min_population: 50000,
      });
      const city = data.city;
      if (!city) throw new Error('No loaded cities are available in the travel database.');
      this.country = { code: city.country_code, name: city.country_name || city.country_code };
      this.city = city;
      this.hotels = [];
      this.overview = null;
      await this.loadOverview();
      await this.loadHeroImage();
      Alpine.store('route').setLocation(this.city, historyMode);
    } catch (err) {
      this.error = err.message || 'City discovery is unavailable right now.';
    }
    this.loading = false;
  },
  async loadOverview() {
    const countryCode = this.country?.code || this.city?.country_code;
    if (!countryCode || !this.city?.name) return;
    try {
      this.overview = await apiGet(`/api/v1/cities/${encodeURIComponent(countryCode)}/${encodeURIComponent(this.city.name)}/overview`);
      this.hotels = this.overview?.top?.stays || this.hotels || [];
    } catch {
      this.overview = null;
    }
  },
  async loadHeroImage() {
    this.heroImageUrl = '';
    this.heroImageCredit = '';
    if (!this.city?.name) return;

    const search = `${this.city.name} ${this.country?.name || this.city.country_code || ''}`.trim();
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('origin', '*');
    url.searchParams.set('format', 'json');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '0');
    url.searchParams.set('gsrlimit', '1');
    url.searchParams.set('gsrsearch', search);
    url.searchParams.set('prop', 'pageimages');
    url.searchParams.set('piprop', 'thumbnail|original|name');
    url.searchParams.set('pithumbsize', '1800');

    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      const page = Object.values(data.query?.pages || {})[0];
      this.heroImageUrl = page?.original?.source || page?.thumbnail?.source || '';
      this.heroImageCredit = page?.title ? `Image from Wikipedia: ${page.title}` : '';
    } catch {
      this.heroImageUrl = '';
    }
  },
  heroStyle() {
    if (!this.heroImageUrl) return '';
    return `--city-hero: url("${this.heroImageUrl}")`;
  },
  eyebrow() {
    if (this.locationState === 'requesting') return 'Finding your city';
    if (this.source === 'location') return 'Location discovery';
    return this.source === 'local' ? 'Local discovery' : 'Random discovery';
  },
  cityTitle() {
    if (this.locationState === 'requesting') return 'Locating you';
    return this.city?.name ? `${this.city.name} today` : 'Choose a city';
  },
  subtitle() {
    if (this.locationState === 'requesting') return 'Allow location access and I will resolve the nearest city from the travel database.';
    if (!this.city?.name) return 'Start with live places from the travel database, then move into the atlas.';
    const localPrefix = this.source === 'local'
      ? 'Your nearest city view'
      : this.source === 'location'
        ? 'A loaded city view'
        : 'A random loaded city view';
    return `${localPrefix} for ${this.city.name}${this.country?.name ? `, ${this.country.name}` : ''}: stays, food leads, anchors, and nearby pivots.`;
  },
  countryLabel() {
    return this.country?.name || 'Global';
  },
  featuredPlaces() {
    return [
      ...(this.hotels || []),
      ...(this.overview?.top?.food || []),
      ...(this.overview?.top?.attractions || []),
    ].slice(0, 6);
  },
  openAtlas(layer = null) {
    Alpine.store('atlas').seedFromDiscovery(layer);
    Alpine.store('route').goAtlas();
  },
});

Alpine.store('search', {
  query: '',
  suggestions: [],
  open: false,
  highlight: -1,
  _debounced: null,
  autocomplete() {
    if (!this._debounced) {
      this._debounced = debounce(async () => {
        if (!this.query || this.query.length < 2) {
          this.suggestions = [];
          this.open = false;
          return;
        }
        try {
          const data = await apiGet('/api/v1/autocomplete', { q: this.query, limit: 12 });
          this.suggestions = data.suggestions || [];
          this.open = this.suggestions.length > 0;
          this.highlight = -1;
        } catch {
          this.suggestions = [];
          this.open = false;
        }
      }, 220);
    }
    this._debounced();
  },
  onKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlight = Math.min(this.highlight + 1, this.suggestions.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlight = Math.max(this.highlight - 1, -1);
    } else if (event.key === 'Escape') {
      this.open = false;
    }
  },
  select(poi) {
    this.query = poi.name;
    this.open = false;
    Alpine.store('atlas').focusPoi(poi);
    Alpine.store('route').goAtlas();
  },
  commit() {
    if (this.highlight >= 0 && this.suggestions[this.highlight]) return this.select(this.suggestions[this.highlight]);
    if (this.suggestions[0]) return this.select(this.suggestions[0]);
    Alpine.store('atlas').textSearch(this.query);
    Alpine.store('route').goAtlas();
  },
});

Alpine.store('atlas', {
  layers: LAYERS,
  activeLayers: new Set(['accommodation', 'dining', 'attractions']),
  map: null,
  cluster: null,
  markers: new Map(),
  places: [],
  selected: null,
  loading: false,
  city: null,
  _lastKey: '',
  _fetchDebounced: null,
  title() {
    return this.city?.name ? `${this.city.name} map` : 'Travel map';
  },
  contextLine() {
    return this.city?.country_code ? `${this.city.country_code} · live map places` : 'Search or move the map to discover places.';
  },
  activate() {
    requestAnimationFrame(() => this.initMap());
  },
  initMap() {
    if (!document.getElementById('map')) return;
    if (this.map) {
      this.map.invalidateSize();
      return;
    }
    this.map = L.map('map', { center: [20, 0], zoom: 3, zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);
    this.cluster = L.markerClusterGroup({ maxClusterRadius: 44, showCoverageOnHover: false, disableClusteringAtZoom: 16 });
    this.map.addLayer(this.cluster);
    this._fetchDebounced = debounce(() => this.fetchMapPlaces(), 350);
    this.map.on('moveend zoomend', () => this._fetchDebounced());
    this.seedFromDiscovery();
  },
  seedFromDiscovery(layer = null) {
    const discovery = Alpine.store('discovery');
    this.city = discovery.overview?.city || (discovery.city ? { ...discovery.city, country_code: discovery.country?.code } : null);
    if (layer) this.activeLayers = new Set([layer]);
    this.activeLayers = new Set(this.activeLayers);
    if (this.map && discovery.overview?.suggested_focus) {
      const f = discovery.overview.suggested_focus;
      this.map.flyTo([f.latitude, f.longitude], f.zoom || 12, { duration: 0.8 });
    } else if (this.map && discovery.hotels?.[0]) {
      this.focusPoi(discovery.hotels[0], false);
    }
  },
  toggleLayer(key) {
    if (this.activeLayers.has(key)) this.activeLayers.delete(key);
    else this.activeLayers.add(key);
    this.activeLayers = new Set(this.activeLayers);
    this._lastKey = '';
    this.fetchMapPlaces();
  },
  activeTypes() {
    return LAYERS.filter(layer => this.activeLayers.has(layer.key)).flatMap(layer => layer.types);
  },
  async fetchMapPlaces() {
    if (!this.map || this.map.getZoom() < 8 || this.activeTypes().length === 0) {
      this.places = [];
      this.cluster?.clearLayers();
      this.markers.clear();
      return;
    }
    const b = this.map.getBounds();
    const params = {
      sw_lat: b.getSouth().toFixed(4),
      sw_lng: b.getWest().toFixed(4),
      ne_lat: b.getNorth().toFixed(4),
      ne_lng: b.getEast().toFixed(4),
      types: this.activeTypes().join(','),
      limit: 300,
    };
    const key = JSON.stringify(params);
    if (key === this._lastKey) return;
    this._lastKey = key;
    this.loading = true;
    try {
      const data = await apiGet('/api/v1/map/pois', params);
      this.places = data.results || [];
      this.drawMarkers();
    } catch {
      this.places = [];
      this.drawMarkers();
    }
    this.loading = false;
  },
  drawMarkers() {
    this.cluster.clearLayers();
    this.markers.clear();
    for (const poi of this.places) {
      const marker = L.marker([poi.latitude, poi.longitude], { icon: markerIcon(poi, this.selected?.osm_id === poi.osm_id) });
      marker.on('click', () => this.select(poi));
      this.markers.set(poi.osm_id, marker);
      this.cluster.addLayer(marker);
    }
  },
  select(poi) {
    this.selected = poi;
    this.drawMarkers();
  },
  preview(poi) {
    if (!this.selected) this.selected = poi;
  },
  focusPoi(poi, select = true) {
    this.activate();
    requestAnimationFrame(() => {
      if (!this.map || !poi.latitude || !poi.longitude) return;
      this.map.flyTo([poi.latitude, poi.longitude], 15, { duration: 0.8 });
      if (select) this.selected = poi;
      this.fetchMapPlaces();
    });
  },
  async textSearch(query) {
    if (!query) return;
    try {
      const data = await apiGet('/api/v1/search/pois', { q: query, limit: 20 });
      this.places = data.results || [];
      if (this.places[0]) this.focusPoi(this.places[0]);
    } catch {
      this.places = [];
    }
  },
  locate() {
    navigator.geolocation?.getCurrentPosition(pos => {
      this.map?.flyTo([pos.coords.latitude, pos.coords.longitude], 14);
    });
  },
});

Alpine.store('radar', {
  source: null,
  results: [],
  loading: false,
  title() {
    return this.source ? `Near ${this.source.name || this.source.osm_name}` : 'Pick a place to start';
  },
  async fromPoi(poi) {
    if (!poi) return;
    this.source = poi;
    Alpine.store('ui').railTab = 'radar';
    this.loading = true;
    try {
      const data = await apiGet(`/api/v1/poi/${poi.osm_id}/nearby`, { radius: 2, limit: 12 });
      this.results = data.results || [];
    } catch {
      this.results = [];
    }
    this.loading = false;
  },
});

Alpine.store('poi', {
  current: null,
  loading: false,
  enrichmentPolling: false,
  tab: 'overview',
  note: '',
  _loadId: null,
  _pollTimer: null,
  _pollStartedAt: 0,
  async open(osmId) {
    Alpine.store('route').navigate(Alpine.store('route').poiPath(osmId));
  },
  async load(osmId) {
    if (this.loading && String(this._loadId) === String(osmId)) return;
    this.stopEnrichmentPoll();
    this._loadId = osmId;
    this.loading = true;
    this.tab = 'overview';
    try {
      this.current = await apiGet(`/api/v1/poi/${osmId}`);
      this.note = this.current.favorite_notes || '';
      const enrichmentMessage = this.current?._enrichment?.message;
      if (enrichmentMessage) console.info('[Travel] POI enrichment status:', enrichmentMessage);
      await Alpine.store('radar').fromPoi(this.current);
      this.startEnrichmentPollIfNeeded();
    } catch {
      this.current = null;
    }
    this.loading = false;
  },
  enrichmentLabel() {
    return this.current?._enrichment?.status || 'base';
  },
  enrichmentMessage() {
    return this.current?._enrichment?.message || '';
  },
  isEnriching() {
    return this.current?._enrichment?.status === 'pending' && this.enrichmentPolling;
  },
  startEnrichmentPollIfNeeded() {
    if (this.current?._enrichment?.status !== 'pending') {
      this.stopEnrichmentPoll();
      return;
    }
    if (this._pollTimer) return;
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
      console.warn('[Travel] POI enrichment polling timed out after 5 minutes:', osmId);
      this.stopEnrichmentPoll();
      return;
    }

    try {
      const updated = await apiGet(`/api/v1/poi/${osmId}`);
      if (String(this._loadId) !== String(osmId)) return;
      this.current = updated;
      this.note = updated.favorite_notes || this.note || '';
      const enrichmentMessage = updated?._enrichment?.message;
      if (enrichmentMessage) console.info('[Travel] POI enrichment status:', enrichmentMessage);
      if (updated?._enrichment?.status === 'pending') {
        this.enrichmentPolling = true;
        this._pollTimer = window.setTimeout(() => this.pollEnrichment(), ENRICHMENT_POLL_INTERVAL_MS);
        return;
      }
      this.stopEnrichmentPoll();
      await Alpine.store('radar').fromPoi(updated);
    } catch (err) {
      console.warn('[Travel] POI enrichment poll failed:', err);
      this.enrichmentPolling = true;
      this._pollTimer = window.setTimeout(() => this.pollEnrichment(), ENRICHMENT_POLL_INTERVAL_MS);
    }
  },
  summary() {
    if (!this.current) return '';
    const name = this.current.name || this.current.osm_name || 'This place';
    const city = this.current.city ? ` in ${this.current.city}` : '';
    const rating = this.current.google_rating ? ` It carries a ${this.current.google_rating} Google rating.` : '';
    const type = String(this.current.google_primary_type_display || this.current.poi_type || 'a point of interest').replaceAll('_', ' ');
    const address = Alpine.store('format').bestAddress(this.current);
    const location = address ? ` The listed address is ${address}.` : '';
    return `${name}${city} is listed as ${type}.${rating}${location}`;
  },
  mapsUrl() {
    return Alpine.store('format').bestMapsUrl(this.current || {});
  },
});

Alpine.store('favorites', {
  items: [],
  loading: false,
  async load() {
    if (!Alpine.store('auth').authenticated) return;
    this.loading = true;
    try {
      const data = await apiGet('/api/v1/favorites');
      this.items = data.favorites || [];
    } catch {
      this.items = [];
    }
    this.loading = false;
  },
  async toggle(poi) {
    if (!Alpine.store('auth').authenticated) return Alpine.store('auth').login();
    if (poi.is_favorite) {
      await apiDelete(`/api/v1/favorites/${poi.osm_id}`);
      poi.is_favorite = false;
    } else {
      await apiPost('/api/v1/favorites', { osm_id: poi.osm_id, notes: poi.favorite_notes || null });
      poi.is_favorite = true;
    }
    this.load();
  },
  async saveNote(poi, notes) {
    if (!poi || !Alpine.store('auth').authenticated) return;
    const osmId = poi.osm_id || poi.poi_osm_id;
    if (!poi.is_favorite) await apiPost('/api/v1/favorites', { osm_id: osmId, notes });
    else await apiPatch(`/api/v1/favorites/${osmId}`, { notes });
    poi.is_favorite = true;
  },
  columns() {
    const groups = [
      { key: 'stay', label: 'Stay', match: p => ['hotel', 'guest_house', 'hostel', 'resort', 'motel', 'apartment', 'bed_and_breakfast'].includes(p.poi_type) },
      { key: 'eat', label: 'Eat', match: p => ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'].includes(p.poi_type) },
      { key: 'see', label: 'See', match: p => ['attraction', 'monument', 'museum', 'park', 'viewpoint', 'ruins', 'castle', 'zoo', 'theme_park'].includes(p.poi_type) },
      { key: 'shortlist', label: 'Shortlist', match: () => true },
    ];
    const used = new Set();
    return groups.map(group => {
      const items = this.items.filter(item => !used.has(item.osm_id || item.poi_osm_id) && group.match(item));
      items.forEach(item => used.add(item.osm_id || item.poi_osm_id));
      return { ...group, items };
    });
  },
});

Alpine.store('compare', {
  items: [],
  has(poi) {
    return this.items.some(item => item.osm_id === poi.osm_id);
  },
  toggle(poi) {
    if (!poi) return;
    if (this.has(poi)) this.items = this.items.filter(item => item.osm_id !== poi.osm_id);
    else this.items = [...this.items, poi].slice(-4);
  },
});

window.Alpine = Alpine;

Alpine.store('route').boot();
Alpine.start();

queueMicrotask(() => {
  Alpine.store('auth').check();
  Alpine.store('discovery').load();
});
