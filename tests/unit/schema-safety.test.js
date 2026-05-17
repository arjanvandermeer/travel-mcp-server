import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const schemaSql = fs.readFileSync(new URL('../../data/schema.sql', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('schema safety', () => {
  it('keeps the default schema file non-destructive', () => {
    assert.doesNotMatch(schemaSql, /^\s*DROP\s+TABLE\b/im);
    assert.doesNotMatch(schemaSql, /^\s*TRUNCATE\b/im);
  });

  it('uses idempotent table and index creation in the default schema', () => {
    const unsafeCreate = schemaSql
      .split('\n')
      .filter(line => /^\s*CREATE\s+(TABLE|INDEX)\b/i.test(line))
      .filter(line => !/CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i.test(line));

    assert.deepStrictEqual(unsafeCreate, []);
  });

  it('keeps destructive reset behind an explicit npm script', () => {
    assert.strictEqual(packageJson.scripts['db:init'], 'node scripts/db-init.js');
    assert.strictEqual(packageJson.scripts['db:reset'], 'node scripts/db-init.js --reset');
  });
});
