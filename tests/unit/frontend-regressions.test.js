import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, '../../web/js/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../../web/index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '../../web/css/style.css'), 'utf8');
const dossierCss = fs.readFileSync(path.join(__dirname, '../../web/css/dossier.css'), 'utf8');

describe('frontend regressions', () => {
  it('forces random city fallback from geolocation failure paths', () => {
    const forcedFallbackCalls = [...appJs.matchAll(/loadRandomCity\(\{ historyMode: 'replace', force: true \}\)/g)];

    assert.ok(forcedFallbackCalls.length >= 4, 'Geolocation and nearest-city fallbacks should force random discovery');
    assert.match(
      appJs,
      /if \(!force && this\.loading && this\._loadKey === loadKey\) return;/,
      'Random city guard should be bypassable for recovery paths'
    );
  });

  it('keeps the redesigned web product surface wired across pages', () => {
    assert.match(indexHtml, /aria-label="Primary"/, 'Primary navigation should be exposed as navigation');
    assert.match(indexHtml, /\$store\.route\.page === 'atlas'/, 'Navigation should expose the atlas as a first-class page');
    assert.match(indexHtml, /home-category-strip/, 'City Pulse should expose the Stay, Eat, and See feed controls');
    assert.match(indexHtml, /aria-pressed="\$store\.discovery\.isFeedActive\(category\.key\)"/, 'Homepage filters should be toggle buttons');
    assert.match(indexHtml, /place-name-search/, 'Homepage should expose city-scoped place name search');
    assert.match(indexHtml, /hero-credit/, 'City Pulse should keep image attribution on the hero');
    assert.match(indexHtml, /atlas-status-grid/, 'Atlas should surface result and layer status');
    assert.match(indexHtml, /\$store\.atlas\.resetView\(\)/, 'Atlas should provide a reset control');
    assert.match(appJs, /activeFeedItems\(\)/, 'Discovery store should provide category-specific feed items');
    assert.match(appJs, /toggleFeed\(key\)/, 'Discovery store should support combined category toggles');
    assert.match(appJs, /defaultHomeFeedKeys\(\)[\s\S]*return \['dining'\]/, 'Homepage should default to Eat only for new visitors');
    assert.match(appJs, /HOME_FEED_PREFERENCE_KEY/, 'Homepage category toggles should persist between sessions');
    assert.match(appJs, /searchPlacesByName\(\)/, 'Discovery store should search selected categories by name');
    assert.match(indexHtml, /Open now/, 'Homepage search options should expose an open-now filter');
    assert.match(appJs, /open_now: this\.placeOpenNow/, 'Homepage search requests should pass the open-now filter');
    assert.match(appJs, /Promise\.all\(this\.feedCategories\.map/, 'Homepage name search should query Stay, Eat, and See result groups');
    assert.match(appJs, /loadMoreFeed\(\)/, 'Discovery store should support loading more homepage cards');
    assert.match(appJs, /resultsLabel\(\)/, 'Atlas store should provide result status text');
    assert.match(appJs, /resetView\(\)/, 'Atlas store should provide a reset action');
    assert.match(styleCss, /\.nav-link\.active/, 'Active navigation state should be styled');
    assert.match(styleCss, /\.home-category-strip/, 'Homepage category controls should be styled');
    assert.match(styleCss, /\.hero-credit/, 'Hero image attribution should be styled');
    assert.match(indexHtml, /Raw place data/, 'PDP should hide raw data behind a data modal');
    assert.match(dossierCss, /\.photo-strip[\s\S]*overflow-x: auto/, 'PDP photos should render as a horizontal scroller');
  });
});
