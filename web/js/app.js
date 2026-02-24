/**
 * Main app — Alpine.js stores, initialization
 *
 * Alpine is imported as an ES module (not CDN auto-init) to avoid
 * timing issues between defer scripts and module scripts.
 */

import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3/dist/module.esm.js';
import { apiGet, apiPost, apiDelete } from './api.js';

// POI category radio options (grouped types)
const POI_CATEGORIES = [
  { value: '',            label: 'All',            types: [] },
  { value: 'dining',      label: 'Dining',         types: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'] },
  { value: 'accommodation', label: 'Accommodation', types: ['hotel', 'guest_house', 'hostel', 'resort', 'motel'] },
  { value: 'attractions', label: 'Attractions',    types: ['attraction', 'monument', 'museum', 'park', 'viewpoint', 'ruins', 'castle', 'zoo', 'theme_park'] },
];

// POI type icons for autocomplete
const TYPE_ICONS = {
  hotel: '\u{1F3E8}',
  guest_house: '\u{1F3E0}',
  hostel: '\u{1F6CF}',
  resort: '\u{1F3D6}',
  restaurant: '\u{1F37D}',
  cafe: '\u2615',
  bar: '\u{1F37A}',
  pub: '\u{1F37A}',
  fast_food: '\u{1F354}',
  attraction: '\u{1F3DB}',
  monument: '\u{1F3DB}',
  museum: '\u{1F3DB}',
  park: '\u{1F333}',
};

// Format population for display
function formatPopulation(pop) {
  if (!pop) return '';
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `${Math.round(pop / 1_000)}K`;
  return pop.toString();
}

// Debounce helper
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ─── Register Alpine stores ───

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

    login() {
      window.location.href = '/auth/login';
    },

    logout() {
      window.location.href = '/auth/logout';
    },
  });

  // ─── Search Store ───
  Alpine.store('search', {
    // Dropdown data
    countries: [],
    states: [],
    poiCategories: POI_CATEGORIES,

    // Current selections
    countryCode: '',
    stateCode: '',
    cityQuery: '',
    city: null,    // { geoname_id, name, latitude, longitude }
    poiCategory: '',  // '' | 'dining' | 'accommodation' | 'attractions'
    poiQuery: '',

    // Type-ahead
    citySuggestions: [],
    cityOpen: false,
    cityHighlight: -1,
    cityLoading: false,
    poiSuggestions: [],
    poiOpen: false,
    poiHighlight: -1,
    poiLoading: false,

    // Results
    results: [],
    resultTitle: '',
    resultCount: 0,
    loading: false,
    searched: false,

    // ─── Loaders ───
    async loadCountries() {
      try {
        this.countries = await apiGet('/api/v1/countries');
      } catch (err) {
        console.error('Failed to load countries:', err);
      }
    },

    async loadStates() {
      if (!this.countryCode) {
        this.states = [];
        return;
      }
      try {
        this.states = await apiGet('/api/v1/states', { country_code: this.countryCode });
      } catch (err) {
        console.error('Failed to load states:', err);
        this.states = [];
      }
    },

    // ─── Country change ───
    onCountryChange() {
      this.stateCode = '';
      this.city = null;
      this.cityQuery = '';
      this.citySuggestions = [];
      this.poiQuery = '';
      this.poiSuggestions = [];
      this.results = [];
      this.searched = false;
      this.loadStates();
    },

    onStateChange() {
      this.city = null;
      this.cityQuery = '';
      this.citySuggestions = [];
      this.poiQuery = '';
      this.poiSuggestions = [];
      this.results = [];
      this.searched = false;
    },

    // ─── City type-ahead ───
    _searchCitiesDebounced: null,
    searchCities(q) {
      if (!this._searchCitiesDebounced) {
        this._searchCitiesDebounced = debounce(async (query) => {
          if (!query || query.length < 2 || !this.countryCode) {
            this.citySuggestions = [];
            this.cityOpen = false;
            return;
          }
          this.cityLoading = true;
          try {
            const data = await apiGet('/api/v1/search/cities', {
              country_code: this.countryCode,
              state: this.stateCode || undefined,
              q: query,
              limit: 8,
            });
            this.citySuggestions = data.results || [];
            this.cityOpen = this.citySuggestions.length > 0;
            this.cityHighlight = -1;
          } catch (err) {
            console.error('City search failed:', err);
          }
          this.cityLoading = false;
        }, 300);
      }
      this._searchCitiesDebounced(q);
    },

    selectCity(city) {
      this.city = city;
      this.cityQuery = city.name + (city.state_name ? `, ${city.state_name}` : '');
      this.citySuggestions = [];
      this.cityOpen = false;
      this.poiQuery = '';
      this.poiSuggestions = [];
      this.results = [];
      this.searched = false;
    },

    cityKeydown(event) {
      if (!this.cityOpen) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.cityHighlight = Math.min(this.cityHighlight + 1, this.citySuggestions.length - 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.cityHighlight = Math.max(this.cityHighlight - 1, -1);
      } else if (event.key === 'Enter' && this.cityHighlight >= 0) {
        event.preventDefault();
        this.selectCity(this.citySuggestions[this.cityHighlight]);
      } else if (event.key === 'Escape') {
        this.cityOpen = false;
      }
    },

    // ─── POI type-ahead ───
    _searchPOIsDebounced: null,
    searchPOIs(q) {
      if (!this._searchPOIsDebounced) {
        this._searchPOIsDebounced = debounce(async (query) => {
          if (!query || query.length < 2) {
            this.poiSuggestions = [];
            this.poiOpen = false;
            return;
          }
          this.poiLoading = true;
          try {
            const data = await apiGet('/api/v1/autocomplete', {
              q: query,
              country_code: this.countryCode || undefined,
              city_geoname_id: this.city?.geoname_id || undefined,
              poi_types: this.selectedPoiTypes().join(',') || undefined,
              limit: 10,
            });
            this.poiSuggestions = data.suggestions || [];
            this.poiOpen = this.poiSuggestions.length > 0;
            this.poiHighlight = -1;
          } catch (err) {
            console.error('POI autocomplete failed:', err);
          }
          this.poiLoading = false;
        }, 300);
      }
      this._searchPOIsDebounced(q);
    },

    selectPOI(poi) {
      // Navigate to detail page
      window.location.hash = `/poi/${poi.osm_id}`;
      this.poiOpen = false;
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

    formatPop(pop) {
      return formatPopulation(pop);
    },

    // Get the array of POI types for the selected category
    selectedPoiTypes() {
      const cat = POI_CATEGORIES.find(c => c.value === this.poiCategory);
      return cat ? cat.types : [];
    },

    // ─── Full search ───
    async search() {
      // Need at least something to search by
      if (!this.poiQuery && !this.city && !this.countryCode) return;

      this.loading = true;
      this.searched = true;
      this.poiOpen = false;
      try {
        const types = this.selectedPoiTypes();
        const params = {
          q: this.poiQuery || undefined,
          country_code: this.countryCode || undefined,
          city_name: this.city?.name || undefined,
          state: this.stateCode || undefined,
          poi_types: types.length ? types.join(',') : undefined,
          limit: 50,
        };
        const data = await apiGet('/api/v1/search/pois', params);
        this.results = data.results || [];
        this.resultCount = data.count || 0;

        // Build title
        const cat = POI_CATEGORIES.find(c => c.value === this.poiCategory);
        const typeLabel = cat && cat.value ? cat.label : 'Places';
        const loc = this.city?.name || '';
        this.resultTitle = loc ? `${typeLabel} in ${loc}` : typeLabel;
      } catch (err) {
        console.error('Search failed:', err);
        this.results = [];
        this.resultCount = 0;
      }
      this.loading = false;
    },

    // ─── Favorites ───
    async toggleFavorite(poi) {
      const auth = Alpine.store('auth');
      if (!auth.authenticated) {
        auth.login();
        return;
      }
      try {
        if (poi.is_favorite) {
          await apiDelete(`/api/v1/favorites/${poi.osm_id}`);
          poi.is_favorite = false;
        } else {
          await apiPost('/api/v1/favorites', { osm_id: poi.osm_id });
          poi.is_favorite = true;
        }
      } catch (err) {
        console.error('Favorite toggle failed:', err);
      }
    },
  });

  // ─── Route Store (simple hash router) ───
  Alpine.store('route', {
    page: 'search',   // 'search' | 'poi' | 'favorites'
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
        this.page = 'search';
      }
    },
  });

  // ─── Favorites Store ───
  Alpine.store('favorites', {
    items: [],
    loading: false,
    loaded: false,
    filterType: '',

    async load() {
      this.loading = true;
      try {
        const params = {};
        if (this.filterType) params.poi_types = this.filterType;
        const data = await apiGet('/api/v1/favorites', params);
        this.items = data.favorites || [];
        this.loaded = true;
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

// ─── Discover Store (homepage featured section) ───
Alpine.store('discover', {
  loading: false,
  country: null,
  city: null,
  hotels: [],
  error: null,

  async load() {
    this.loading = true;
    this.error = null;
    try {
      const data = await apiGet('/api/v1/homepage');
      this.country = data.country;
      this.city = data.city;
      this.hotels = data.hotels || [];
    } catch (err) {
      console.error('Discover load failed:', err);
      this.error = 'Could not load featured places';
    }
    this.loading = false;
  },

  async toggleFavorite(poi) {
    const auth = Alpine.store('auth');
    if (!auth.authenticated) { auth.login(); return; }
    try {
      if (poi.is_favorite) {
        await apiDelete(`/api/v1/favorites/${poi.osm_id}`);
        poi.is_favorite = false;
      } else {
        await apiPost('/api/v1/favorites', { osm_id: poi.osm_id });
        poi.is_favorite = true;
      }
    } catch (err) {
      console.error('Favorite toggle failed:', err);
    }
  },
});

// Bootstrap
Alpine.store('auth').check();
Alpine.store('search').loadCountries();
Alpine.store('route').init();
Alpine.store('discover').load();

// Make Alpine available globally for devtools, then start
window.Alpine = Alpine;
Alpine.start();
