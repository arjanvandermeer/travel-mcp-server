const EARTH_RADIUS_KM = 6371;
export const FAVORITE_CLUSTER_RADIUS_KM = 3;

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
  const cities = [...new Set(cluster.items.map(item => item.city).filter(Boolean))];
  const cityLabel = cities.length > 0
    ? ` · ${cities.slice(0, 2).join(' / ')}${cities.length > 2 ? ' +' : ''}`
    : '';
  if (count === 1) return `1 saved place${cityLabel}`;
  const maxDistance = Math.max(...cluster.items.map(item => distanceKm(item._composerCoords, cluster.center)));
  return `${count} saved places · within ${Math.max(0.1, maxDistance).toFixed(1)} km${cityLabel}`;
}

export function groupFavoritesByProximity(items = [], options = {}) {
  const radiusKm = options.radiusKm ?? FAVORITE_CLUSTER_RADIUS_KM;
  const clusters = [];
  const unmapped = [];

  for (const item of items) {
    const coords = favoriteCoordinates(item);
    if (!coords) {
      unmapped.push(item);
      continue;
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
  }

  const columns = clusters.map((cluster, index) => ({
    key: `area-${index + 1}`,
    label: `Near ${placeName(cluster.items[0])}`,
    subtitle: groupSubtitle(cluster),
    items: cluster.items.map(item => ({
      ...item,
      clusterDistanceLabel: `${distanceKm(item._composerCoords, cluster.center).toFixed(1)} km from group center`,
    })),
  }));

  if (unmapped.length > 0) {
    columns.push({
      key: 'unmapped',
      label: 'Unmapped saves',
      subtitle: `${unmapped.length} saved place${unmapped.length === 1 ? '' : 's'} without coordinates`,
      items: unmapped,
    });
  }

  return columns;
}
