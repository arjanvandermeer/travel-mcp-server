#!/usr/bin/env node
/**
 * Quick direct import of admin1 codes to RDS
 */
import pg from 'pg';
import fs from 'fs';

const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://traveluser:travelpass@localhost:5432/travel';

async function importAdmin1() {
  const pool = new pg.Pool({ connectionString: CONNECTION_STRING });

  try {
    console.log('Reading admin1CodesASCII.txt...');
    const content = fs.readFileSync('data/admin1CodesASCII.txt', 'utf-8');
    const lines = content.trim().split('\n');
    console.log(`Found ${lines.length} admin1 codes`);

    console.log('Inserting into database...');
    let inserted = 0;

    for (const line of lines) {
      const [code, name, asciiName, geonameId] = line.split('\t');
      if (!code || !name) continue;

      const [countryCode, admin1Code] = code.split('.');
      if (!countryCode || !admin1Code) continue;

      try {
        await pool.query(`
          INSERT INTO geonames_admin1_codes (code, country_code, admin1_code, name, ascii_name, geoname_id)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name,
            ascii_name = EXCLUDED.ascii_name,
            geoname_id = EXCLUDED.geoname_id
        `, [code, countryCode, admin1Code, name, asciiName || null, geonameId ? parseInt(geonameId) : null]);

        inserted++;
        if (inserted % 500 === 0) {
          console.log(`  Inserted ${inserted} / ${lines.length}`);
        }
      } catch (err) {
        // Skip records that fail FK constraint (country doesn't exist)
        if (!err.message.includes('foreign key')) {
          console.error(`Error inserting ${code}: ${err.message}`);
        }
      }
    }

    console.log(`\n✅ Imported ${inserted} admin1 codes`);

    // Verify
    const result = await pool.query('SELECT COUNT(*) FROM geonames_admin1_codes');
    console.log(`Total in database: ${result.rows[0].count}`);

    // Record in imports table
    await pool.query(`
      INSERT INTO imports (import_type, source_file, source_url, status, records_imported, completed_at)
      VALUES ('geonames_admin1', 'admin1CodesASCII.txt', 'https://download.geonames.org/export/dump/admin1CodesASCII.txt', 'completed', $1, CURRENT_TIMESTAMP)
    `, [inserted]);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importAdmin1();
