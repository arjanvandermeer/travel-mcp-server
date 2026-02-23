#!/usr/bin/env node
/**
 * Backfill name_en for existing POIs with Thai names
 *
 * Finds POIs where name_en IS NULL and the name contains Thai characters,
 * transliterates them, and updates in batches.
 *
 * Usage:
 *   node scripts/backfill-name-en.js [--batch=1000] [--region=thailand-latest]
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { getEnglishName } from '../src/lib/transliterate-thai.js';

dotenv.config();

const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://<user>:<password>@localhost:5432/travel';

const BATCH_SIZE = parseInt(
  process.argv.find(a => a.startsWith('--batch='))?.split('=')[1] || '1000'
);
const REGION = process.argv.find(a => a.startsWith('--region='))?.split('=')[1] || null;

async function backfill() {
  const pool = new pg.Pool({ connectionString: CONNECTION_STRING });

  try {
    // Count candidates: POIs with Thai characters in name and no name_en yet
    const countParams = [];
    let countQuery = `
      SELECT COUNT(*) as count FROM osm_pois
      WHERE name_en IS NULL
        AND name IS NOT NULL
        AND name ~ '[\u0E00-\u0E7F]'
    `;
    if (REGION) {
      countParams.push(REGION);
      countQuery += ` AND source_region = $1`;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);
    console.log(`Found ${total} POIs with Thai names needing transliteration`);

    if (total === 0) {
      console.log('Nothing to do.');
      return;
    }

    let processed = 0;
    let updated = 0;
    let lastOsmId = -1;

    while (true) {
      const selectParams = [lastOsmId];
      let selectQuery = `
        SELECT osm_id, name, tags FROM osm_pois
        WHERE name_en IS NULL
          AND name IS NOT NULL
          AND name ~ '[\u0E00-\u0E7F]'
          AND osm_id > $1
      `;

      if (REGION) {
        selectParams.push(REGION);
        selectQuery += ` AND source_region = $${selectParams.length}`;
      }

      selectParams.push(BATCH_SIZE);
      selectQuery += ` ORDER BY osm_id LIMIT $${selectParams.length}`;

      const batch = await pool.query(selectQuery, selectParams);
      if (batch.rows.length === 0) break;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of batch.rows) {
          const tags = row.tags || {};
          const nameEn = getEnglishName(row.name, tags);
          if (nameEn) {
            await client.query(
              'UPDATE osm_pois SET name_en = $1 WHERE osm_id = $2',
              [nameEn, row.osm_id]
            );
            updated++;
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      processed += batch.rows.length;
      lastOsmId = batch.rows[batch.rows.length - 1].osm_id;
      console.log(`  Processed ${processed}/${total} (${updated} updated)`);
    }

    console.log(`\nDone. Processed ${processed} POIs, updated ${updated} with name_en.`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

backfill();
