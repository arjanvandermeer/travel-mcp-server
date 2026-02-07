/**
 * Tests for Template Helpers and POI Preview Rendering
 *
 * Tests the Handlebars helpers (formatDate, formatRating, etc.)
 * and the renderPOIPreview function, including favorite banner rendering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from '../../src/templates/index.js';
import { renderPOIPreview } from '../../src/tools-config.js';

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
    assert.ok(html.includes('On Your Favorites'), 'Should show favorite banner');
    assert.ok(!html.includes('Added '), 'Should not show Added line when date is null');
  });
});

// =============================================================================
// Favorite Banner in renderPOIPreview
// =============================================================================

describe('renderPOIPreview favorite banner', () => {
  it('should not show favorite banner for non-favorited POI', () => {
    const poi = makePOI();
    const html = renderPOIPreview(poi, render);

    assert.ok(!html.includes('On Your Favorites'), 'Should not contain favorite text');
  });

  it('should not show favorite banner when is_favorite is false', () => {
    const poi = makePOI({ is_favorite: false });
    const html = renderPOIPreview(poi, render);

    assert.ok(!html.includes('On Your Favorites'), 'Should not contain favorite text');
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
    assert.ok(!html.includes('class="favorite-notes"'), 'Should not render notes element');
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

  it('should render Google Maps link', () => {
    const poi = makePOI({
      osm_latitude: 13.75,
      osm_longitude: 100.50,
    });
    const html = renderPOIPreview(poi, render);

    assert.ok(html.includes('Open in Google Maps'), 'Should have maps link');
    assert.ok(html.includes('google.com/maps'), 'Should link to Google Maps');
  });
});

// =============================================================================
// Helper: Create a minimal valid POI object for rendering
// =============================================================================

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
