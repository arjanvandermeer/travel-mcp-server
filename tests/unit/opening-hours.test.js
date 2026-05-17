import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  coerceOpenAt,
  isGoogleOpenAt,
  isOsmOpeningHoursOpenAt,
  isPoiOpenAt,
} from '../../src/lib/opening-hours.js';

describe('opening hours filtering', () => {
  const mondayNoon = new Date(2026, 4, 18, 12, 0);
  const mondayLate = new Date(2026, 4, 18, 23, 30);
  const tuesdayEarly = new Date(2026, 4, 19, 1, 0);
  const sundayNoon = new Date(2026, 4, 17, 12, 0);

  it('coerces valid open_at values and rejects invalid dates', () => {
    assert.ok(coerceOpenAt('2026-05-18T12:00:00Z') instanceof Date);
    assert.strictEqual(coerceOpenAt('not a date'), null);
  });

  it('parses 24/7 OSM opening hours', () => {
    assert.strictEqual(isOsmOpeningHoursOpenAt('24/7', sundayNoon), true);
  });

  it('parses OSM day ranges and time windows', () => {
    assert.strictEqual(isOsmOpeningHoursOpenAt('Mo-Fr 10:00-22:00', mondayNoon), true);
    assert.strictEqual(isOsmOpeningHoursOpenAt('Mo-Fr 10:00-22:00', sundayNoon), false);
  });

  it('parses OSM overnight windows', () => {
    assert.strictEqual(isOsmOpeningHoursOpenAt('Mo-Su 18:00-02:00', mondayLate), true);
    assert.strictEqual(isOsmOpeningHoursOpenAt('Mo-Su 18:00-02:00', tuesdayEarly), true);
    assert.strictEqual(isOsmOpeningHoursOpenAt('Mo-Su 18:00-02:00', mondayNoon), false);
  });

  it('returns null for unsupported OSM expressions', () => {
    assert.strictEqual(isOsmOpeningHoursOpenAt('sunrise-sunset', mondayNoon), null);
  });

  it('checks Google periods at a venue local time', () => {
    const hours = {
      periods: [
        { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
      ],
    };

    assert.strictEqual(isGoogleOpenAt(hours, 0, new Date(Date.UTC(2026, 4, 18, 12, 0))), true);
    assert.strictEqual(isGoogleOpenAt(hours, 0, new Date(Date.UTC(2026, 4, 18, 20, 0))), false);
  });

  it('falls back to OSM hours when Google hours cannot be evaluated', () => {
    const poi = {
      google_opening_hours: { periods: [{ open: { day: 1, hour: 9, minute: 0 } }] },
      google_utc_offset_minutes: null,
      osm_opening_hours: 'Mo-Fr 10:00-22:00',
    };

    assert.strictEqual(isPoiOpenAt(poi, mondayNoon), true);
  });
});
