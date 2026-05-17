#!/usr/bin/env node

/**
 * One-command OSM region initialization.
 *
 * Usage:
 *   npm run init:osm -- thailand
 *   npm run init:osm -- thailand restaurant --geonames --optimize
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { parseInitOsmArgs } from '../src/lib/arg-parsers.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log(`
Initialize and import an OSM region

Usage:
  npm run init:osm -- <region> [poi-type] [options]

Examples:
  npm run init:osm -- thailand
  npm run init:osm -- thailand restaurant
  npm run init:osm -- thailand all --geonames --optimize

Options:
  --skip-db-init  Do not run npm run db:init before importing
  --geonames      Import GeoNames country/city data before OSM
  --optimize      Run database optimization after import
  --help, -h      Show this help message
`);
}

function runStep(label, command, args) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(label);
    console.log('='.repeat(60));

    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
      cwd: path.join(__dirname, '..'),
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', (error) => {
      console.error(`${label} failed to start: ${error.message}`);
      resolve(false);
    });
  });
}

async function main() {
  const options = parseInitOsmArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!options.region) {
    printHelp();
    process.exit(1);
  }

  const steps = [];
  if (!options.skipDbInit) {
    steps.push(['Initialize database schema', 'node', [path.join(__dirname, 'db-init.js')]]);
  }
  if (options.geonames) {
    steps.push(['Import GeoNames data', 'node', [path.join(__dirname, 'import-geonames.js')]]);
  }
  steps.push([
    `Import OSM region ${options.region} (${options.poiType})`,
    'node',
    [path.join(__dirname, 'import-osm.js'), options.region, options.poiType],
  ]);
  if (options.optimize) {
    steps.push(['Optimize database after import', 'node', [path.join(__dirname, 'optimize-db.js')]]);
  }

  for (const [label, command, args] of steps) {
    const ok = await runStep(label, command, args);
    if (!ok) {
      console.error(`\n✗ ${label} failed. Stopping init:osm workflow.`);
      process.exit(1);
    }
  }

  console.log(`\n✓ init:osm completed for ${options.region}`);
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
