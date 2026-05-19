import { describe, it } from 'node:test';
import assert from 'node:assert';
import { groupFavoritesByProximity, favoriteCoordinates, distanceKm } from '../../web/js/proximity.js';

describe('favorite proximity grouping', () => {
  it('groups saved places by distance even when city names differ', () => {
    const groups = groupFavoritesByProximity([
      { osm_id: 1, name: 'Museum', city: 'Alpha', osm_latitude: 51.5007, osm_longitude: -0.1246 },
      { osm_id: 2, name: 'Lunch', city: 'Beta', osm_latitude: 51.5033, osm_longitude: -0.1195 },
      { osm_id: 3, name: 'Far hotel', city: 'Gamma', osm_latitude: 51.752, osm_longitude: -1.2577 },
    ], { radiusKm: 1 });

    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups[0].items.map(item => item.name), ['Museum', 'Lunch']);
    assert.match(groups[0].subtitle, /2 saved places/);
    assert.match(groups[0].subtitle, /Alpha \/ Beta/);
    assert.deepStrictEqual(groups[1].items.map(item => item.name), ['Far hotel']);
  });

  it('keeps favorites without coordinates in an unmapped group', () => {
    const groups = groupFavoritesByProximity([
      { osm_id: 1, name: 'Mapped', osm_latitude: 13.75, osm_longitude: 100.5 },
      { osm_id: 2, name: 'Unmapped' },
    ]);

    assert.strictEqual(groups.at(-1).key, 'unmapped');
    assert.deepStrictEqual(groups.at(-1).items.map(item => item.name), ['Unmapped']);
  });

  it('rejects invalid coordinates and computes real distances', () => {
    assert.strictEqual(favoriteCoordinates({ osm_latitude: 200, osm_longitude: 100 }), null);
    assert.ok(distanceKm({ lat: 51.5007, lng: -0.1246 }, { lat: 51.5033, lng: -0.1195 }) < 1);
  });
});
