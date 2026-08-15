const PAGE_SIZE = 25;
const SEARCH_RADIUS_KM = 10;

const locationStatus = document.querySelector('#location-status');
const restaurantList = document.querySelector('#restaurant-list');
const loadStatus = document.querySelector('#load-status');
const retryButton = document.querySelector('#retry-location');
const sentinel = document.querySelector('#scroll-sentinel');

const state = {
  latitude: null,
  longitude: null,
  offset: 0,
  loading: false,
  hasMore: true,
  started: false,
};

function formatDistance(distanceKm) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance)) return '';
  if (distance < 1) return `${Math.max(1, Math.round(distance * 1000))} m`;
  return `${distance.toFixed(distance < 10 ? 1 : 0)} km`;
}

function restaurantMeta(poi) {
  const details = [poi.osm_cuisine, poi.city].filter(Boolean);
  return details.join(' / ');
}

function appendRestaurants(restaurants) {
  const fragment = document.createDocumentFragment();
  for (const poi of restaurants) {
    const article = document.createElement('article');
    article.className = 'restaurant';

    const name = document.createElement('h3');
    name.className = 'restaurant-name';
    name.textContent = poi.name || 'Unnamed restaurant';
    article.append(name);

    const distance = formatDistance(poi.distance_km);
    if (distance) {
      const distanceElement = document.createElement('span');
      distanceElement.className = 'restaurant-distance';
      distanceElement.textContent = distance;
      article.append(distanceElement);
    }

    const meta = restaurantMeta(poi);
    if (meta) {
      const metaElement = document.createElement('p');
      metaElement.className = 'restaurant-meta';
      metaElement.textContent = meta;
      article.append(metaElement);
    }
    fragment.append(article);
  }
  restaurantList.append(fragment);
}

function showEmptyState(message) {
  restaurantList.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = message;
  restaurantList.append(empty);
}

async function loadNextPage() {
  if (!state.started || state.loading || !state.hasMore) return;
  state.loading = true;
  loadStatus.textContent = state.offset === 0 ? 'Loading restaurants...' : 'Loading more restaurants...';

  const params = new URLSearchParams({
    latitude: String(state.latitude),
    longitude: String(state.longitude),
    poi_type: 'restaurant',
    radius_km: String(SEARCH_RADIUS_KM),
    limit: String(PAGE_SIZE),
    offset: String(state.offset),
  });

  try {
    const response = await fetch(`/api/v1/search/pois?${params}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Search failed with ${response.status}`);
    const payload = await response.json();
    const restaurants = Array.isArray(payload.results) ? payload.results : [];

    if (state.offset === 0 && restaurants.length === 0) {
      showEmptyState('No restaurants were found within 10 km of your location.');
    } else {
      appendRestaurants(restaurants);
    }

    state.offset += restaurants.length;
    state.hasMore = restaurants.length === PAGE_SIZE;
    loadStatus.textContent = state.hasMore ? '' : (restaurants.length ? 'You have reached the end of nearby restaurants.' : '');
  } catch (_error) {
    loadStatus.textContent = 'Restaurants could not be loaded. Please try again.';
  } finally {
    state.loading = false;
  }
}

function handleLocationError(error) {
  const messages = {
    1: 'Location access was denied. Allow it in your browser settings and try again.',
    2: 'Your location is currently unavailable. Try again in a moment.',
    3: 'Finding your location timed out. Try again.',
  };
  locationStatus.textContent = messages[error?.code] || 'Your location could not be determined. Try again.';
  retryButton.hidden = false;
  loadStatus.textContent = '';
}

function requestLocation() {
  if (!navigator.geolocation) {
    handleLocationError();
    return;
  }

  locationStatus.textContent = 'Finding your location...';
  retryButton.hidden = true;
  loadStatus.textContent = '';
  restaurantList.replaceChildren();
  state.started = false;
  state.offset = 0;
  state.hasMore = true;

  navigator.geolocation.getCurrentPosition(position => {
    state.latitude = position.coords.latitude;
    state.longitude = position.coords.longitude;
    state.started = true;
    locationStatus.textContent = 'Location found.';
    loadNextPage();
  }, handleLocationError, {
    enableHighAccuracy: false,
    timeout: 10000,
    maximumAge: 300000,
  });
}

const observer = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) loadNextPage();
}, { rootMargin: '240px 0px' });

observer.observe(sentinel);
retryButton.addEventListener('click', requestLocation);
requestLocation();
