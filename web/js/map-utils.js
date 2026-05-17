import { TYPE_COLORS } from './constants.js';

export function markerIcon(poi, selected = false) {
  const color = TYPE_COLORS.get(poi.poi_type) || '#334155';
  const label = selected ? '●' : '';
  return L.divIcon({
    className: 'atlas-marker-wrap',
    html: `<div class="atlas-marker ${selected ? 'selected' : ''}" style="--marker:${color}">${label}</div>`,
    iconSize: [selected ? 26 : 18, selected ? 26 : 18],
    iconAnchor: [selected ? 13 : 9, selected ? 13 : 9],
  });
}
