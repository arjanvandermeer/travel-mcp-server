import { SEARCH_LIMIT_MAX } from './config.js';

export const databaseImportMethods = {
  async startImport(importType, options = {}) {
    const {
      sourceFile = null,
      sourceUrl = null,
      sourceDate = null,
      regionName = null,
      metadata = null,
    } = options;

    const result = await this.pool.query(`
      INSERT INTO import_log (
        import_type,
        source_file,
        source_url,
        source_date,
        region_name,
        metadata,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'running')
      RETURNING id
    `, [
      importType,
      sourceFile,
      sourceUrl,
      sourceDate,
      regionName,
      metadata ? JSON.stringify(metadata) : null,
    ]);

    return result.rows[0].id;
  },

  async completeImport(importId, recordsImported) {
    await this.pool.query(`
      UPDATE import_log
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          records_imported = $2
      WHERE id = $1
    `, [importId, recordsImported]);
  },

  async failImport(importId, errorMessage) {
    await this.pool.query(`
      UPDATE import_log
      SET status = 'failed',
          completed_at = CURRENT_TIMESTAMP,
          error_message = $2
      WHERE id = $1
    `, [importId, errorMessage]);
  },

  async getImportHistory(limit = 20) {
    const result = await this.pool.query(`
      SELECT
        id,
        import_type,
        source_file,
        source_url,
        source_date,
        region_name,
        started_at,
        completed_at,
        status,
        records_imported,
        error_message,
        metadata
      FROM import_log
      ORDER BY started_at DESC
      LIMIT $1
    `, [Math.min(limit, SEARCH_LIMIT_MAX)]);

    return result.rows;
  },
};
