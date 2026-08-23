import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1, SqliteD1Adapter } from '../../slice-c/test/sqlite-d1.mjs';
import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';
import { buildPlanningState } from '../../slice-b/src/planning.mjs';
import { planSalaryReceiptTransition } from '../../slice-c/src/salary-cycle.mjs';
import { runPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

const migrationSql = fs.readFileSync(new URL('../migrations/0005_v3_minimal_planning.sql', import.meta.url), 'utf8');

class MemoryBucket {
  constructor() { this.objects = new Map(); }
  async put(key, value, options) { this.objects.set(key, { key, value, options, uploaded: new Date() }); }
  async list({ prefix }) { return { objects: [...this.objects.values()].filter(value => value.key.startsWith(prefix)), truncated: false }; }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
}

function migratedFixture() {
  return createSeededSqliteD1();
}

async function backupAndRestore(db, createdAt) {
  const bucket = new MemoryBucket();
  const result = await runPortableBackup(db, bucket, { environment: 'test', retentionDays: 35, createdAt });
  const backup = JSON.parse(bucket.objects.get(result.key).value);
  const restoredRaw = new DatabaseSync(':memory:');
  restoredRaw.exec('PRAGMA foreign_keys = ON;');
  restoredRaw.exec(await buildRestoreSql(backup, { includeSchema: true }));
  assert.equal(restoredRaw.prepare('PRAGMA foreign_key_check').all().length, 0);
  return { backup, raw: restoredRaw, db: new SqliteD1Adapter(restoredRaw) };
}

function planningFingerprint(snapshot, onDate) {
  const planning = buildPlanningState(snapshot, onDate);
  return {
    planningState: planning.planningState,
    operationalCash: planning.operationalCash,
    requiredOutstanding: planning.commitments.requiredOutstanding,
    efOutstanding: planning.commitments.ef.outstanding,
    goalsOutstanding: planning.commitments.goalsOutstanding,
    totalOutstanding: planning.commitments.totalOutstanding,
    availableToSpend: planning.availableToSpend,
  };
}

test('V3-M22 — ordinary portable backup/restore preserves non-default planning state and Available', async () => {
  const { db, raw } = migratedFixture();
  raw.prepare('UPDATE salary_cycle_state SET variables_target_satang=?,ef_cycle_commitment_satang=? WHERE household_id=?').run(2750000, 900000, 'family');
  raw.prepare('UPDATE goals SET cycle_commitment_satang=? WHERE household_id=?').run(350000, 'family');
  const before = await loadFinancialSnapshot(db);
  const beforeFingerprint = planningFingerprint(before, '2026-08-20');

  const restored = await backupAndRestore(db, '2026-08-20T20:00:00.000Z');
  const after = await loadFinancialSnapshot(restored.db);
  assert.equal(after.salaryCycle.variables_target_satang, 2750000);
  assert.equal(after.salaryCycle.ef_cycle_commitment_satang, 900000);
  assert.equal(after.goals[0].cycle_commitment_satang, 350000);
  assert.deepEqual(planningFingerprint(after, '2026-08-20'), beforeFingerprint);
});

test('V3-M41 — representative accepted baseline migrates additively with exact cutover state', async () => {
  const { raw } = createSeededSqliteD1({ includeV3: false });
  const protectedTables = ['balance_history', 'income_receipts', 'obligations', 'obligation_payments', 'ledger_movements', 'weekly_snapshots', 'correction_audit'];
  const before = Object.fromEntries(protectedTables.map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const configuredEf = raw.prepare("SELECT value_satang FROM configuration WHERE household_id='family' AND config_key='ef_monthly_claim_cap'").get()?.value_satang ?? 1500000;

  raw.exec(migrationSql);

  const cycle = raw.prepare("SELECT variables_target_satang,ef_cycle_commitment_satang FROM salary_cycle_state WHERE household_id='family'").get();
  assert.equal(cycle.variables_target_satang, null);
  assert.equal(cycle.ef_cycle_commitment_satang, configuredEf);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM goals WHERE cycle_commitment_satang<>0').get().n, 0);
  for (const table of protectedTables) {
    assert.deepEqual(raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), before[table], `${table} changed during additive migration`);
  }
});

test('V3-M42 — post-salary-transition planning state survives ordinary backup/restore', async () => {
  const { db, raw } = migratedFixture();
  const oldSnapshot = await loadFinancialSnapshot(db);
  const salarySource = oldSnapshot.incomeDefinitions.find(item => String(item.pay_day) !== 'Variable')?.source;
  assert.ok(salarySource, 'representative fixture must contain a salary source');
  const transition = planSalaryReceiptTransition(oldSnapshot, '2026-08-31', salarySource, 'family');
  assert.equal(transition.advanced, true);
  assert.equal(transition.variablesTargetRequired, true);
  await db.batch(transition.statements.map(item => db.prepare(item.sql).bind(...item.params)));
  raw.prepare('UPDATE salary_cycle_state SET next_salary_date=?,variables_target_satang=?,ef_cycle_commitment_satang=? WHERE household_id=?').run('2026-09-30', 3100000, 800000, 'family');
  raw.prepare('UPDATE goals SET cycle_commitment_satang=? WHERE household_id=?').run(250000, 'family');

  const before = await loadFinancialSnapshot(db);
  const beforeFingerprint = planningFingerprint(before, '2026-08-31');
  const restored = await backupAndRestore(db, '2026-08-31T20:00:00.000Z');
  const after = await loadFinancialSnapshot(restored.db);

  assert.equal(after.salaryCycle.current_cycle_start, '2026-08-31');
  assert.equal(after.salaryCycle.next_salary_date, '2026-09-30');
  assert.equal(after.salaryCycle.variables_target_satang, 3100000);
  assert.equal(after.salaryCycle.ef_cycle_commitment_satang, 800000);
  assert.equal(after.goals[0].cycle_commitment_satang, 250000);
  assert.deepEqual(planningFingerprint(after, '2026-08-31'), beforeFingerprint);
});
