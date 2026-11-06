import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { databaseOperationsMethods } from '../../src/database-operations-methods.js';

function missingRelation() {
  return Object.assign(new Error('relation does not exist'), { code: '42P01' });
}

describe('database operational status', () => {
  it('summarizes the failure and quota signals without mutating schema', async () => {
    const queries = [];
    const database = {
      pool: {
        async query(sql) {
          queries.push(sql);
          if (sql.includes('DISTINCT ON')) return { rows: [{ import_type: 'osm', completed_at: '2026-11-01T00:00:00Z' }] };
          if (sql.includes("status = 'failed'")) return { rows: [{ import_type: 'geonames' }] };
          if (sql.includes('FROM osm_google_mappings')) return { rows: [{ mapping_status: 'pending', count: '4', due_count: '2' }] };
          if (sql.includes('FROM poi_homepage_harvests')) return { rows: [{ fetch_status: 'completed', count: '3' }] };
          if (sql.includes('FROM enrichment_tasks')) return { rows: [{ kind: 'google_places_enrichment', status: 'completed', count: '1', last_updated_at: '2026-11-01T00:00:00Z' }] };
          throw new Error(`Unexpected query: ${sql}`);
        },
      },
      getGoogleApiUsage: async () => ({ date: '2026-11-06', calls: 100, limit: 100, remaining: 0 }),
    };

    const status = await databaseOperationsMethods.getOperationalStatus.call(database);

    assert.deepEqual(status.google_places.mappings, [{ status: 'pending', count: 4, due_count: 2 }]);
    assert.deepEqual(status.needs_attention, [
      { type: 'failed_imports', count: 1 },
      { type: 'due_google_enrichment', count: 2 },
      { type: 'google_quota_exhausted', count: 100 },
    ]);
    assert.ok(queries.every(sql => !/CREATE|ALTER|DROP|INSERT|UPDATE|DELETE/i.test(sql)));
  });

  it('marks optional operational tables unavailable instead of creating them', async () => {
    const database = {
      pool: {
        async query(sql) {
          if (sql.includes('DISTINCT ON') || sql.includes("status = 'failed'")) return { rows: [] };
          throw missingRelation();
        },
      },
      getGoogleApiUsage: async () => { throw missingRelation(); },
    };

    const status = await databaseOperationsMethods.getOperationalStatus.call(database);

    assert.equal(status.google_places.mappings_available, false);
    assert.equal(status.homepage_harvest.available, false);
    assert.equal(status.maintenance_tasks.available, false);
    assert.equal(status.google_places.api_usage, null);
  });
});
