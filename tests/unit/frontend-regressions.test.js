import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, '../../web/js/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../../web/index.html'), 'utf8');
const formatStoreJs = fs.readFileSync(path.join(__dirname, '../../web/js/format-store.js'), 'utf8');
const proximityJs = fs.readFileSync(path.join(__dirname, '../../web/js/proximity.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '../../web/css/style.css'), 'utf8');
const dossierCss = fs.readFileSync(path.join(__dirname, '../../web/css/dossier.css'), 'utf8');

describe('frontend regressions', () => {
  it('uses New York City when geolocation cannot produce a usable city', () => {
    const defaultFallbackCalls = [...appJs.matchAll(/loadDefaultCity\(\{ historyMode: 'replace' \}\)/g)];

    assert.ok(defaultFallbackCalls.length >= 5, 'Geolocation, nearest-city, and failed city-search fallbacks should load New York City');
    assert.match(
      appJs,
      /DEFAULT_CITY_FALLBACK[\s\S]*New York City, New York/,
      'Default fallback should be New York City, New York'
    );
  });

  it('keeps the redesigned web product surface wired across pages', () => {
    assert.match(indexHtml, /aria-label="Primary"/, 'Primary navigation should be exposed as navigation');
    assert.match(indexHtml, /\$store\.route\.page === 'atlas'/, 'Navigation should expose the atlas as a first-class page');
    assert.match(indexHtml, /home-category-strip/, 'City Pulse should expose the Stay, Eat, and See feed controls');
    assert.match(indexHtml, /aria-pressed="\$store\.discovery\.isFeedActive\(category\.key\)"/, 'Homepage filters should be toggle buttons');
    assert.match(indexHtml, /place-name-search/, 'Homepage should expose city-scoped place name search');
    assert.match(indexHtml, /feed-search-row[\s\S]*place-name-search[\s\S]*feed-search-submit/, 'Homepage place search should keep Name and Search on one row');
    assert.match(indexHtml, /hero-credit/, 'City Pulse should keep image attribution on the hero');
    assert.match(indexHtml, /<div class="map-stage">[\s\S]*<aside class="atlas-rail">/, 'Atlas should put the map above the result controls');
    assert.match(indexHtml, /<div class="eyebrow">DISCOVER<\/div>/, 'Atlas should use the DISCOVER label');
    assert.doesNotMatch(indexHtml, /atlas-status-grid/, 'Atlas should not surface result and layer status chrome');
    assert.doesNotMatch(indexHtml, /\$store\.atlas\.resetView\(\)/, 'Atlas should not expose a reset control');
    assert.match(appJs, /openAtUserLocation\(\)/, 'Atlas should open at the browser user location when available');
    assert.match(appJs, /maximumAge: 5 \* 60 \* 1000/, 'Atlas user-location lookup should allow a recent cached position');
    assert.match(appJs, /moveend zoomend dragend/, 'Atlas should refetch map results after map viewport changes');
    assert.match(appJs, /handleViewportChange\(\)[\s\S]*this\._lastKey = ''/, 'Atlas viewport changes should force a fresh map search');
    assert.match(appJs, /rankPlacesByDistance\(places\)/, 'Atlas should rank visible map results by distance');
    assert.match(appJs, /openDefaultCity\(\)/, 'Atlas failed or empty searches should open the default city');
    assert.match(appJs, /atlas_rank: index < 99 \? index \+ 1 : null/, 'Atlas should only number the first 99 visible map results');
    assert.match(indexHtml, /class="result-rank"[\s\S]*poi\.atlas_rank/, 'Atlas result cards should show the map marker rank');
    assert.match(appJs, /activeFeedItems\(\)/, 'Discovery store should provide category-specific feed items');
    assert.match(appJs, /toggleFeed\(key\)/, 'Discovery store should support combined category toggles');
    assert.match(appJs, /defaultHomeFeedKeys\(\)[\s\S]*return \['dining'\]/, 'Homepage should default to Eat only for new visitors');
    assert.match(appJs, /HOME_FEED_PREFERENCE_KEY/, 'Homepage category toggles should persist between sessions');
    assert.match(appJs, /DEFAULT_CITY_FALLBACK[\s\S]*New York City, New York/, 'Frontend city-search failures should default to New York City, New York');
    assert.match(appJs, /loadDefaultCity\(\{ historyMode: 'replace' \}\)/, 'City Pulse failed city lookups should load the default city');
    assert.match(appJs, /searchPlacesByName\(\)/, 'Discovery store should search selected categories by name');
    assert.match(indexHtml, /Open now/, 'Homepage search options should expose an open-now filter');
    assert.match(appJs, /open_now: this\.placeOpenNow/, 'Homepage search requests should pass the open-now filter');
    assert.match(appJs, /Promise\.all\(this\.feedCategories\.map/, 'Homepage name search should query Stay, Eat, and See result groups');
    assert.match(appJs, /loadMoreFeed\(\)/, 'Discovery store should support loading more homepage cards');
    assert.match(appJs, /feedCount\(key\)/, 'Atlas store should count visible map results by category');
    assert.doesNotMatch(appJs, /resultsLabel\(\)/, 'Atlas store should not keep unused result status text');
    assert.doesNotMatch(appJs, /resetView\(\)/, 'Atlas store should not keep an unused reset action');
    assert.match(styleCss, /\.nav-link\.active/, 'Active navigation state should be styled');
    assert.match(styleCss, /\.home-category-strip/, 'Homepage category controls should be styled');
    assert.match(styleCss, /\.hero-credit/, 'Hero image attribution should be styled');
    assert.match(indexHtml, /Raw place data/, 'PDP should hide raw data behind a data modal');
    assert.match(dossierCss, /\.photo-strip[\s\S]*overflow-x: auto/, 'PDP photos should render as a horizontal scroller');
    assert.match(indexHtml, /media-carousel[\s\S]*poiPhotoStrip[\s\S]*carousel-dots/, 'PDP photo scroller should expose arrows and dots');
    assert.match(indexHtml, /class="open-compact hero-open-status"[\s\S]*price-pill/, 'PDP should show the compact open status and price pills in the hero');
    assert.doesNotMatch(indexHtml, /property-facts/, 'PDP should not show duplicate rating, price, or access fact boxes under photos');
    assert.doesNotMatch(formatStoreJs, /propertyFacts\(poi = \{\}\)/, 'PDP fact-box formatter should be removed with the fact boxes');
    assert.doesNotMatch(indexHtml, /\$store\.poi\.summary\(\)/, 'PDP should not render the generated listed-as summary sentence');
    assert.doesNotMatch(appJs, /is listed as/, 'PDP summary copy should not keep the listed-as sentence generator');
    assert.doesNotMatch(indexHtml, /visitor-details|contact-card|contactLinks\(\$store\.poi\.current\)/, 'PDP should remove the old lower status and separate contact text boxes');
    assert.match(indexHtml, /place-contact-box[\s\S]*Address[\s\S]*Phone[\s\S]*place-website-box[\s\S]*Website/, 'PDP should show website in a distinct box below address and phone');
    assert.match(appJs, /phoneNumber\(\)/, 'PDP should preserve the formatted phone number for display');
    assert.match(indexHtml, /hero-actions[\s\S]*hero-icon-button[\s\S]*websiteUrl\(\)[\s\S]*phoneUrl\(\)/, 'PDP should expose save, maps, website, and call as hero icon actions');
    assert.match(indexHtml, /favorite-date-button[\s\S]*Bookmarked[\s\S]*favoriteSinceLabel\(\)/, 'PDP Trip Composer should show when an existing favorite was bookmarked');
    assert.match(indexHtml, /x-ref="tripComposerNote"[\s\S]*readonly[\s\S]*finishNoteEdit\(\)/, 'PDP Trip Composer notes should be click-to-edit and save on blur');
    assert.match(appJs, /syncFavoriteNote\(this\.current\)/, 'PDP should hydrate Trip Composer notes from the favorite record');
    assert.match(formatStoreJs, /favoriteDate\(value\)/, 'PDP should format the favorite bookmarked date');
    assert.match(appJs, /groupFavoritesByProximity\(this\.items\)/, 'Trip Composer should group saved places by proximity');
    assert.match(proximityJs, /distanceKm[\s\S]*FAVORITE_CLUSTER_RADIUS_KM/, 'Trip Composer proximity grouping should be distance-based');
    assert.match(indexHtml, /board-column-summary[\s\S]*itemMeta\(fav\)/, 'Trip Composer should explain each proximity group and item distance');
    assert.match(indexHtml, /<template x-if="\$store\.auth\.authenticated">\s*<div class="composer-authenticated">[\s\S]*?<div class="empty-panel wide"[\s\S]*?<div class="board"/, 'Trip Composer authenticated view should have one Alpine x-if root wrapper');
    assert.match(formatStoreJs, /reviewCards\(poi = \{\}\)/, 'PDP should expose stored Google reviews to the web UI');
    assert.match(indexHtml, /review-section[\s\S]*poiReviewStrip[\s\S]*review-card[\s\S]*ratingStars/, 'PDP should render reviews as a horizontal scroller');
    assert.match(indexHtml, /<img class="photo-tile"/, 'PDP photos should be image tiles in the horizontal strip');
    assert.doesNotMatch(indexHtml, /detail-list/, 'PDP should not use the old large detail-list fields');
    assert.doesNotMatch(indexHtml, /action-grid/, 'PDP should not separate phone/address into a detached action grid');
    assert.match(formatStoreJs, /safeHttpUrl/, 'External website, map, and image URLs should be scheme-sanitized before rendering');
    assert.match(appJs, /cssUrl\(this\.heroImageUrl\)/, 'City hero image CSS URLs should be sanitized');
    assert.match(appJs, /return \/\^\\\+\?\\d\{3,20\}\$\/\.test\(compactPhone\)/, 'Phone links should only render dialable tel URLs');
  });
});
