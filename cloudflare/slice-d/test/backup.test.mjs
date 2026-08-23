import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { BACKUP_FORMAT, BACKUP_TABLES, runPortableBackup, verifyPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v3Migration = fs.readFileSync(path.resolve(here, '../migrations/0005_v3_persistence.sql'), 'utf8');

class MemoryBucket {
  constructor() {
    this.objects = new Map();
    this.deleted = [];
  }
  async put(key, value, options) { this.objects.set(key, { key, value, options, uploaded: new Date('2026-08-14T20:00:00.000Z') }); }
  async list({ prefix }) { return { objects: [...this.objects.values()].filter(value => value.key.startsWith(prefix)), truncated: false }; }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) { this.objects.delete(key); this.deleted.push(key); } }
}

test('daily backup writes v3 portable JSON, covers every V3-1 table/schema object, restores FK-safely, and prunes expired objects', async () => {
  const { db, raw } = createSeededSqliteD1();
  raw.exec(v3Migration);
  const bucket = new MemoryBucket();
  bucket.objects.set('staging/2026/06/01/old.json', { key: 'staging/2026/06/01/old.json', uploaded: new Date('2026-06-01T00:00:00.000Z') });
  const result = await runPortableBackup(db, bucket, {
    environment: 'staging',
    retentionDays: 35,
    createdAt: '2026-08-14T20:00:00.000Z',
  });
  assert.equal(result.ok, true);
  assert.equal(result.key, 'staging/2026/08/14/2026-08-14T20-00-00Z.json');
  assert.deepEqual(bucket.deleted, ['staging/2026/06/01/old.json']);
  const stored = JSON.parse(bucket.objects.get(result.key).value);
  assert.equal(stored.format, BACKUP_FORMAT);
  assert.equal(await verifyPortableBackup(stored), true);
  assert.equal(stored.schema.some(item => /^(?:sqlite_|_cf_)/i.test(item.name)), false);
  assert.deepEqual(Object.keys(stored.tables), [...BACKUP_TABLES]);
  for (const table of ['cycle_plans','cycle_plan_events','cycle_commitments','commitment_events','goal_withdrawal_classifications','weekly_snapshot_model_versions']) {
    assert.ok(Array.isArray(stored.tables[table]), `${table} must be backed up`);
    assert.ok(stored.schema.some(item => item.type === 'table' && item.name === table), `${table} schema must be backed up`);
  }
  assert.ok(stored.schema.some(item => item.type === 'index' && item.name === 'uq_cycle_commitment_identity'));
  assert.ok(stored.schema.some(item => item.type === 'trigger' && item.name === 'goal_withdrawal_classification_validate_insert'));
  assert.equal(stored.integrity.rowCounts.households, 1);
  assert.ok(stored.integrity.rowCounts.balance_history > 0);

  const tamperedSchema = structuredClone(stored);
  tamperedSchema.schema[0].sql = 'DROP TABLE households';
  assert.equal(await verifyPortableBackup(tamperedSchema), false);
  const missingV3Table = structuredClone(stored);
  delete missingV3Table.tables.cycle_plans;
  assert.equal(await verifyPortableBackup(missingV3Table), false);

  const restoreSql = await buildRestoreSql(stored, { includeSchema: true });
  assert.match(restoreSql, /CREATE TABLE households/);
  assert.match(restoreSql, /CREATE TABLE cycle_plans/);
  assert.match(restoreSql, /CREATE TABLE goal_withdrawal_classifications/);
  assert.match(restoreSql, /INSERT INTO "households"/);
  assert.match(restoreSql, /INSERT INTO "household_revisions"/);
  assert.doesNotMatch(restoreSql, /PRAGMA\s+(?:defer_)?foreign_keys\s*=/i);
  assert.doesNotMatch(restoreSql, /PRAGMA\s+foreign_key_check/i);
  assert.ok(restoreSql.indexOf('CREATE TABLE households') < restoreSql.indexOf('CREATE TABLE cycle_plans'));
  assert.ok(restoreSql.indexOf('CREATE TABLE cycle_plans') < restoreSql.indexOf('CREATE TABLE cycle_plan_events'));
  assert.ok(restoreSql.indexOf('CREATE TABLE cycle_commitments') < restoreSql.indexOf('CREATE TABLE commitment_events'));
  assert.ok(restoreSql.indexOf('CREATE TABLE goals') < restoreSql.indexOf('CREATE TABLE goal_withdrawal_classifications'));
  assert.ok(restoreSql.indexOf('CREATE TABLE ledger_movements') < restoreSql.indexOf('CREATE TABLE goal_withdrawal_classifications'));

  const restored = new DatabaseSync(':memory:');
  restored.exec('PRAGMA foreign_keys = ON;');
  restored.exec(restoreSql);
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM balance_history').get().n, stored.integrity.rowCounts.balance_history);
  assert.equal(restored.prepare('SELECT current_revision AS n FROM household_revisions').get().n, 0);
  assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length, 0);
});
