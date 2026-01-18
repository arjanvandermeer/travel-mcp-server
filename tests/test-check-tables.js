#!/usr/bin/env node

import pg from 'pg';

const PG_CONNECTION = 'postgresql://traveluser:travelpass@localhost:5432/travel';

async function checkTables() {
  const pool = new pg.Pool({ connectionString: PG_CONNECTION });

  try {
    const tables = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    console.log('Tables in database:');
    tables.rows.forEach(t => {
      console.log(`  - ${t.tablename}`);
    });

    console.log('\nViews in database:');
    const views = await pool.query(`
      SELECT viewname
      FROM pg_views
      WHERE schemaname = 'public'
      ORDER BY viewname
    `);
    views.rows.forEach(v => {
      console.log(`  - ${v.viewname}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTables();
