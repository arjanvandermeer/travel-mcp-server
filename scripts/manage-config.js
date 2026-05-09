#!/usr/bin/env node

/**
 * Manage database configuration
 *
 * Usage:
 *   node manage-config.js get <key>
 *   node manage-config.js set <key> <value>
 *   node manage-config.js list
 */

import { TravelDatabase } from '../src/database.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help') {
    console.log('Usage:');
    console.log('  node manage-config.js list                    - List all config');
    console.log('  node manage-config.js get <key>               - Get config value');
    console.log('  node manage-config.js set <key> <value> [description]');
    console.log('');
    console.log('Examples:');
    console.log('  node manage-config.js list');
    console.log('  node manage-config.js get google_places_api_key');
    console.log('  node manage-config.js set google_places_enabled false');
    console.log('  node manage-config.js set google_places_cache_hours 336 "Cache for 2 weeks"');
    console.log('  node manage-config.js set google_analytics_measurement_id G-XXXXXXXXXX "Google Analytics measurement ID"');
    process.exit(0);
  }

  const db = new TravelDatabase();

  try {
    if (command === 'list') {
      const result = await db.pool.query(`
        SELECT key, value, description, updated_at
        FROM app_config
        ORDER BY key
      `);

      if (result.rows.length === 0) {
        console.log('No configuration found.');
      } else {
        console.log('Configuration:\n');
        result.rows.forEach(row => {
          console.log(`${row.key}:`);
          console.log(`  Value: ${row.value}`);
          if (row.description) {
            console.log(`  Description: ${row.description}`);
          }
          console.log(`  Updated: ${row.updated_at}`);
          console.log('');
        });
      }
    } else if (command === 'get') {
      const key = args[1];
      if (!key) {
        console.error('Error: Missing key');
        process.exit(1);
      }

      const value = await db.getConfig(key);
      if (value === null) {
        console.log(`${key}: NOT SET`);
      } else {
        console.log(`${key}: ${value}`);
      }
    } else if (command === 'set') {
      const key = args[1];
      const value = args[2];
      const description = args[3] || null;

      if (!key || value === undefined) {
        console.error('Error: Missing key or value');
        process.exit(1);
      }

      await db.setConfig(key, value, description);
      console.log(`✓ Set ${key} = ${value}`);

      // If it's a Google Places setting, reinitialize
      if (key.startsWith('google_places')) {
        console.log('Reinitializing Google Places client...');
        await db.initGooglePlaces();
      }
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main();
