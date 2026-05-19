const EARTH_RADIUS_KM = 6371;
export const FAVORITE_CLUSTER_RADIUS_KM = 3;
const MAP_TILE_ZOOM = 14;
const MAX_MERCATOR_LATITUDE = 85.05112878;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function favoriteCoordinates(item = {}) {
  const lat = numeric(item.osm_latitude ?? item.latitude ?? item.google_latitude);
  const lng = numeric(item.osm_longitude ?? item.longitude ?? item.google_longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function distanceKm(a, b) {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function placeName(item = {}) {
  return item.name || item.osm_name || item.google_name || 'saved place';
}

function cityLabel(item = {}) {
  if (!item.city) return '';
  return item.country_code ? `${item.city}, ${item.country_code}` : item.city;
}

function clusterLocation(items = []) {
  const seen = new Map();
  for (const item of items) {
    const label = cityLabel(item);
    if (!label) continue;
    const current = seen.get(label) || { label, count: 0 };
    current.count += 1;
    seen.set(label, current);
  }

  const locations = [...seen.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (locations.length === 0) return { label: placeName(items[0]), kind: 'place' };
  if (locations.length === 1 || locations[0].count > 1) return { label: locations[0].label, kind: 'city' };
  return { label: locations.slice(0, 2).map(location => location.label).join(' / '), kind: 'city' };
}

function firstPhotoUrl(items = []) {
  for (const item of items) {
    const photos = item.google_photos || item.photos || [];
    const url = item.photo_url
      || item.primary_photo_url
      || photos?.[0]?.url
      || photos?.[0]?.url_thumbnail;
    if (url) return url;
  }
  return '';
}

export function osmTileUrl(coords, zoom = MAP_TILE_ZOOM) {
  if (!coords) return '';
  const lat = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, coords.lat));
  const lng = Math.max(-180, Math.min(180, coords.lng));
  const scale = 2 ** zoom;
  const latRad = lat * Math.PI / 180;
  const x = Math.max(0, Math.min(scale - 1, Math.floor(((lng + 180) / 360) * scale)));
  const y = Math.max(0, Math.min(scale - 1, Math.floor((1 - Math.log(Math.tan(latRad) + (1 / Math.cos(latRad))) / Math.PI) / 2 * scale)));
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

function updateCenter(cluster) {
  const totals = cluster.items.reduce((acc, item) => ({
    lat: acc.lat + item._composerCoords.lat,
    lng: acc.lng + item._composerCoords.lng,
  }), { lat: 0, lng: 0 });
  cluster.center = {
    lat: totals.lat / cluster.items.length,
    lng: totals.lng / cluster.items.length,
  };
}

function groupSubtitle(cluster) {
  const count = cluster.items.length;
  const cities = [...new Set(cluster.items.map(cityLabel).filter(Boolean))];
  const cityText = cities.length > 0
    ? ` · ${cities.slice(0, 2).join(' / ')}${cities.length > 2 ? ' +' : ''}`
    : '';
  if (count === 1) return `1 saved place${cityText}`;
  const maxDistance = Math.max(...cluster.items.map(item => distanceKm(item._composerCoords, cluster.center)));
  return `${count} saved places · within ${Math.max(0.1, maxDistance).toFixed(1)} km${cityText}`;
}

export function groupFavoritesByProximity(items = [], options = {}) {
  const radiusKm = options.radiusKm ?? FAVORITE_CLUSTER_RADIUS_KM;
  const clusters = [];
  const unmapped = [];

  items.forEach(item => {
    const coords = favoriteCoordinates(item);
    if (!coords) {
      unmapped.push(item);
      return;
    }

    let bestCluster = null;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = distanceKm(coords, cluster.center);
      if (distance <= radiusKm && distance < bestDistance) {
        bestCluster = cluster;
        bestDistance = distance;
      }
    }

    const clusteredItem = { ...item, _composerCoords: coords };
    if (bestCluster) {
      bestCluster.items.push(clusteredItem);
      updateCenter(bestCluster);
    } else {
      clusters.push({ center: { ...coords }, items: [clusteredItem] });
    }
  });

  const columns = clusters.map((cluster, index) => {
    const location = clusterLocation(cluster.items);
    const photoUrl = firstPhotoUrl(cluster.items);
    return {
      key: `area-${index + 1}`,
      label: location.kind === 'city' ? `Around ${location.label}` : `Near ${location.label}`,
      locationLabel: location.label,
      backgroundUrl: photoUrl || osmTileUrl(cluster.center),
      backgroundCredit: photoUrl ? 'Place photo' : 'OpenStreetMap',
      backgroundKind: photoUrl ? 'photo' : 'streetmap',
      center: { ...cluster.center },
      subtitle: groupSubtitle(cluster),
      items: cluster.items
        .map(item => {
          const clusterDistanceKm = distanceKm(item._composerCoords, cluster.center);
          return {
            ...item,
            clusterDistanceKm,
            clusterDistanceLabel: `${clusterDistanceKm.toFixed(1)} km from group center`,
          };
        }),
    };
  });

  if (unmapped.length > 0) {
    const photoUrl = firstPhotoUrl(unmapped);
    columns.push({
      key: 'unmapped',
      label: 'Unmapped saves',
      subtitle: `${unmapped.length} saved place${unmapped.length === 1 ? '' : 's'} without coordinates`,
      backgroundUrl: photoUrl,
      backgroundCredit: photoUrl ? 'Place photo' : '',
      backgroundKind: photoUrl ? 'photo' : 'fallback',
      items: unmapped,
    });
  }

  return columns;
}
