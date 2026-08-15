export const LAYERS = [
  { key: 'accommodation', label: 'Stay', color: '#2563eb', types: ['hotel', 'guest_house', 'hostel', 'resort', 'motel', 'apartment', 'bed_and_breakfast'] },
  { key: 'dining', label: 'Eat', color: '#dc2626', types: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'] },
  { key: 'attractions', label: 'See', color: '#15803d', types: ['attraction', 'monument', 'museum', 'park', 'viewpoint', 'ruins', 'castle', 'zoo', 'theme_park'] },
];

export const TYPE_COLORS = new Map(LAYERS.flatMap(layer => layer.types.map(type => [type, layer.color])));
