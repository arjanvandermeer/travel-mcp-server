/**
 * Tests for Template Helpers and POI Preview Rendering
 *
 * Tests the Handlebars helpers (formatDate, formatRating, etc.)
 * and the renderPOIPreview function, including favorite banner rendering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Handlebars from 'handlebars';
import { render } from '../../src/templates/index.js';
import { renderPOIPreview, renderNearbyWidget, isOpenNow, getNearbyTypes, getNearbyTitle, accommodationTypes, foodTypes } from '../../src/tools-config.js';

// Compile inline Handlebars templates (helpers are registered by the index.js import above)
const compileInline = (src) => Handlebars.compile(src);

// =============================================================================
// formatDate Helper
// =============================================================================

describe('formatDate Handlebars helper', () => {
  // We test via render since helpers are registered globally on Handlebars
  // Use a minimal inline approach: renderPOIPreview passes data through to the template

  it('should format a Date object as readable string', () => {
    const poi = makePOI({ is_favorite: true, favorite_since: new Date('2025-01-15T10:00:00Z') });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('January'), 'Should contain month name');
    assert.ok(html.includes('15'), 'Should contain day');
    assert.ok(html.includes('2025'), 'Should contain year');
  });

  it('should format an ISO string date', () => {
    const poi = makePOI({ is_favorite: true, favorite_since: '2024-06-20T14:30:00Z' });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('June'), 'Should contain month name');
    assert.ok(html.includes('2024'), 'Should contain year');
  });

  it('should handle null date gracefully', () => {
    const poi = makePOI({ is_favorite: true, favorite_since: null });
    const html = renderPOIPreview(poi, render);

    // Banner should still show, just without the date line
    const body = getBody(html);
    assert.ok(body.includes('On Your Favorites'), 'Should show favorite banner');
    assert.ok(!body.includes('Added '), 'Should not show Added line when date is null');
  });
});

// =============================================================================
// Favorite Banner in renderPOIPreview
// =============================================================================

describe('renderPOIPreview favorite banner', () => {
  it('should not show favorite banner for non-favorited POI', () => {
    const poi = makePOI();
    const html = renderPOIPreview(poi, render);

    assert.ok(!getBody(html).includes('On Your Favorites'), 'Should not contain favorite text');
  });

  it('should not show favorite banner when is_favorite is false', () => {
    const poi = makePOI({ is_favorite: false });
    const html = renderPOIPreview(poi, render);

    assert.ok(!getBody(html).includes('On Your Favorites'), 'Should not contain favorite text');
  });

  it('should show favorite banner when POI is favorited', () => {
    const poi = makePOI({
      is_favorite: true,
      favorite_since: new Date('2025-03-10T08:00:00Z'),
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('favorite-banner'), 'Should contain favorite banner div');
    assert.ok(html.includes('On Your Favorites'), 'Should contain favorite title');
    assert.ok(html.includes('Added'), 'Should show Added date');
    assert.ok(html.includes('March'), 'Should show formatted date');
  });

  it('should show notes when favorite has notes', () => {
    const poi = makePOI({
      is_favorite: true,
      favorite_since: new Date('2025-01-01'),
      favorite_notes: 'Amazing rooftop bar, must visit again!',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('favorite-notes'), 'Should contain notes div');
    assert.ok(html.includes('Amazing rooftop bar, must visit again!'), 'Should contain notes text');
  });

  it('should not show notes div when favorite has no notes', () => {
    const poi = makePOI({
      is_favorite: true,
      favorite_since: new Date('2025-01-01'),
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('On Your Favorites'), 'Should show banner');
    // Check only the rendered body (between </style> and <script>), not the client-side JS
    const bodyContent = html.substring(html.indexOf('</style>'), html.indexOf('<script'));
    assert.ok(!bodyContent.includes('favorite-notes'), 'Should not render notes element in body');
  });

  it('should render favorite banner before other content cards', () => {
    const poi = makePOI({
      is_favorite: true,
      favorite_since: new Date('2025-01-01'),
      google_editorial_summary: 'A wonderful hotel.',
    });
    const html = renderPOIPreview(poi, render);

    const bannerPos = html.indexOf('favorite-banner');
    const aboutPos = html.indexOf('About');
    assert.ok(bannerPos < aboutPos, 'Favorite banner should appear before About section');
  });
});

// =============================================================================
// poiName Helper
// =============================================================================

describe('poiName Handlebars helper', () => {
  it('should use google_display_name.text when it is an object', () => {
    const poi = makePOI({
      google_display_name: { text: 'Google Name', languageCode: 'en' },
      osm_name: 'OSM Name',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Google Name'), 'Should use google display name text');
  });

  it('should fall back to osm_name when google_display_name object has no text', () => {
    const poi = makePOI({
      google_display_name: { languageCode: 'en' },
      osm_name: 'Fallback OSM Name',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Fallback OSM Name'), 'Should fall back to osm_name');
  });

  it('should parse google_display_name when it is a JSON string', () => {
    const poi = makePOI({
      google_display_name: JSON.stringify({ text: 'Parsed Google Name' }),
      osm_name: 'OSM Name',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Parsed Google Name'), 'Should parse JSON string display name');
  });

  it('should use string directly when google_display_name is invalid JSON', () => {
    const poi = makePOI({
      google_display_name: 'Plain String Name',
      osm_name: 'OSM Name',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Plain String Name'), 'Should use plain string display name');
  });

  it('should fall back to osm_name when no google_display_name', () => {
    const poi = makePOI({
      google_display_name: null,
      osm_name: 'My OSM Place',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('My OSM Place'), 'Should fall back to osm_name');
  });

  it('should show Unknown when no name is available', () => {
    const poi = makePOI({
      google_display_name: null,
      osm_name: null,
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Unknown'), 'Should show Unknown');
  });

  it('should fall back to osm_name when google_display_name JSON text is empty', () => {
    const poi = makePOI({
      google_display_name: JSON.stringify({ text: '' }),
      osm_name: 'Backup Name',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Backup Name'), 'Should fall back to osm_name when parsed text is empty');
  });
});

// =============================================================================
// formatDistance Helper
// =============================================================================

describe('formatDistance Handlebars helper', () => {
  const tpl = compileInline('{{formatDistance val}}');

  it('should format distance to 1 decimal place', () => {
    assert.strictEqual(tpl({ val: 12.3456 }), '12.3');
  });

  it('should return empty string for null', () => {
    assert.strictEqual(tpl({ val: null }), '');
  });

  it('should return empty string for undefined', () => {
    assert.strictEqual(tpl({}), '');
  });

  it('should handle string numbers', () => {
    assert.strictEqual(tpl({ val: '5.678' }), '5.7');
  });

  it('should return non-numeric strings as-is', () => {
    assert.strictEqual(tpl({ val: 'abc' }), 'abc');
  });
});

// =============================================================================
// renderPOIPreview general rendering (non-favorite)
// =============================================================================

describe('renderPOIPreview general rendering', () => {
  it('should render POI name in header', () => {
    const poi = makePOI({ osm_name: 'Test Hotel Bangkok' });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Test Hotel Bangkok'), 'Should contain POI name');
  });

  it('should render POI type', () => {
    const poi = makePOI({ poi_type: 'restaurant' });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('restaurant'), 'Should contain POI type');
  });

  it('should render cuisine for food types', () => {
    const poi = makePOI({
      poi_type: 'restaurant',
      osm_cuisine: 'thai;italian',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('thai'), 'Should contain thai cuisine');
    assert.ok(html.includes('italian'), 'Should contain italian cuisine');
  });

  it('should render hotel details for accommodations', () => {
    const poi = makePOI({
      poi_type: 'hotel',
      osm_stars: '5',
      osm_rooms: '200',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Hotel Details'), 'Should have hotel details section');
    assert.ok(html.includes('200'), 'Should show room count');
    assert.ok(html.includes('★★★★★'), 'Should show star display');
  });

  it('should render Google Maps button in Location card', () => {
    const poi = makePOI({
      osm_latitude: 13.75,
      osm_longitude: 100.50,
      osm_address: '123 Test Road, Bangkok',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Google Maps'), 'Should have maps button text');
    assert.ok(html.includes('13.75,100.5'), 'Should have correct coordinates in maps URL');
    // Verify it's in the body, not just CSS
    const mapsIdx = html.indexOf('13.75,100.5');
    assert.ok(mapsIdx > html.indexOf('</style>'), 'Maps URL should be in body');
  });

  it('should render Website button next to Google Maps when website exists', () => {
    const poi = makePOI({
      osm_address: '123 Test Road, Bangkok',
      google_website: 'https://www.testhotel.com',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('href="https://www.testhotel.com"'), 'Should link to website');
    assert.ok(html.includes('Website'), 'Should have Website text');
    // Verify it's an action button (not just in CSS)
    const websiteIdx = html.indexOf('https://www.testhotel.com');
    assert.ok(websiteIdx > html.indexOf('</style>'), 'Website link should be in body, not just CSS');
  });

  it('should not render Website button when no website', () => {
    const poi = makePOI({
      osm_address: '123 Test Road, Bangkok',
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(!html.includes('>Website<'), 'Should not have Website button');
  });

  it('should render reviews when google_reviews exist', () => {
    const poi = makePOI({
      google_reviews: [
        { author: 'Jane Doe', rating: 5, text: 'Wonderful stay!', relativeTime: '2 months ago' },
        { author: 'John Smith', rating: 4, text: 'Great location.', relativeTime: '1 month ago' },
      ],
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Reviews'), 'Should have Reviews section');
    assert.ok(html.includes('Jane Doe'), 'Should show first author');
    assert.ok(html.includes('Wonderful stay!'), 'Should show first review text');
    assert.ok(html.includes('2 months ago'), 'Should show relative time');
    assert.ok(html.includes('review-carousel'), 'Should use carousel for reviews');
  });

  it('should not show opening hours for hotels', () => {
    const poi = makePOI({
      poi_type: 'hotel',
      google_opening_hours: {
        periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
        weekdayDescriptions: ['Monday: Open 24 hours'],
      },
      google_utc_offset_minutes: 420,
    });
    const html = renderPOIPreview(poi, render);

    // Check for actual rendered content, not CSS class names
    assert.ok(!html.includes('open-badge is-open'), 'Should not show open badge for hotel');
    assert.ok(!html.includes('open-badge is-closed'), 'Should not show closed badge for hotel');
    assert.ok(!html.includes('Monday: Open 24 hours'), 'Should not show hours text for hotel');
  });

  it('should show open/closed badge for restaurants with opening hours', () => {
    const poi = makePOI({
      poi_type: 'restaurant',
      google_opening_hours: {
        periods: [
          { open: { day: 0, hour: 0, minute: 0 }, close: { day: 0, hour: 23, minute: 59 } },
          { open: { day: 1, hour: 0, minute: 0 }, close: { day: 1, hour: 23, minute: 59 } },
          { open: { day: 2, hour: 0, minute: 0 }, close: { day: 2, hour: 23, minute: 59 } },
          { open: { day: 3, hour: 0, minute: 0 }, close: { day: 3, hour: 23, minute: 59 } },
          { open: { day: 4, hour: 0, minute: 0 }, close: { day: 4, hour: 23, minute: 59 } },
          { open: { day: 5, hour: 0, minute: 0 }, close: { day: 5, hour: 23, minute: 59 } },
          { open: { day: 6, hour: 0, minute: 0 }, close: { day: 6, hour: 23, minute: 59 } },
        ],
        weekdayDescriptions: ['Monday: 12:00 AM – 11:59 PM'],
      },
      google_utc_offset_minutes: 420,
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('open-badge'), 'Should have open badge');
    assert.ok(html.includes('hours-tooltip'), 'Should have hours tooltip');
  });
});

// =============================================================================
// isOpenNow function
// =============================================================================

describe('isOpenNow', () => {
  it('should return null when no opening hours provided', () => {
    assert.strictEqual(isOpenNow(null, 420), null);
  });

  it('should return null when no utc offset provided', () => {
    const hours = { periods: [{ open: { day: 0, hour: 8, minute: 0 }, close: { day: 0, hour: 22, minute: 0 } }] };
    assert.strictEqual(isOpenNow(hours, null), null);
  });

  it('should return null when periods is not an array', () => {
    assert.strictEqual(isOpenNow({ periods: 'invalid' }, 420), null);
  });

  it('should detect open during business hours', () => {
    // Create a period that covers the current time at the given offset
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const testOffset = 0; // UTC
    const localDate = new Date(utcMs + testOffset * 60000);
    const day = localDate.getDay();

    const hours = {
      periods: [
        { open: { day, hour: 0, minute: 0 }, close: { day, hour: 23, minute: 59 } },
      ],
    };
    const result = isOpenNow(hours, testOffset);
    assert.strictEqual(result.isOpen, true);
    assert.strictEqual(result.label, 'Open now');
  });

  it('should detect closed outside business hours', () => {
    // Create period for a day that is NOT today
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const testOffset = 0;
    const localDate = new Date(utcMs + testOffset * 60000);
    const today = localDate.getDay();
    const otherDay = (today + 3) % 7; // 3 days away, definitely not today

    const hours = {
      periods: [
        { open: { day: otherDay, hour: 8, minute: 0 }, close: { day: otherDay, hour: 17, minute: 0 } },
      ],
    };
    const result = isOpenNow(hours, testOffset);
    assert.strictEqual(result.isOpen, false);
    assert.strictEqual(result.label, 'Closed');
  });

  it('should handle 24-hour venues', () => {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const testOffset = 0;
    const localDate = new Date(utcMs + testOffset * 60000);
    const today = localDate.getDay();

    const hours = {
      periods: [
        { open: { day: today, hour: 0, minute: 0 } }, // No close = open all day
      ],
    };
    const result = isOpenNow(hours, testOffset);
    assert.strictEqual(result.isOpen, true);
    assert.strictEqual(result.label, 'Open 24 hours');
  });

  it('should handle overnight periods', () => {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const testOffset = 0;
    const localDate = new Date(utcMs + testOffset * 60000);
    const today = localDate.getDay();
    const tomorrow = (today + 1) % 7;

    // Open from today 00:00 to tomorrow 06:00
    const hours = {
      periods: [
        { open: { day: today, hour: 0, minute: 0 }, close: { day: tomorrow, hour: 6, minute: 0 } },
      ],
    };
    const result = isOpenNow(hours, testOffset);
    assert.strictEqual(result.isOpen, true);
  });
});

// =============================================================================
// getNearbyTypes
// =============================================================================

describe('getNearbyTypes', () => {
  it('should return food types for hotel', () => {
    const types = getNearbyTypes('hotel');
    assert.deepStrictEqual(types, foodTypes);
  });

  it('should return food types for all accommodation types', () => {
    for (const t of accommodationTypes) {
      assert.deepStrictEqual(getNearbyTypes(t), foodTypes, `${t} should map to foodTypes`);
    }
  });

  it('should return accommodation types for restaurant', () => {
    const types = getNearbyTypes('restaurant');
    assert.deepStrictEqual(types, accommodationTypes);
  });

  it('should return accommodation types for all food types', () => {
    for (const t of foodTypes) {
      assert.deepStrictEqual(getNearbyTypes(t), accommodationTypes, `${t} should map to accommodationTypes`);
    }
  });

  it('should return combined types for unknown poi_type', () => {
    const types = getNearbyTypes('museum');
    assert.ok(types.includes('restaurant'), 'Should include restaurants');
    assert.ok(types.includes('hotel'), 'Should include hotels');
    assert.strictEqual(types.length, foodTypes.length + accommodationTypes.length);
  });
});

// =============================================================================
// getNearbyTitle
// =============================================================================

describe('getNearbyTitle', () => {
  it('should return restaurants title for food types', () => {
    assert.strictEqual(getNearbyTitle(foodTypes), 'Nearby Restaurants & Cafes');
  });

  it('should return hotels title for accommodation types', () => {
    assert.strictEqual(getNearbyTitle(accommodationTypes), 'Nearby Hotels');
  });

  it('should return generic title for mixed types', () => {
    assert.strictEqual(getNearbyTitle([...foodTypes, ...accommodationTypes]), 'Nearby Places');
  });
});

// =============================================================================
// renderNearbyWidget
// =============================================================================

describe('renderNearbyWidget', () => {
  it('should render with nearby results', () => {
    const source = makePOI({ poi_type: 'hotel', osm_name: 'Grand Hotel' });
    const nearby = [
      { osm_id: 999, name: 'Thai Kitchen', poi_type: 'restaurant', google_rating: 4.5, distance_km: 0.3, preview_url: '/preview/poi/999' },
    ];
    const html = renderNearbyWidget(source, nearby, render);

    assert.ok(html.includes('Thai Kitchen'), 'Should contain nearby POI name');
    assert.ok(html.includes('0.3'), 'Should contain distance');
    assert.ok(html.includes('restaurant'), 'Should contain poi type');
  });

  it('should render empty state when no nearby results', () => {
    const source = makePOI({ poi_type: 'hotel' });
    const html = renderNearbyWidget(source, [], render);

    assert.ok(html.includes('No nearby places found'), 'Should show empty state');
  });

  it('should set correct title for hotel source', () => {
    const source = makePOI({ poi_type: 'hotel' });
    const html = renderNearbyWidget(source, [], render);

    assert.ok(html.includes('Nearby Restaurants'), 'Should show restaurants title for hotel');
  });

  it('should set correct title for restaurant source', () => {
    const source = makePOI({ poi_type: 'restaurant' });
    const html = renderNearbyWidget(source, [], render);

    assert.ok(html.includes('Nearby Hotels'), 'Should show hotels title for restaurant');
  });

  it('should show source name in subtitle', () => {
    const source = makePOI({ poi_type: 'hotel', osm_name: 'Grand Hotel' });
    const html = renderNearbyWidget(source, [], render);

    assert.ok(html.includes('Near Grand Hotel'), 'Should show source name');
  });

  it('should render scroll arrows when there are results', () => {
    const source = makePOI({ poi_type: 'hotel', osm_name: 'Grand Hotel' });
    const nearby = [
      { osm_id: 999, name: 'Thai Kitchen', poi_type: 'restaurant', google_rating: 4.5, distance_km: 0.3, preview_url: '/preview/poi/999' },
    ];
    const html = renderNearbyWidget(source, nearby, render);

    assert.ok(html.includes('scroll-wrapper'), 'Should have scroll wrapper');
    assert.ok(html.includes('scroll-arrow-left'), 'Should have left arrow');
    assert.ok(html.includes('scroll-arrow-right'), 'Should have right arrow');
  });

  it('should not render scroll arrows for empty results', () => {
    const source = makePOI({ poi_type: 'hotel' });
    const html = renderNearbyWidget(source, [], render);

    // Style and script blocks contain class names as strings; check only the HTML between them
    const htmlBody = html.split('</style>')[1]?.split('<script>')[0] || '';
    assert.ok(!htmlBody.includes('scroll-wrapper'), 'Should not have scroll wrapper div');
    assert.ok(!htmlBody.includes('scroll-arrow'), 'Should not have scroll arrow buttons');
  });
});

// =============================================================================
// search-results MCP Apps widget
// =============================================================================

describe('search-results widget', () => {
  it('renders map, filters, marker data, and Google photo gallery hooks', () => {
    const html = render('search-results', {
      title: 'Search Results',
      count: 2,
      results: [
        {
          osm_id: 1,
          name: 'Grand Hotel',
          poi_type: 'hotel',
          latitude: 13.75,
          longitude: 100.5,
          google_photos: [{ url: 'https://example.com/hotel-a.jpg' }, { url: 'https://example.com/hotel-b.jpg' }],
        },
        {
          osm_id: 2,
          name: 'Thai Kitchen',
          poi_type: 'restaurant',
          latitude: 13.751,
          longitude: 100.501,
        },
      ],
    });

    assert.ok(html.includes('role="toolbar"'), 'Should expose filter toolbar');
    assert.ok(html.includes('data-filter="stay"'), 'Should include accommodation filter');
    assert.ok(html.includes('id="result-map"'), 'Should include map panel');
    assert.ok(html.includes('data-poi-type="hotel"'), 'Should include marker/list type data');
    assert.ok(html.includes('data-lat="13.75"'), 'Should include marker/list latitude data');
    assert.ok(html.includes('photo-gallery'), 'Should render photo gallery for Google photos');
    assert.ok(html.includes('buildMap'), 'Should include interactive map builder');
    assert.ok(html.includes('applyFilter'), 'Should include filter interaction handler');
  });
});

// =============================================================================
// renderPOIPreview nearby section
// =============================================================================

describe('renderPOIPreview nearby section', () => {
  it('should not show nearby section when nearbyPois is null', () => {
    const poi = makePOI();
    const html = renderPOIPreview(poi, render);
    const body = getBody(html);

    assert.ok(!body.includes('nearby-section'), 'Should not render nearby section');
  });

  it('should show nearby section when nearbyPois provided', () => {
    const poi = makePOI();
    const nearby = [
      { osm_id: 888, name: 'Cafe Latte', poi_type: 'cafe', distance_km: 0.5, preview_url: '/preview/poi/888' },
    ];
    const html = renderPOIPreview(poi, render, nearby, 'Nearby Restaurants & Cafes');
    const body = getBody(html);

    assert.ok(body.includes('nearby-section'), 'Should render nearby section');
    assert.ok(body.includes('Cafe Latte'), 'Should contain nearby POI name');
    assert.ok(body.includes('Nearby Restaurants'), 'Should contain section title');
  });

  it('should not show nearby section when nearbyPois is empty array', () => {
    const poi = makePOI();
    const html = renderPOIPreview(poi, render, [], 'Nearby Places');
    const body = getBody(html);

    assert.ok(!body.includes('nearby-section'), 'Should not render nearby section for empty array');
  });

  it('should render card with rating and distance', () => {
    const poi = makePOI();
    const nearby = [
      { osm_id: 777, name: 'Spice Garden', poi_type: 'restaurant', google_rating: 4.2, distance_km: 0.8, preview_url: '/preview/poi/777' },
    ];
    const html = renderPOIPreview(poi, render, nearby, 'Nearby Restaurants & Cafes');
    const body = getBody(html);

    assert.ok(body.includes('Spice Garden'), 'Should show name');
    assert.ok(body.includes('4.2'), 'Should show rating');
    assert.ok(body.includes('0.8'), 'Should show distance');
  });
});

// =============================================================================
// Helper: Create a minimal valid POI object for rendering
// =============================================================================

/** Extract only the rendered body content (between </style> and <script), excluding client-side JS */
function getBody(html) {
  return html.substring(html.indexOf('</style>'), html.indexOf('<script'));
}

function makePOI(overrides = {}) {
  return {
    osm_id: 12345,
    poi_type: 'hotel',
    osm_name: 'Test Hotel',
    osm_latitude: 13.75,
    osm_longitude: 100.50,
    city: 'Bangkok',
    country_code: 'TH',
    ...overrides,
  };
}
