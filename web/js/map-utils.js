import { TYPE_COLORS } from './constants.js';

export function markerIcon(poi, selected = false, rank = null) {
  const color = TYPE_COLORS.get(poi.poi_type) || '#334155';
  const label = rank && rank <= 99 ? String(rank) : selected ? '●' : '';
  return L.divIcon({
    className: 'atlas-marker-wrap',
    html: `<div class="atlas-marker ${selected ? 'selected' : ''} ${rank && rank <= 99 ? 'ranked' : ''}" style="--marker:${color}">${label}</div>`,
    iconSize: [rank && rank <= 99 ? 28 : selected ? 26 : 18, rank && rank <= 99 ? 28 : selected ? 26 : 18],
    iconAnchor: [rank && rank <= 99 ? 14 : selected ? 13 : 9, rank && rank <= 99 ? 14 : selected ? 13 : 9],
  });
}
