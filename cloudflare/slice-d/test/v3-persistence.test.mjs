import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { assertV3MigrationDataSafe, loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const migration = name => fs.readFileSync(path.join(repo, name), 'utf8');
const V3 = 'cloudflare/slice-d/migrations/0005_v3_persistence.sql';

function applyFreshMigrations(raw) {
  raw.exec(migration('cloudflare/slice-b/migrations/0001_initial.sql'));
  raw.exec(migration('cloudflare/slice-c/migrations/0002_revision_state.sql'));
  raw.exec(migration('cloudflare/slice-c/migrations/0003_salary_cycle_sources.sql'));
  raw.exec(migration('cloudflare/slice-d/migrations/0004_web_push_notifications.sql'));
  raw.exec(migration(V3));
}

function applyAcceptedUpgrade(raw) {
  raw.exec(migration('cloudflare/slice-d/migrations/0004_web_push_notifications.sql'));
  raw.exec(migration(V3));
}

function legacyState(raw) {
  return {
    ledger: raw.prepare('SELECT * FROM ledger_movements ORDER BY ledger_id').all(),
    weekly: raw.prepare('SELECT * FROM weekly_snapshots ORDER BY household_id,week_start').all(),
    balances: raw.prepare('SELECT * FROM balance_history ORDER BY balance_row_id').all(),
    config: raw.prepare('SELECT * FROM configuration ORDER BY household_id,config_key').all(),
  };
}

function expectSqliteFailure(fn, pattern) {
  assert.throws(fn, error => pattern.test(String(error?.message || error)));
}

test('V3-1 migration succeeds on a fresh database and is safely rerunnable', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON;');
  applyFreshMigrations(raw);
  raw.exec(migration(V3));
  const expected = [
    'cycle_plans','cycle_plan_events','cycle_commitments','commitment_events',
    'goal_withdrawal_classifications','weekly_snapshot_model_versions'
  ];
  for (const table of expected) {
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n, 1);
  }
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
});

test('accepted-v2-shaped upgrade is additive, preserves factual rows, and fabricates no classification', async () => {
  const { db, raw } = createSeededSqliteD1();
  const before = legacyState(raw);
  applyAcceptedUpgrade(raw);
  const after = legacyState(raw);
  assert.deepEqual(after, before);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM goal_withdrawal_classifications').get().n, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM cycle_plans').get().n, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM cycle_commitments').get().n, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM weekly_snapshot_model_versions').get().n, 0);
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(await assertV3MigrationDataSafe(db), { ok: true, unclassifiedGoalWithdrawals: 0 });
});

test('unexpected historical Goal withdrawal fails with the explicit migration-data exception', () => {
  const { raw } = createSeededSqliteD1();
  raw.prepare("INSERT INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES('family','Legacy Goal',100000,99,'active',NULL)").run();
  raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-10',999,'Legacy Goal','Withdrawal',5000,'Ledger',999)").run();
  raw.exec(migration('cloudflare/slice-d/migrations/0004_web_push_notifications.sql'));
  expectSqliteFailure(() => raw.exec(migration(V3)), /V3_MIGRATION_DATA_EXCEPTION_UNCLASSIFIED_GOAL_WITHDRAWAL/);
});

test('plan, commitment, event and classification constraints enforce V3-1 cardinality and integrity', () => {
  const { raw } = createSeededSqliteD1();
  applyAcceptedUpgrade(raw);
  raw.prepare("INSERT INTO cycle_plans(household_id,cycle_start,variables_target_satang,created_at,updated_at) VALUES('family','2026-08-31',NULL,'2026-08-31T00:00:00Z','2026-08-31T00:00:00Z')").run();
  expectSqliteFailure(() => raw.prepare("INSERT INTO cycle_plans(household_id,cycle_start,variables_target_satang,created_at,updated_at) VALUES('family','2026-08-31',0,'x','x')").run(), /UNIQUE|constraint/i);
  expectSqliteFailure(() => raw.prepare("INSERT INTO cycle_plans(household_id,cycle_start,variables_target_satang,created_at,updated_at) VALUES('family','2026-09-30',-1,'x','x')").run(), /CHECK|constraint/i);

  raw.prepare("INSERT INTO cycle_commitments(commitment_id,household_id,cycle_start,commitment_type,destination_name,committed_amount_satang,lifecycle_status,created_at,updated_at) VALUES('ef1','family','2026-08-31','ef_cycle',NULL,1500000,'active','x','x')").run();
  expectSqliteFailure(() => raw.prepare("INSERT INTO cycle_commitments(commitment_id,household_id,cycle_start,commitment_type,destination_name,committed_amount_satang,lifecycle_status,created_at,updated_at) VALUES('ef2','family','2026-08-31','ef_cycle',NULL,1,'active','x','x')").run(), /UNIQUE|constraint/i);
  raw.prepare("INSERT OR IGNORE INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES('family','Test Goal',2500000,98,'active',NULL)").run();
  raw.prepare("INSERT INTO cycle_commitments(commitment_id,household_id,cycle_start,commitment_type,destination_name,committed_amount_satang,lifecycle_status,created_at,updated_at) VALUES('g1','family','2026-08-31','goal_cycle','Test Goal',500000,'active','x','x')").run();
  expectSqliteFailure(() => raw.prepare("INSERT INTO cycle_commitments(commitment_id,household_id,cycle_start,commitment_type,destination_name,committed_amount_satang,lifecycle_status,created_at,updated_at) VALUES('g2','family','2026-08-31','goal_cycle','Test Goal',1,'active','x','x')").run(), /UNIQUE|constraint/i);
  expectSqliteFailure(() => raw.prepare("INSERT INTO cycle_commitments(commitment_id,household_id,cycle_start,commitment_type,destination_name,committed_amount_satang,lifecycle_status,created_at,updated_at) VALUES('bad','family','2026-08-31','goal_cycle','',1,'active','x','x')").run(), /CHECK|constraint/i);

  raw.prepare("INSERT INTO cycle_plan_events(event_id,household_id,cycle_start,old_target_satang,new_target_satang,actor_email,created_at,base_revision,write_token) VALUES('pe1','family','2026-08-31',NULL,2200000,'a@example.com','x',0,'w1')").run();
  expectSqliteFailure(() => raw.prepare("UPDATE cycle_plan_events SET new_target_satang=1 WHERE event_id='pe1'").run(), /append-only/);
  raw.prepare("INSERT INTO commitment_events(event_id,household_id,commitment_id,event_type,old_amount_satang,new_amount_satang,actor_email,created_at,base_revision,write_token) VALUES('ce1','family','ef1','create',NULL,1500000,'a@example.com','x',0,'w2')").run();
  expectSqliteFailure(() => raw.prepare("DELETE FROM commitment_events WHERE event_id='ce1'").run(), /append-only/);

  const ledgerId = Number(raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-20',1000,'Test Goal','Withdrawal',2500,'Ledger',1000)").run().lastInsertRowid);
  raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,?,?,?,?,?,?,?)").run(ledgerId,'family','Test Goal','goal_purpose','a@example.com','x',0,'w3');
  expectSqliteFailure(() => raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,?,?,?,?,?,?,?)").run(ledgerId,'family','Test Goal','non_purpose','a@example.com','x',0,'w4'), /UNIQUE|constraint/i);
  const ledgerId2 = Number(raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-20',1001,'Test Goal','Contribution',2500,'Ledger',1001)").run().lastInsertRowid);
  expectSqliteFailure(() => raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,?,?,?,?,?,?,?)").run(ledgerId2,'family','Test Goal','goal_purpose','a@example.com','x',0,'w5'), /positive factual Goal withdrawal/);
  expectSqliteFailure(() => raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,?,?,?,?,?,?,?)").run(999999,'family','Test Goal','wrong','a@example.com','x',0,'w6'), /CHECK|constraint/i);
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
});

test('weekly v3 version relation leaves legacy snapshots unchanged and marks only future v3 rows', () => {
  const { raw } = createSeededSqliteD1();
  const before = raw.prepare('SELECT * FROM weekly_snapshots ORDER BY week_start').all();
  applyAcceptedUpgrade(raw);
  const after = raw.prepare('SELECT * FROM weekly_snapshots ORDER BY week_start').all();
  assert.deepEqual(after, before);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM weekly_snapshot_model_versions').get().n, 0);
  raw.prepare("INSERT INTO weekly_snapshots(household_id,week_start,week_end,status) VALUES('family','2099-01-01','2099-01-07','closed')").run();
  raw.prepare("INSERT INTO weekly_snapshot_model_versions(household_id,week_start,planning_model_version,created_at) VALUES('family','2099-01-01','v3','2099-01-08T00:00:00Z')").run();
  assert.equal(raw.prepare("SELECT planning_model_version FROM weekly_snapshot_model_versions WHERE week_start='2099-01-01'").get().planning_model_version, 'v3');
  expectSqliteFailure(() => raw.prepare("INSERT INTO weekly_snapshot_model_versions(household_id,week_start,planning_model_version,created_at) VALUES('family','2099-01-02','v3','x')").run(), /FOREIGN KEY|constraint/i);
});

test('new snapshot collections are additive and legacy read fields remain unchanged before v3 initialization', async () => {
  const { db, raw } = createSeededSqliteD1();
  const expected = legacyState(raw);
  applyAcceptedUpgrade(raw);
  const snapshot = await loadFinancialSnapshot(db);
  assert.deepEqual(snapshot.balanceHistory, expected.balances);
  assert.deepEqual(snapshot.ledger, expected.ledger);
  assert.deepEqual(snapshot.weeklySnapshots, expected.weekly);
  assert.deepEqual(snapshot.cyclePlans, []);
  assert.deepEqual(snapshot.cyclePlanEvents, []);
  assert.deepEqual(snapshot.cycleCommitments, []);
  assert.deepEqual(snapshot.commitmentEvents, []);
  assert.deepEqual(snapshot.goalWithdrawalClassifications, []);
  assert.deepEqual(snapshot.weeklySnapshotModelVersions, []);
});
