#!/usr/bin/env node

import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function checkView() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    const viewDef = await pool.query(`
      SELECT pg_get_viewdef('enriched_pois', true) as definition
    `);

    console.log('Current enriched_pois view definition:');
    console.log(viewDef.rows[0].definition);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkView();
