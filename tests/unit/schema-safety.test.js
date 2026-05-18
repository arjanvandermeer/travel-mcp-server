import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const schemaSql = fs.readFileSync(new URL('../../data/schema.sql', import.meta.url), 'utf8');
const tokenHashMigrationSql = fs.readFileSync(new URL('../../data/migrations/006_hash_user_tokens.sql', import.meta.url), 'utf8');
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

  it('defines hotel chain reference data idempotently', () => {
    assert.match(schemaSql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+hotel_chains/i);
    assert.match(schemaSql, /ON\s+CONFLICT\s+\(chain_name,\s*brand_name\)\s+DO\s+UPDATE/i);
    assert.match(schemaSql, /'Hilton',\s*'Conrad'/i);
    assert.match(schemaSql, /'Hilton',\s*'DoubleTree'/i);
  });

  it('stores user API tokens by hash with legacy plaintext nullable', () => {
    assert.match(schemaSql, /token_hash\s+VARCHAR\(64\)/i);
    assert.match(schemaSql, /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_user_tokens_token_hash/i);
    assert.match(schemaSql, /ALTER\s+COLUMN\s+token\s+DROP\s+NOT\s+NULL/i);
    assert.match(tokenHashMigrationSql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+token_hash\s+VARCHAR\(64\)/i);
    assert.match(tokenHashMigrationSql, /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_user_tokens_token_hash/i);
  });
});
