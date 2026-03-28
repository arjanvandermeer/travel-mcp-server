/**
 * Main app — Alpine.js stores, Leaflet map integration
 */

import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3/dist/module.esm.js';
import { apiGet, apiPost, apiDelete } from './api.js';

// POI category options with icons
const POI_CATEGORIES = [
  { value: '',            label: 'All',            icon: '\u{1F30D}', types: [] },
  { value: 'dining',      label: 'Dining',         icon: '\u{1F37D}', types: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'] },
  { value: 'accommodation', label: 'Stay',         icon: '\u{1F3E8}', types: ['hotel', 'guest_house', 'hostel', 'resort', 'motel'] },
  { value: 'attractions', label: 'Attractions',    icon: '\u{1F3DB}', types: ['attraction', 'monument', 'museum', 'park', 'viewpoint', 'ruins', 'castle', 'zoo', 'theme_park'] },
];

// Marker color by POI type
const MARKER_COLORS = {
  hotel: '#4285F4', guest_house: '#4285F4', hostel: '#4285F4', resort: '#4285F4', motel: '#4285F4',
  restaurant: '#EA4335', cafe: '#EA4335', bar: '#EA4335', pub: '#EA4335', fast_food: '#EA4335', food_court: '#EA4335',
  attraction: '#34A853', monument: '#34A853', museum: '#34A853', park: '#34A853', viewpoint: '#34A853',
  ruins: '#34A853', castle: '#34A853', zoo: '#34A853', theme_park: '#34A853',
};

// POI type icons for autocomplete
const TYPE_ICONS = {
  hotel: '\u{1F3E8}', guest_house: '\u{1F3E0}', hostel: '\u{1F6CF}', resort: '\u{1F3D6}',
  restaurant: '\u{1F37D}', cafe: '\u2615', bar: '\u{1F37A}', pub: '\u{1F37A}', fast_food: '\u{1F354}',
  attraction: '\u{1F3DB}', monument: '\u{1F3DB}', museum: '\u{1F3DB}', park: '\u{1F333}',
};

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function createMarkerIcon(poiType) {
  const color = MARKER_COLORS[poiType] || '#667eea';
  return L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

// ─── Auth Store ───
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

// ─── Route Store ───
Alpine.store('route', {
  page: 'map',   // 'map' | 'poi' | 'favorites'
  poiOsmId: null,

  init() {
    this.handleHash();
    window.addEventListener('hashchange', () => this.handleHash());
  },

  handleHash() {
    const hash = window.location.hash || '#/';
    if (hash.startsWith('#/poi/')) {
      this.page = 'poi';
      this.poiOsmId = hash.replace('#/poi/', '');
    } else if (hash === '#/favorites') {
      this.page = 'favorites';
    } else {
      this.page = 'map';
    }
  },
});

// ─── Map Store ───
Alpine.store('map', {
  leafletMap: null,
  markerCluster: null,
  markers: new Map(),  // osm_id -> L.marker
  selectedPoi: null,
  activeCategories: new Set(['dining', 'accommodation', 'attractions']),  // all on by default
  categories: POI_CATEGORIES.filter(c => c.value !== ''),  // exclude "All" — multi-toggle replaces it
  loading: false,
  _fetchDebounced: null,
  _lastBbox: null,

  initMap() {
    if (this.leafletMap) return;

    const map = L.map('map', {
      center: [20, 0],  // World view default
      zoom: 3,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    this.markerCluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      disableClusteringAtZoom: 16,
    });
    map.addLayer(this.markerCluster);

    // Fetch POIs when map moves
    this._fetchDebounced = debounce(() => this.fetchPOIs(), 400);
    map.on('moveend', () => this._fetchDebounced());
    map.on('zoomend', () => this._fetchDebounced());

    this.leafletMap = map;

    // Request geolocation
    this.locateMe();
  },

  locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (this.leafletMap) {
          // Zoom to 500m radius around current location
          const center = L.latLng(latitude, longitude);
          const bounds = center.toBounds(1000); // 1000m = 500m radius
          this.leafletMap.flyToBounds(bounds, { duration: 1.5, maxZoom: 17 });
        }
      },
      () => {
        // Denied or unavailable — stay at world view, that's fine
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  },

  toggleCategory(value) {
    if (this.activeCategories.has(value)) {
      this.activeCategories.delete(value);
    } else {
      this.activeCategories.add(value);
    }
    // Force Alpine reactivity (Set mutations aren't tracked)
    this.activeCategories = new Set(this.activeCategories);
    this._lastBbox = null; // force re-fetch
    this.fetchPOIs();
  },

  async fetchPOIs() {
    if (!this.leafletMap) return;
    const zoom = this.leafletMap.getZoom();

    // Don't fetch at very low zoom — too many results, not useful
    if (zoom < 8) {
      this.markerCluster.clearLayers();
      this.markers.clear();
      this._lastBbox = null;
      return;
    }

    const bounds = this.leafletMap.getBounds();
    const bbox = {
      sw_lat: bounds.getSouth().toFixed(4),
      sw_lng: bounds.getWest().toFixed(4),
      ne_lat: bounds.getNorth().toFixed(4),
      ne_lng: bounds.getEast().toFixed(4),
    };

    // Build types from all active category toggles
    const activeTypes = [];
    for (const cat of POI_CATEGORIES) {
      if (cat.value && this.activeCategories.has(cat.value)) {
        activeTypes.push(...cat.types);
      }
    }
    const types = activeTypes.length ? activeTypes.join(',') : undefined;

    // If no categories active, clear map
    if (!types) {
      this.markerCluster.clearLayers();
      this.markers.clear();
      this._lastBbox = null;
      return;
    }

    // Skip if bbox hasn't changed meaningfully
    const bboxKey = `${bbox.sw_lat},${bbox.sw_lng},${bbox.ne_lat},${bbox.ne_lng},${types}`;
    if (bboxKey === this._lastBbox) return;
    this._lastBbox = bboxKey;

    this.loading = true;
    try {
      const data = await apiGet('/api/v1/map/pois', {
        ...bbox,
        types,
        limit: 300,
      });

      this._updateMarkers(data.results || []);
    } catch (err) {
      console.error('Map POI fetch failed:', err);
    }
    this.loading = false;
  },

  _updateMarkers(pois) {
    const newIds = new Set(pois.map(p => p.osm_id));

    // Remove markers no longer in view
    for (const [id, marker] of this.markers) {
      if (!newIds.has(id)) {
        this.markerCluster.removeLayer(marker);
        this.markers.delete(id);
      }
    }

    // Add new markers
    for (const poi of pois) {
      if (this.markers.has(poi.osm_id)) continue;

      const marker = L.marker([poi.latitude, poi.longitude], {
        icon: createMarkerIcon(poi.poi_type),
      });

      marker.on('click', () => {
        this.selectedPoi = poi;
      });

      this.markers.set(poi.osm_id, marker);
      this.markerCluster.addLayer(marker);
    }
  },

  async toggleFavorite() {
    const auth = Alpine.store('auth');
    if (!auth.authenticated) { auth.login(); return; }
    if (!this.selectedPoi) return;

    try {
      if (this.selectedPoi.is_favorite) {
        await apiDelete(`/api/v1/favorites/${this.selectedPoi.osm_id}`);
        this.selectedPoi.is_favorite = false;
      } else {
        await apiPost('/api/v1/favorites', { osm_id: this.selectedPoi.osm_id });
        this.selectedPoi.is_favorite = true;
      }
    } catch (err) {
      console.error('Favorite toggle failed:', err);
    }
  },

  flyTo(lat, lng, zoom = 15) {
    if (this.leafletMap) {
      this.leafletMap.flyTo([lat, lng], zoom, { duration: 1 });
    }
  },
});

// ─── Search Store (simplified for map overlay) ───
Alpine.store('search', {
  poiQuery: '',
  poiSuggestions: [],
  poiOpen: false,
  poiHighlight: -1,
  loading: false,

  _searchPOIsDebounced: null,
  searchPOIs(q) {
    if (!this._searchPOIsDebounced) {
      this._searchPOIsDebounced = debounce(async (query) => {
        if (!query || query.length < 2) {
          this.poiSuggestions = [];
          this.poiOpen = false;
          return;
        }
        this.loading = true;
        try {
          const data = await apiGet('/api/v1/autocomplete', {
            q: query,
            limit: 10,
          });
          this.poiSuggestions = data.suggestions || [];
          this.poiOpen = this.poiSuggestions.length > 0;
          this.poiHighlight = -1;
        } catch (err) {
          console.error('POI autocomplete failed:', err);
        }
        this.loading = false;
      }, 300);
    }
    this._searchPOIsDebounced(q);
  },

  selectPOI(poi) {
    this.poiOpen = false;
    this.poiQuery = poi.name;
    // Fly to POI on map
    const mapStore = Alpine.store('map');
    mapStore.flyTo(poi.latitude, poi.longitude, 16);
    mapStore.selectedPoi = poi;
  },

  search() {
    // If there's a query but no suggestion selected, search and fly to first result
    if (this.poiQuery && this.poiSuggestions.length > 0) {
      this.selectPOI(this.poiSuggestions[0]);
    }
  },

  poiKeydown(event) {
    if (!this.poiOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.poiHighlight = Math.min(this.poiHighlight + 1, this.poiSuggestions.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.poiHighlight = Math.max(this.poiHighlight - 1, -1);
    } else if (event.key === 'Enter' && this.poiHighlight >= 0) {
      event.preventDefault();
      this.selectPOI(this.poiSuggestions[this.poiHighlight]);
    } else if (event.key === 'Escape') {
      this.poiOpen = false;
    }
  },

  poiTypeIcon(type) {
    return TYPE_ICONS[type] || '\u{1F4CD}';
  },
});

// ─── Favorites Store ───
Alpine.store('favorites', {
  items: [],
  loading: false,

  async load() {
    this.loading = true;
    try {
      const data = await apiGet('/api/v1/favorites');
      this.items = data.favorites || [];
    } catch (err) {
      console.error('Failed to load favorites:', err);
    }
    this.loading = false;
  },

  async remove(osmId) {
    try {
      await apiDelete(`/api/v1/favorites/${osmId}`);
      this.items = this.items.filter(f => f.poi_osm_id !== osmId && f.osm_id !== osmId);
    } catch (err) {
      console.error('Failed to remove favorite:', err);
    }
  },
});

// Bootstrap
Alpine.store('auth').check();
Alpine.store('route').init();

// Initialize map when on map page
const initMapWhenReady = () => {
  if (Alpine.store('route').page === 'map') {
    // Small delay to ensure DOM is ready
    requestAnimationFrame(() => {
      Alpine.store('map').initMap();
    });
  }
};

// Re-init map when navigating back to it
window.addEventListener('hashchange', () => {
  requestAnimationFrame(() => {
    if (Alpine.store('route').page === 'map') {
      const mapStore = Alpine.store('map');
      if (!mapStore.leafletMap) {
        mapStore.initMap();
      } else {
        // Invalidate size in case container was hidden
        mapStore.leafletMap.invalidateSize();
      }
    }
  });
});

window.Alpine = Alpine;
Alpine.start();

// Init map after Alpine has started and DOM is ready
requestAnimationFrame(initMapWhenReady);
