function asCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingRelation(error) {
  return error?.code === '42P01' || /relation .* does not exist/i.test(error?.message || '');
}

async function optionalQuery(pool, sql, params = []) {
  try {
    return { available: true, rows: (await pool.query(sql, params)).rows };
  } catch (error) {
    if (isMissingRelation(error)) return { available: false, rows: [] };
    throw error;
  }
}

/**
 * Read-only operational queries. These deliberately do not initialize or alter
 * schema: reporting must not mutate a production database.
 */
export const databaseOperationsMethods = {
  async getOperationalStatus() {
    const [imports, failedImports, mappings, homepageHarvests, tasks, googleUsage] = await Promise.all([
      optionalQuery(this.pool, `
        SELECT DISTINCT ON (import_type)
          import_type, status, started_at, completed_at, records_imported, error_message
        FROM import_log
        ORDER BY import_type, started_at DESC
      `),
      optionalQuery(this.pool, `
        SELECT import_type, started_at, completed_at, error_message
        FROM import_log
        WHERE status = 'failed' AND started_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        ORDER BY started_at DESC
        LIMIT 20
      `),
      optionalQuery(this.pool, `
        SELECT
          mapping_status,
          COUNT(*) AS count,
          COUNT(*) FILTER (
            WHERE mapping_status IN ('pending', 'error')
              AND (next_enrichment_at IS NULL OR next_enrichment_at <= CURRENT_TIMESTAMP)
          ) AS due_count
        FROM osm_google_mappings
        GROUP BY mapping_status
        ORDER BY mapping_status
      `),
      optionalQuery(this.pool, `
        SELECT fetch_status, COUNT(*) AS count
        FROM poi_homepage_harvests
        GROUP BY fetch_status
        ORDER BY fetch_status
      `),
      optionalQuery(this.pool, `
        SELECT kind, status, COUNT(*) AS count, MAX(updated_at) AS last_updated_at
        FROM enrichment_tasks
        GROUP BY kind, status
        ORDER BY kind, status
      `),
      this.getGoogleApiUsage().catch(error => {
        if (isMissingRelation(error)) return null;
        throw error;
      }),
    ]);

    const mappingSummary = mappings.rows.map(row => ({
      status: row.mapping_status,
      count: asCount(row.count),
      due_count: asCount(row.due_count),
    }));
    const dueMappings = mappingSummary.reduce((total, row) => total + row.due_count, 0);
    const attention = [];

    if (failedImports.rows.length) attention.push({ type: 'failed_imports', count: failedImports.rows.length });
    if (dueMappings) attention.push({ type: 'due_google_enrichment', count: dueMappings });
    if (googleUsage?.remaining === 0) attention.push({ type: 'google_quota_exhausted', count: googleUsage.calls });

    return {
      generated_at: new Date().toISOString(),
      imports: {
        available: imports.available,
        latest_by_type: imports.rows,
        failed_last_7_days: failedImports.rows,
      },
      google_places: {
        api_usage: googleUsage,
        mappings_available: mappings.available,
        mappings: mappingSummary,
      },
      homepage_harvest: {
        available: homepageHarvests.available,
        by_status: homepageHarvests.rows.map(row => ({ status: row.fetch_status, count: asCount(row.count) })),
      },
      maintenance_tasks: {
        available: tasks.available,
        by_kind_and_status: tasks.rows.map(row => ({
          kind: row.kind,
          status: row.status,
          count: asCount(row.count),
          last_updated_at: row.last_updated_at,
        })),
      },
      needs_attention: attention,
    };
  },
};
