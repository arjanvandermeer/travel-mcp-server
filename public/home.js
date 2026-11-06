const PAGE_SIZE = 25;
const SEARCH_RADIUS_KM = 10;
const UK_MAJOR_CITIES = Object.freeze([
  { name: 'London', latitude: 51.5072, longitude: -0.1276 },
  { name: 'Birmingham', latitude: 52.4862, longitude: -1.8904 },
  { name: 'Manchester', latitude: 53.4808, longitude: -2.2426 },
  { name: 'Liverpool', latitude: 53.4084, longitude: -2.9916 },
  { name: 'Leeds', latitude: 53.8008, longitude: -1.5491 },
  { name: 'Glasgow', latitude: 55.8642, longitude: -4.2518 },
  { name: 'Edinburgh', latitude: 55.9533, longitude: -3.1883 },
  { name: 'Bristol', latitude: 51.4545, longitude: -2.5879 },
  { name: 'Cardiff', latitude: 51.4816, longitude: -3.1791 },
  { name: 'Belfast', latitude: 54.5973, longitude: -5.9301 },
]);

const locationStatus = document.querySelector('#location-status');
const restaurantsHeading = document.querySelector('#restaurants-heading');
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
  fallbackCity: null,
};

function formatDistance(distanceKm) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance)) return '';
  if (distance < 1) return `${Math.max(1, Math.round(distance * 1000))} m`;
  return `${distance.toFixed(distance < 10 ? 1 : 0)} km`;
}

function restaurantMeta(poi) {
  return poi.osm_cuisine || '';
}

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function restaurantBadges(poi) {
  const badges = [];
  if (poi.google_price_level) {
    const prices = {
      PRICE_LEVEL_INEXPENSIVE: '$',
      PRICE_LEVEL_MODERATE: '$$',
      PRICE_LEVEL_EXPENSIVE: '$$$',
      PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
    };
    badges.push(prices[poi.google_price_level] || 'Price listed');
  }
  const isOpen = poi.google_current_opening_hours?.openNow ?? poi.google_opening_hours?.openNow;
  if (isOpen === true) badges.push('Open now');
  if (isOpen === false) badges.push('Closed now');
  return badges;
}

function appendRating(link, poi) {
  const rating = Number(poi.google_rating);
  if (!Number.isFinite(rating) || rating <= 0) return;

  const ratingElement = document.createElement('span');
  ratingElement.className = 'restaurant-rating';
  ratingElement.setAttribute('aria-label', `Rated ${rating.toFixed(1)} out of 5`);
  const star = document.createElement('span');
  star.className = 'restaurant-rating-star';
  star.setAttribute('aria-hidden', 'true');
  star.textContent = '★';
  ratingElement.append(star, ` ${rating.toFixed(1)}`);
  if (poi.google_review_count) ratingElement.append(` (${poi.google_review_count})`);
  link.append(ratingElement);
}

async function loadAreaName() {
  if (state.fallbackCity) return;
  const params = new URLSearchParams({
    latitude: String(state.latitude),
    longitude: String(state.longitude),
    limit: '1',
  });
  try {
    const response = await fetch(`/api/v1/search/cities?${params}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json();
    const city = payload.results?.[0]?.name;
    if (city) restaurantsHeading.textContent = `Restaurants near ${city}`;
  } catch {
    // The restaurant search remains useful when the optional location label fails.
  }
}

function resetRestaurantSearch() {
  restaurantList.replaceChildren();
  state.started = false;
  state.offset = 0;
  state.hasMore = true;
  state.fallbackCity = null;
}

function startRestaurantSearch(latitude, longitude, { city = null, status } = {}) {
  state.latitude = latitude;
  state.longitude = longitude;
  state.fallbackCity = city;
  state.started = true;
  locationStatus.textContent = status;
  restaurantsHeading.textContent = city ? `Restaurants in ${city.name}` : 'Restaurants near you';
  if (!city) loadAreaName();
  loadNextPage();
}

function randomMajorUkCity() {
  return UK_MAJOR_CITIES[Math.floor(Math.random() * UK_MAJOR_CITIES.length)];
}

function startFallbackCitySearch() {
  const city = randomMajorUkCity();
  startRestaurantSearch(city.latitude, city.longitude, {
    city,
    status: `Showing restaurants in ${city.name} because your location is unavailable.`,
  });
}

function appendRestaurants(restaurants) {
  const fragment = document.createDocumentFragment();
  for (const poi of restaurants) {
    const article = document.createElement('article');
    article.className = 'restaurant';
    const link = document.createElement('a');
    link.className = 'restaurant-link';
    link.href = `/poi/${encodeURIComponent(poi.osm_id)}`;

    const imageUrl = validImageUrl(poi.photo_url || poi.primary_photo_url);
    if (imageUrl) {
      const photo = document.createElement('img');
      photo.className = 'restaurant-photo';
      photo.src = imageUrl;
      photo.alt = '';
      photo.loading = 'lazy';
      link.append(photo);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'restaurant-photo-fallback';
      fallback.setAttribute('aria-hidden', 'true');
      link.append(fallback);
    }

    const name = document.createElement('h3');
    name.className = 'restaurant-name';
    name.textContent = poi.name || 'Unnamed restaurant';
    link.append(name);
    appendRating(link, poi);

    const distance = formatDistance(poi.distance_km);
    if (distance) {
      const distanceElement = document.createElement('span');
      distanceElement.className = 'restaurant-distance';
      distanceElement.textContent = distance;
      link.append(distanceElement);
    }

    const meta = restaurantMeta(poi);
    if (meta) {
      const metaElement = document.createElement('p');
      metaElement.className = 'restaurant-meta';
      metaElement.textContent = meta;
      link.append(metaElement);
    }
    const badges = restaurantBadges(poi);
    if (badges.length > 0) {
      const badgesElement = document.createElement('div');
      badgesElement.className = 'restaurant-badges';
      for (const badge of badges) {
        const badgeElement = document.createElement('span');
        badgeElement.className = `restaurant-badge${badge === 'Open now' ? ' is-open' : badge === 'Closed now' ? ' is-closed' : ''}`;
        badgeElement.textContent = badge;
        badgesElement.append(badgeElement);
      }
      link.append(badgesElement);
    }
    article.append(link);
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

function handleLocationError() {
  retryButton.hidden = false;
  startFallbackCitySearch();
}

function requestLocation() {
  if (!navigator.geolocation) {
    handleLocationError();
    return;
  }

  locationStatus.textContent = 'Finding your location...';
  restaurantsHeading.textContent = 'Restaurants near you';
  retryButton.hidden = true;
  loadStatus.textContent = '';
  resetRestaurantSearch();

  navigator.geolocation.getCurrentPosition(position => {
    startRestaurantSearch(position.coords.latitude, position.coords.longitude, {
      status: 'Location found.',
    });
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
