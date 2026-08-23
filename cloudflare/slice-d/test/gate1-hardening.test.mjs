import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { findAuthoritativeGoalPurposeWithdrawals, findUnclassifiedGoalWithdrawals } from '../../slice-b/src/d1-repository.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V3 = fs.readFileSync(path.resolve(here, '../migrations/0005_v3_persistence.sql'), 'utf8');

function fail(fn, pattern = /constraint|immutable|append-only|integer-satang|authoritative-effect/i) {
  assert.throws(fn, error => pattern.test(String(error?.message || error)));
}

function addGoal(raw, name, rank = 90) {
  raw.prepare("INSERT OR IGNORE INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES('family',?,5000000,?,'active',NULL)").run(name, rank);
}

let sourceRow = 50000;
function addLedger(raw, { account, direction = 'Withdrawal', amount = 1000, sourceSheet = 'Ledger', businessDate = '2026-08-20' }) {
  sourceRow += 1;
  return Number(raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family',?,?,?,?,?,?,?)")
    .run(businessDate, sourceRow, account, direction, amount, sourceSheet, sourceRow).lastInsertRowid);
}

function classify(raw, ledgerId, goalName, use = 'goal_purpose', token = `class-${ledgerId}`) {
  raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,?, 'owner@example.com','2026-08-20T00:00:00Z',0,?)")
    .run(ledgerId, goalName, use, token);
}

function recordEffect(raw, { superseded, authoritative = null, kind, correctionId, token }) {
  raw.exec('BEGIN IMMEDIATE');
  try {
    raw.prepare("INSERT INTO goal_withdrawal_effect_events(effect_event_id,household_id,superseded_ledger_id,authoritative_ledger_id,correction_id,effect_kind,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,?,?,?,'owner@example.com','2026-08-20T00:00:00Z',0,?)")
      .run(`effect-${correctionId}`, superseded, authoritative, correctionId, kind, token);
    raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES(?,'family','ledger_movement',?,'{}',?,'Gate 1 lifecycle test','owner@example.com','2026-08-20T00:00:00Z',0,?)")
      .run(correctionId, String(superseded), JSON.stringify({ authoritativeLedgerId: authoritative }), token);
    raw.exec('COMMIT');
  } catch (error) {
    try { raw.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

test('B001 true integer-satang checks reject fractional storage in every Gate-1 monetary column', () => {
  const { raw } = createSeededSqliteD1();
  fail(() => raw.prepare("INSERT INTO cycle_plans(household_id,cycle_start,variables_target_satang,created_at,updated_at) VALUES('family','2090-01-01',1.5,'x','x')").run(), /CHECK|constraint/i);
  raw.prepare("INSERT INTO cycle_plans(household_id,cycle_start,variables_target_satang,created_at,updated_at) VALUES('family','2090-01-01',NULL,'x','x')").run();
  raw.prepare("UPDATE cycle_plans SET variables_target_satang=2200000 WHERE household_id='family' AND cycle_start='2090-01-01'").run();

  fail(() => raw.prepare("INSERT INTO cycle_plan_events(event_id,household_id,cycle_start,old_target_satang,new_target_satang,actor_email,created_at,base_revision,write_token) VALUES('p1','family','2090-01-01',1.5,2200000,'a','x',0,'p1')").run(), /CHECK|constraint/i);
  fail(() => raw.prepare("INSERT INTO cycle_plan_events(event_id,household_id,cycle_start,old_target_satang,new_target_satang,actor_email,created_at,base_revision,write_token) VALUES('p2','family','2090-01-01',NULL,1.5,'a','x',0,'p2')").run(), /CHECK|constraint/i);
  raw.prepare("INSERT INTO cycle_plan_events(event_id,household_id,cycle_start,old_target_satang,new_target_satang,actor_email,created_at,base_revision,write_token) VALUES('p3','family','2090-01-01',NULL,2200000,'a','x',0,'p3')").run();

  fail(() => raw.prepare("INSERT INTO cycle_commitments(commitment_id,household_id,cycle_start,commitment_type,destination_name,committed_amount_satang,lifecycle_status,created_at,updated_at) VALUES('frac','family','2090-01-01','ef_cycle',NULL,1.5,'active','x','x')").run(), /CHECK|constraint/i);
  raw.prepare("INSERT INTO cycle_commitments(commitment_id,household_id,cycle_start,commitment_type,destination_name,committed_amount_satang,lifecycle_status,created_at,updated_at) VALUES('ef-int','family','2090-01-01','ef_cycle',NULL,1500000,'active','x','x')").run();
  fail(() => raw.prepare("INSERT INTO commitment_events(event_id,household_id,commitment_id,event_type,old_amount_satang,new_amount_satang,actor_email,created_at,base_revision,write_token) VALUES('c1','family','ef-int','edit',1.5,1500000,'a','x',0,'c1')").run(), /CHECK|constraint/i);
  fail(() => raw.prepare("INSERT INTO commitment_events(event_id,household_id,commitment_id,event_type,old_amount_satang,new_amount_satang,actor_email,created_at,base_revision,write_token) VALUES('c2','family','ef-int','edit',NULL,1.5,'a','x',0,'c2')").run(), /CHECK|constraint/i);
  raw.prepare("INSERT INTO commitment_events(event_id,household_id,commitment_id,event_type,old_amount_satang,new_amount_satang,actor_email,created_at,base_revision,write_token) VALUES('c3','family','ef-int','edit',NULL,1500000,'a','x',0,'c3')").run();

  addGoal(raw, 'Integer Goal');
  const fractional = addLedger(raw, { account: 'Integer Goal', amount: 1.5, sourceSheet: 'Correction' });
  fail(() => classify(raw, fractional, 'Integer Goal'), /positive integer-satang/i);
  const integer = addLedger(raw, { account: 'Integer Goal', amount: 1, sourceSheet: 'Correction' });
  classify(raw, integer, 'Integer Goal');
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
});

test('B002 classifications and protected factual Ledger semantics are immutable', () => {
  const { raw } = createSeededSqliteD1();
  addGoal(raw, 'Goal A', 91); addGoal(raw, 'Goal B', 92);
  const id = addLedger(raw, { account: 'Goal A', amount: 1000, sourceSheet: 'Correction' });
  classify(raw, id, 'Goal A');
  fail(() => raw.prepare("UPDATE goal_withdrawal_classifications SET goal_name='Goal B' WHERE ledger_id=?").run(id), /immutable/i);
  fail(() => raw.prepare('DELETE FROM goal_withdrawal_classifications WHERE ledger_id=?').run(id), /immutable/i);
  fail(() => raw.prepare("UPDATE ledger_movements SET direction='Contribution' WHERE ledger_id=?").run(id), /immutable|additive correction/i);
  fail(() => raw.prepare("UPDATE ledger_movements SET amount_satang=999 WHERE ledger_id=?").run(id), /immutable|additive correction/i);
  fail(() => raw.prepare('DELETE FROM ledger_movements WHERE ledger_id=?').run(id), /immutable|additive correction/i);
  fail(() => raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES('missing-effect','family','ledger_movement',?,'{}','{}','x','a','x',0,'missing-effect')").run(String(id)), /authoritative-effect/i);
});

test('B002 authoritative purpose reconstruction excludes superseded rows and handles partial, chained, purpose-changing and reversal effects', async () => {
  const { db, raw } = createSeededSqliteD1();
  addGoal(raw, 'Lifecycle Goal', 93);
  const original = addLedger(raw, { account: 'Lifecycle Goal', amount: 5000, sourceSheet: 'Correction' });
  classify(raw, original, 'Lifecycle Goal', 'goal_purpose', 'class-original');
  assert.deepEqual((await findAuthoritativeGoalPurposeWithdrawals(db)).map(x => Number(x.amount_satang)), [5000]);

  const partial = addLedger(raw, { account: 'Lifecycle Goal', amount: 3000, sourceSheet: 'Correction' });
  classify(raw, partial, 'Lifecycle Goal', 'goal_purpose', 'class-partial');
  recordEffect(raw, { superseded: original, authoritative: partial, kind: 'replacement', correctionId: 'corr-partial', token: 'effect-token-1' });
  let rows = await findAuthoritativeGoalPurposeWithdrawals(db);
  assert.deepEqual(rows.filter(x => x.goal_name === 'Lifecycle Goal').map(x => [Number(x.ledger_id),Number(x.amount_satang)]), [[partial,3000]]);

  const nonPurpose = addLedger(raw, { account: 'Lifecycle Goal', amount: 2000, sourceSheet: 'Correction' });
  classify(raw, nonPurpose, 'Lifecycle Goal', 'non_purpose', 'class-non-purpose');
  recordEffect(raw, { superseded: partial, authoritative: nonPurpose, kind: 'replacement', correctionId: 'corr-purpose-change', token: 'effect-token-2' });
  rows = await findAuthoritativeGoalPurposeWithdrawals(db);
  assert.equal(rows.some(x => x.goal_name === 'Lifecycle Goal'), false);

  addGoal(raw, 'Chain Goal', 94);
  const chain1 = addLedger(raw, { account: 'Chain Goal', amount: 4000, sourceSheet: 'Correction' });
  classify(raw, chain1, 'Chain Goal', 'goal_purpose', 'class-chain1');
  const chain2 = addLedger(raw, { account: 'Chain Goal', amount: 3500, sourceSheet: 'Correction' });
  classify(raw, chain2, 'Chain Goal', 'goal_purpose', 'class-chain2');
  recordEffect(raw, { superseded: chain1, authoritative: chain2, kind: 'replacement', correctionId: 'corr-chain1', token: 'effect-token-3' });
  const chain3 = addLedger(raw, { account: 'Chain Goal', amount: 3200, sourceSheet: 'Correction' });
  classify(raw, chain3, 'Chain Goal', 'goal_purpose', 'class-chain3');
  recordEffect(raw, { superseded: chain2, authoritative: chain3, kind: 'replacement', correctionId: 'corr-chain2', token: 'effect-token-4' });
  rows = await findAuthoritativeGoalPurposeWithdrawals(db);
  assert.deepEqual(rows.filter(x => x.goal_name === 'Chain Goal').map(x => [Number(x.ledger_id),Number(x.amount_satang)]), [[chain3,3200]]);

  addGoal(raw, 'Reverse Goal', 95);
  const reverse = addLedger(raw, { account: 'Reverse Goal', amount: 2500, sourceSheet: 'Correction' });
  classify(raw, reverse, 'Reverse Goal', 'goal_purpose', 'class-reverse');
  recordEffect(raw, { superseded: reverse, authoritative: null, kind: 'reversal', correctionId: 'corr-reverse', token: 'effect-token-5' });
  rows = await findAuthoritativeGoalPurposeWithdrawals(db);
  assert.equal(rows.some(x => x.goal_name === 'Reverse Goal'), false);
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
});

test('B002 replacement Goal withdrawal requires its own classification and same-token re-forward cannot double-count', () => {
  const { raw } = createSeededSqliteD1();
  addGoal(raw, 'Atomic Goal', 96);
  const original = addLedger(raw, { account: 'Atomic Goal', amount: 5000, sourceSheet: 'Correction' });
  classify(raw, original, 'Atomic Goal', 'goal_purpose', 'atomic-original');
  const replacement = addLedger(raw, { account: 'Atomic Goal', amount: 4500, sourceSheet: 'Correction' });

  raw.exec('BEGIN IMMEDIATE');
  try {
    fail(() => raw.prepare("INSERT INTO goal_withdrawal_effect_events(effect_event_id,household_id,superseded_ledger_id,authoritative_ledger_id,correction_id,effect_kind,actor_email,created_at,base_revision,write_token) VALUES('bad-effect','family',?,?,'bad-corr','replacement','a','x',0,'bad-token')").run(original,replacement), /compatible replacement classification/i);
  } finally { raw.exec('ROLLBACK'); }

  classify(raw, replacement, 'Atomic Goal', 'goal_purpose', 'atomic-replacement');
  recordEffect(raw, { superseded: original, authoritative: replacement, kind: 'replacement', correctionId: 'atomic-corr', token: 'same-token' });
  const other = addLedger(raw, { account: 'Atomic Goal', amount: 4400, sourceSheet: 'Correction' });
  classify(raw, other, 'Atomic Goal', 'goal_purpose', 'atomic-other');
  fail(() => recordEffect(raw, { superseded: replacement, authoritative: other, kind: 'replacement', correctionId: 'atomic-corr-2', token: 'same-token' }), /UNIQUE|constraint/i);
});

test('B002 rollback followed by re-forward reconstructs one authoritative replacement', async () => {
  const { db, raw } = createSeededSqliteD1();
  addGoal(raw, 'Rollback Goal', 97);
  const original = addLedger(raw, { account: 'Rollback Goal', amount: 6000, sourceSheet: 'Correction' });
  classify(raw, original, 'Rollback Goal', 'goal_purpose', 'rollback-original');

  raw.exec('BEGIN IMMEDIATE');
  const replacement = addLedger(raw, { account: 'Rollback Goal', amount: 5500, sourceSheet: 'Correction' });
  classify(raw, replacement, 'Rollback Goal', 'goal_purpose', 'rollback-replacement');
  raw.prepare("INSERT INTO goal_withdrawal_effect_events(effect_event_id,household_id,superseded_ledger_id,authoritative_ledger_id,correction_id,effect_kind,actor_email,created_at,base_revision,write_token) VALUES('rollback-effect','family',?,?,'rollback-corr','replacement','a','x',0,'rollback-token')").run(original,replacement);
  raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES('rollback-corr','family','ledger_movement',?,'{}','{}','x','a','x',0,'rollback-token')").run(String(original));
  raw.exec('ROLLBACK');
  assert.deepEqual((await findAuthoritativeGoalPurposeWithdrawals(db)).filter(x => x.goal_name === 'Rollback Goal').map(x => Number(x.amount_satang)), [6000]);

  const replacement2 = addLedger(raw, { account: 'Rollback Goal', amount: 5500, sourceSheet: 'Correction' });
  classify(raw, replacement2, 'Rollback Goal', 'goal_purpose', 'rollback-replacement-2');
  recordEffect(raw, { superseded: original, authoritative: replacement2, kind: 'replacement', correctionId: 'rollback-corr', token: 'rollback-token' });
  assert.deepEqual((await findAuthoritativeGoalPurposeWithdrawals(db)).filter(x => x.goal_name === 'Rollback Goal').map(x => Number(x.amount_satang)), [5500]);
});

test('B003 SQL and repository preflight cover current and former/orphan Goal accounts but exclude EF and non-Goal rows', async () => {
  const { db, raw } = createSeededSqliteD1();
  addGoal(raw, 'Current Preflight Goal', 98);
  const current = addLedger(raw, { account: 'Current Preflight Goal', amount: 1000, sourceSheet: 'Correction' });
  const orphan = addLedger(raw, { account: 'Former Goal With No Current Row', amount: 2000, sourceSheet: 'Ledger' });
  addLedger(raw, { account: 'EF', amount: 3000, sourceSheet: 'Ledger' });
  addLedger(raw, { account: 'Not A Goal', amount: 4000, sourceSheet: 'Other' });
  const helper = await findUnclassifiedGoalWithdrawals(db);
  assert.deepEqual(helper.map(x => Number(x.ledger_id)), [current, orphan]);
  fail(() => raw.exec(V3), /V3_MIGRATION_DATA_EXCEPTION_UNCLASSIFIED_GOAL_WITHDRAWAL/);
});

test('B003 fresh migration rejects a former/orphan imported Goal withdrawal without fabricating classification', () => {
  const { raw } = createSeededSqliteD1({ includeV3: false });
  addLedger(raw, { account: 'Former Orphan Goal', amount: 5000, sourceSheet: 'Ledger' });
  fail(() => raw.exec(V3), /V3_MIGRATION_DATA_EXCEPTION_UNCLASSIFIED_GOAL_WITHDRAWAL/);
  if (raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='goal_withdrawal_classifications'").get().n) {
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM goal_withdrawal_classifications').get().n, 0);
  }
});
