import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const schema = readFileSync(join(process.cwd(), 'data/schema.sql'), 'utf8');

describe('AI summary schema', () => {
  it('appends homepage harvest fields after the existing view columns', () => {
    const view = schema.match(/CREATE OR REPLACE VIEW enriched_pois AS[\s\S]*?FROM osm_pois p/)?.[0] || '';

    assert.match(view, /m\.last_verified_at,[\s\S]*hh\.final_url as homepage_final_url/);
    assert.ok(view.indexOf('google_enriched_at') < view.indexOf('homepage_final_url'));
    assert.ok(view.indexOf('mapping_status') < view.indexOf('homepage_final_url'));
  });

  it('stores homepage summaries and harvests outside the Google Places table', () => {
    const googlePlacesBlock = schema.match(/CREATE TABLE IF NOT EXISTS google_places \([\s\S]*?\n\);/)?.[0] || '';

    assert.match(schema, /CREATE TABLE IF NOT EXISTS poi_homepage_summaries/);
    assert.match(schema, /original_url VARCHAR\(500\) NOT NULL/);
    assert.match(schema, /summary TEXT/);
    assert.match(schema, /summarized_at TIMESTAMP/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS poi_homepage_harvests/);
    assert.match(schema, /image_urls JSONB DEFAULT '\[\]'::jsonb/);
    assert.match(schema, /content_hash VARCHAR\(64\)/);
    assert.match(schema, /next_fetch_at TIMESTAMP/);
    assert.match(schema, /homepage_image_urls/);
    assert.doesNotMatch(googlePlacesBlock, /ai_homepage_summary/);
    assert.doesNotMatch(googlePlacesBlock, /ai_homepage_url/);
    assert.doesNotMatch(googlePlacesBlock, /homepage_image_urls/);
  });
});
