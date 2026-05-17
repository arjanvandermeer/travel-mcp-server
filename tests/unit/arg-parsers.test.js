/**
 * Tests for CLI Argument Parsers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseRefreshArgs,
  parseInitOsmArgs,
  parseOptimizeArgs,
  parseImportArgs,
} from '../../src/lib/arg-parsers.js';

describe('parseRefreshArgs', () => {
  it('should return defaults for empty args', () => {
    const options = parseRefreshArgs([]);

    assert.deepStrictEqual(options, {
      dryRun: false,
      max: null,
      region: null,
      force: false,
      list: false,
      optimize: false,
      refreshGeonames: false,
      refreshGoogle: false,
      skipOsm: false,
      help: false,
    });
  });

  it('should parse --dry-run flag', () => {
    const options = parseRefreshArgs(['--dry-run']);

    assert.strictEqual(options.dryRun, true);
    assert.strictEqual(options.force, false);
  });

  it('should parse --force flag', () => {
    const options = parseRefreshArgs(['--force']);

    assert.strictEqual(options.force, true);
  });

  it('should parse --list flag', () => {
    const options = parseRefreshArgs(['--list']);

    assert.strictEqual(options.list, true);
  });

  it('should parse scheduled refresh flags', () => {
    const options = parseRefreshArgs(['--skip-osm', '--refresh-google', '--refresh-geonames']);

    assert.strictEqual(options.skipOsm, true);
    assert.strictEqual(options.refreshGoogle, true);
    assert.strictEqual(options.refreshGeonames, true);
  });

  it('should parse --optimize flag', () => {
    const options = parseRefreshArgs(['--optimize']);

    assert.strictEqual(options.optimize, true);
  });

  it('should parse --max=N option', () => {
    const options = parseRefreshArgs(['--max=5']);

    assert.strictEqual(options.max, 5);
  });

  it('should handle --max with invalid number', () => {
    const options = parseRefreshArgs(['--max=abc']);

    assert.strictEqual(options.max, null);
  });

  it('should parse --region=NAME option', () => {
    const options = parseRefreshArgs(['--region=thailand']);

    assert.strictEqual(options.region, 'thailand');
  });

  it('should handle --region= with empty value', () => {
    const options = parseRefreshArgs(['--region=']);

    assert.strictEqual(options.region, null);
  });

  it('should parse --help flag', () => {
    const options = parseRefreshArgs(['--help']);

    assert.strictEqual(options.help, true);
  });

  it('should parse -h flag', () => {
    const options = parseRefreshArgs(['-h']);

    assert.strictEqual(options.help, true);
  });

  it('should parse multiple flags together', () => {
    const options = parseRefreshArgs(['--dry-run', '--max=3', '--region=france']);

    assert.strictEqual(options.dryRun, true);
    assert.strictEqual(options.max, 3);
    assert.strictEqual(options.region, 'france');
  });

  it('should ignore unknown flags', () => {
    const options = parseRefreshArgs(['--unknown', '--another=value']);

    // Should return defaults without error
    assert.strictEqual(options.dryRun, false);
    assert.strictEqual(options.max, null);
  });

  it('should handle real-world example: --region=thailand --force', () => {
    const options = parseRefreshArgs(['--region=thailand', '--force']);

    assert.strictEqual(options.region, 'thailand');
    assert.strictEqual(options.force, true);
    assert.strictEqual(options.dryRun, false);
  });

  it('should handle real-world example: --max=2 --optimize', () => {
    const options = parseRefreshArgs(['--max=2', '--optimize']);

    assert.strictEqual(options.max, 2);
    assert.strictEqual(options.optimize, true);
  });
});

describe('parseInitOsmArgs', () => {
  it('should parse a one-command region import', () => {
    const options = parseInitOsmArgs(['thailand']);

    assert.deepStrictEqual(options, {
      region: 'thailand',
      poiType: 'all',
      skipDbInit: false,
      geonames: false,
      optimize: false,
      help: false,
    });
  });

  it('should parse optional POI type and workflow flags', () => {
    const options = parseInitOsmArgs(['thailand', 'restaurant', '--skip-db-init', '--geonames', '--optimize']);

    assert.strictEqual(options.region, 'thailand');
    assert.strictEqual(options.poiType, 'restaurant');
    assert.strictEqual(options.skipDbInit, true);
    assert.strictEqual(options.geonames, true);
    assert.strictEqual(options.optimize, true);
  });

  it('should parse help without a region', () => {
    const options = parseInitOsmArgs(['--help']);

    assert.strictEqual(options.region, null);
    assert.strictEqual(options.help, true);
  });
});

describe('parseOptimizeArgs', () => {
  it('should return defaults for empty args', () => {
    const options = parseOptimizeArgs([]);

    assert.deepStrictEqual(options, {
      full: false,
      reindex: false,
      table: null,
      dryRun: false,
      help: false,
    });
  });

  it('should parse --full flag', () => {
    const options = parseOptimizeArgs(['--full']);

    assert.strictEqual(options.full, true);
  });

  it('should parse --reindex flag', () => {
    const options = parseOptimizeArgs(['--reindex']);

    assert.strictEqual(options.reindex, true);
  });

  it('should parse --dry-run flag', () => {
    const options = parseOptimizeArgs(['--dry-run']);

    assert.strictEqual(options.dryRun, true);
  });

  it('should parse --table=NAME option', () => {
    const options = parseOptimizeArgs(['--table=osm_pois']);

    assert.strictEqual(options.table, 'osm_pois');
  });

  it('should handle --table= with empty value', () => {
    const options = parseOptimizeArgs(['--table=']);

    assert.strictEqual(options.table, null);
  });

  it('should parse --help flag', () => {
    const options = parseOptimizeArgs(['--help']);

    assert.strictEqual(options.help, true);
  });

  it('should parse -h flag', () => {
    const options = parseOptimizeArgs(['-h']);

    assert.strictEqual(options.help, true);
  });

  it('should parse multiple flags together', () => {
    const options = parseOptimizeArgs(['--full', '--reindex']);

    assert.strictEqual(options.full, true);
    assert.strictEqual(options.reindex, true);
  });

  it('should handle real-world example: --table=osm_pois --dry-run', () => {
    const options = parseOptimizeArgs(['--table=osm_pois', '--dry-run']);

    assert.strictEqual(options.table, 'osm_pois');
    assert.strictEqual(options.dryRun, true);
  });
});

describe('parseImportArgs', () => {
  it('should return defaults for empty args', () => {
    const options = parseImportArgs([]);

    assert.strictEqual(options.input, null);
    assert.strictEqual(options.poiType, 'all');
  });

  it('should parse keyword input', () => {
    const options = parseImportArgs(['thailand']);

    assert.strictEqual(options.input, 'thailand');
    assert.strictEqual(options.poiType, 'all');
  });

  it('should parse keyword and poi type', () => {
    const options = parseImportArgs(['france', 'hotel']);

    assert.strictEqual(options.input, 'france');
    assert.strictEqual(options.poiType, 'hotel');
  });

  it('should parse file path input', () => {
    const options = parseImportArgs(['/path/to/file.osm.pbf']);

    assert.strictEqual(options.input, '/path/to/file.osm.pbf');
    assert.strictEqual(options.poiType, 'all');
  });

  it('should parse file path with poi type', () => {
    const options = parseImportArgs(['/path/to/file.osm.pbf', 'restaurant']);

    assert.strictEqual(options.input, '/path/to/file.osm.pbf');
    assert.strictEqual(options.poiType, 'restaurant');
  });

  it('should handle various poi types', () => {
    const types = ['hotel', 'restaurant', 'cafe', 'museum', 'attraction'];

    for (const type of types) {
      const options = parseImportArgs(['thailand', type]);
      assert.strictEqual(options.poiType, type);
    }
  });
});
