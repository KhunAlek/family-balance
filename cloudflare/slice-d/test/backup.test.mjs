import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { runPortableBackup, verifyPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

class MemoryBucket {
  constructor() {
    this.objects = new Map();
    this.deleted = [];
  }
  async put(key, value, options) { this.objects.set(key, { key, value, options, uploaded: new Date('2026-08-14T20:00:00.000Z') }); }
  async list({ prefix }) { return { objects: [...this.objects.values()].filter(value => value.key.startsWith(prefix)), truncated: false }; }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) { this.objects.delete(key); this.deleted.push(key); } }
}

test('daily backup writes environment-specific portable JSON, preserves weekly scheduling through restore, and prunes expired objects', async () => {
  const { db, raw } = createSeededSqliteD1();
  for (const name of ['0006_new_functionality.sql','0007_reporting_cycles.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql']) raw.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  raw.prepare("UPDATE obligations SET recurrence_type='weekly',due_day=NULL,due_weekday=3 WHERE name=(SELECT name FROM obligations ORDER BY name LIMIT 1)").run();
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
  assert.equal(await verifyPortableBackup(stored), true);
  assert.equal(stored.schema.some(item => /^(?:sqlite_|_cf_)/i.test(item.name)), false);
  assert.equal(stored.integrity.rowCounts.households, 1);
  assert.ok(stored.integrity.rowCounts.balance_history > 0);
  assert.equal(stored.tables.obligations.some(row => row.recurrence_type === 'weekly' && row.due_weekday === 3 && row.due_day === null), true);
  const tamperedSchema = structuredClone(stored);
  tamperedSchema.schema[0].sql = 'DROP TABLE households';
  assert.equal(await verifyPortableBackup(tamperedSchema), false);
  const restoreSql = await buildRestoreSql(stored, { includeSchema: true });
  assert.match(restoreSql, /CREATE TABLE households/);
  assert.match(restoreSql, /INSERT INTO "households"/);
  assert.match(restoreSql, /INSERT INTO "household_revisions"/);
  assert.doesNotMatch(restoreSql, /PRAGMA\s+(?:defer_)?foreign_keys\s*=/i);
  assert.doesNotMatch(restoreSql, /PRAGMA\s+foreign_key_check/i);
  const restored = new DatabaseSync(':memory:');
  restored.exec('PRAGMA foreign_keys = ON;');
  restored.exec(restoreSql);
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM balance_history').get().n, stored.integrity.rowCounts.balance_history);
  assert.equal(restored.prepare('SELECT current_revision AS n FROM household_revisions').get().n, 0);
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM obligations WHERE recurrence_type='weekly' AND due_weekday=3 AND due_day IS NULL").get().n, 1);
  assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length, 0);
});
