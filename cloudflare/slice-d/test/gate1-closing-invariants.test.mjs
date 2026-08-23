import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { findAuthoritativeGoalPurposeWithdrawals } from '../../slice-b/src/d1-repository.mjs';
import { BACKUP_TABLES, buildPortableBackup, verifyPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

let sourceRow = 120000;

function addGoal(raw, name) {
  raw.prepare("INSERT OR IGNORE INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES('family',?,5000000,995,'active',NULL)").run(name);
}

function addLedger(raw, account, amount = 5000) {
  sourceRow += 1;
  return Number(raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-23',?,?, 'Withdrawal',?,'Correction',?)")
    .run(sourceRow, account, amount, sourceRow).lastInsertRowid);
}

function classify(raw, ledgerId, goalName, useClassification = 'goal_purpose') {
  raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,?,'owner@example.com','2026-08-23T00:00:00Z',0,?)")
    .run(ledgerId, goalName, useClassification, `class-${ledgerId}`);
}

function addEffect(raw, {
  supersededLedgerId,
  authoritativeLedgerId = null,
  correctionId,
  token,
}) {
  const kind = authoritativeLedgerId === null ? 'reversal' : 'replacement';
  raw.prepare("INSERT INTO goal_withdrawal_effect_events(effect_event_id,household_id,superseded_ledger_id,authoritative_ledger_id,correction_id,effect_kind,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,?,?,?, 'owner@example.com','2026-08-23T00:00:00Z',0,?)")
    .run(`effect-${correctionId}`, supersededLedgerId, authoritativeLedgerId, correctionId, kind, token);
}

function addAudit(raw, { correctionId, entityId, token, entityType = 'ledger_movement' }) {
  raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES(?,'family',?,?, '{}','{}','Gate 1 closing invariant test','owner@example.com','2026-08-23T00:00:00Z',0,?)")
    .run(correctionId, entityType, String(entityId), token);
}

function commitEffect(raw, options) {
  raw.exec('BEGIN IMMEDIATE');
  try {
    addEffect(raw, options);
    addAudit(raw, {
      correctionId: options.correctionId,
      entityId: options.supersededLedgerId,
      token: options.token,
    });
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
}

function chainFixture(count = 3, goalName = 'Closing Invariant Goal') {
  const { db, raw } = createSeededSqliteD1();
  addGoal(raw, goalName);
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = addLedger(raw, goalName, 5000 + index);
    classify(raw, id, goalName);
    ids.push(id);
  }
  return { db, raw, ids, goalName };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resignGate1Backup(backup) {
  backup.integrity.schemaObjectCount = backup.schema.length;
  backup.integrity.rowCounts = Object.fromEntries(BACKUP_TABLES.map(table => [table, backup.tables[table].length]));
  backup.integrity.tablesSha256 = sha256(JSON.stringify(backup.tables));
  backup.integrity.payloadSha256 = sha256(JSON.stringify({
    schemaManifestVersion: backup.schemaManifestVersion,
    schema: backup.schema,
    tables: backup.tables,
  }));
  return backup;
}

async function replacementBackupFixture() {
  const { db, raw, ids } = chainFixture(2, 'Closing Backup Goal');
  const [a, b] = ids;
  commitEffect(raw, {
    supersededLedgerId: a,
    authoritativeLedgerId: b,
    correctionId: 'closing-backup-a-b',
    token: 'closing-backup-token-a-b',
  });
  const { backup } = await buildPortableBackup(db, {
    environment: 'staging',
    createdAt: '2026-08-23T12:00:00Z',
  });
  assert.equal(await verifyPortableBackup(backup), true);
  return { backup, a, b };
}

test('B002 effect-bound correction audit is lifetime immutable after commit', () => {
  const { raw, ids } = chainFixture(1);
  const [a] = ids;
  commitEffect(raw, {
    supersededLedgerId: a,
    authoritativeLedgerId: null,
    correctionId: 'immutable-audit',
    token: 'immutable-audit-token',
  });

  raw.prepare("INSERT INTO households(household_id,name,currency,timezone) VALUES('other','Other','THB','Asia/Bangkok')").run();
  const mutations = [
    ["entity_id='999999'", 'entity_id'],
    ["entity_type='balance_history'", 'entity_type'],
    ["write_token='different-token'", 'write_token'],
    ["household_id='other'", 'household_id'],
    ["reason='rewritten evidence'", 'reason'],
  ];
  for (const [assignment, label] of mutations) {
    assert.throws(
      () => raw.prepare(`UPDATE correction_audit SET ${assignment} WHERE correction_id='immutable-audit'`).run(),
      /correction audits are immutable/i,
      `${label} mutation must be rejected`,
    );
  }
  assert.throws(
    () => raw.prepare("DELETE FROM correction_audit WHERE correction_id='immutable-audit'").run(),
    /correction audits are immutable/i,
  );
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
});

test('B002 unrelated correction audit remains outside the Goal-effect immutability guard', () => {
  const { raw } = createSeededSqliteD1();
  raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES('ordinary-audit','family','balance_history','1','{}','{}','old','owner@example.com','2026-08-23T00:00:00Z',0,'ordinary-token')").run();
  raw.prepare("UPDATE correction_audit SET reason='new' WHERE correction_id='ordinary-audit'").run();
  assert.equal(raw.prepare("SELECT reason FROM correction_audit WHERE correction_id='ordinary-audit'").get().reason, 'new');
});

test('B002 rejects two-node correction cycle A→B→A', () => {
  const { raw, ids } = chainFixture(2);
  const [a, b] = ids;
  commitEffect(raw, {
    supersededLedgerId: a,
    authoritativeLedgerId: b,
    correctionId: 'cycle-a-b',
    token: 'cycle-token-a-b',
  });

  raw.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(
      () => addEffect(raw, {
        supersededLedgerId: b,
        authoritativeLedgerId: a,
        correctionId: 'cycle-b-a',
        token: 'cycle-token-b-a',
      }),
      /graph must remain acyclic/i,
    );
  } finally {
    raw.exec('ROLLBACK');
  }
});

test('B002 rejects longer correction back-edge A→B→C→A', () => {
  const { raw, ids } = chainFixture(3);
  const [a, b, c] = ids;
  commitEffect(raw, {
    supersededLedgerId: a,
    authoritativeLedgerId: b,
    correctionId: 'long-a-b',
    token: 'long-token-a-b',
  });
  commitEffect(raw, {
    supersededLedgerId: b,
    authoritativeLedgerId: c,
    correctionId: 'long-b-c',
    token: 'long-token-b-c',
  });

  raw.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(
      () => addEffect(raw, {
        supersededLedgerId: c,
        authoritativeLedgerId: a,
        correctionId: 'long-c-a',
        token: 'long-token-c-a',
      }),
      /graph must remain acyclic/i,
    );
  } finally {
    raw.exec('ROLLBACK');
  }
});

test('B002 ordinary A→B→C chain has exactly one authoritative purpose member', async () => {
  const { db, raw, ids } = chainFixture(3);
  const [a, b, c] = ids;
  commitEffect(raw, {
    supersededLedgerId: a,
    authoritativeLedgerId: b,
    correctionId: 'valid-a-b',
    token: 'valid-token-a-b',
  });
  commitEffect(raw, {
    supersededLedgerId: b,
    authoritativeLedgerId: c,
    correctionId: 'valid-b-c',
    token: 'valid-token-b-c',
  });
  const authoritative = await findAuthoritativeGoalPurposeWithdrawals(db, 'family');
  const idsFound = authoritative.map(row => row.ledger_id);
  assert.equal(idsFound.includes(a), false);
  assert.equal(idsFound.includes(b), false);
  assert.equal(idsFound.includes(c), true);
  assert.equal(idsFound.filter(id => [a,b,c].includes(id)).length, 1);
});

test('B004 verifier rejects a recomputed-hash hostile cycle graph', async () => {
  const { backup, a, b } = await replacementBackupFixture();
  const hostile = structuredClone(backup);
  hostile.tables.correction_audit.push({
    correction_id:'hostile-cycle-b-a', household_id:'family', entity_type:'ledger_movement', entity_id:String(b),
    before_json:'{}', after_json:'{}', reason:'hostile cycle', actor_email:'owner@example.com',
    corrected_at:'2026-08-23T12:01:00Z', base_revision:0, write_token:'hostile-cycle-token',
  });
  hostile.tables.goal_withdrawal_effect_events.push({
    effect_event_id:'hostile-cycle-effect', household_id:'family', superseded_ledger_id:b,
    authoritative_ledger_id:a, correction_id:'hostile-cycle-b-a', effect_kind:'replacement',
    actor_email:'owner@example.com', created_at:'2026-08-23T12:01:00Z', base_revision:0,
    write_token:'hostile-cycle-token',
  });
  resignGate1Backup(hostile);
  assert.equal(await verifyPortableBackup(hostile), false);
});

test('B004 verifier rejects coercive numeric-string and decimal/exponent identities', async () => {
  const { backup, a } = await replacementBackupFixture();
  for (const malformed of [String(a), `${a}.0`, `${a}e0`, `0${a}`]) {
    const hostile = structuredClone(backup);
    const effect = hostile.tables.goal_withdrawal_effect_events.find(row => row.superseded_ledger_id === a);
    effect.superseded_ledger_id = malformed;
    resignGate1Backup(hostile);
    assert.equal(await verifyPortableBackup(hostile), false, `${malformed} must not coerce to Ledger identity`);
  }
});

test('B004 verifier rejects unsafe JavaScript integer identities rather than aliasing them', async () => {
  const { backup, a } = await replacementBackupFixture();
  const hostile = structuredClone(backup);
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  const movement = hostile.tables.ledger_movements.find(row => row.ledger_id === a);
  const classification = hostile.tables.goal_withdrawal_classifications.find(row => row.ledger_id === a);
  const effect = hostile.tables.goal_withdrawal_effect_events.find(row => row.superseded_ledger_id === a);
  const audit = hostile.tables.correction_audit.find(row => row.correction_id === effect.correction_id);
  movement.ledger_id = unsafe;
  classification.ledger_id = unsafe;
  effect.superseded_ledger_id = unsafe;
  audit.entity_id = String(unsafe);
  resignGate1Backup(hostile);
  assert.equal(await verifyPortableBackup(hostile), false);
});

test('B004 verifier rejects stringified satang even when numerically coercible', async () => {
  const { backup, a } = await replacementBackupFixture();
  const hostile = structuredClone(backup);
  hostile.tables.ledger_movements.find(row => row.ledger_id === a).amount_satang = '5000';
  resignGate1Backup(hostile);
  assert.equal(await verifyPortableBackup(hostile), false);
});

test('B004 gate1-v1 schema is an exact allowlist: extra trigger is rejected and cannot restore', async () => {
  const { backup } = await replacementBackupFixture();
  const hostile = structuredClone(backup);
  hostile.schema.push({
    type:'trigger', name:'hostile_extra_trigger', tbl_name:'ledger_movements',
    sql:"CREATE TRIGGER hostile_extra_trigger BEFORE INSERT ON ledger_movements BEGIN SELECT RAISE(ABORT, 'hostile'); END",
  });
  resignGate1Backup(hostile);
  assert.equal(await verifyPortableBackup(hostile), false);
  await assert.rejects(() => buildRestoreSql(hostile, { includeSchema:true }), /integrity verification failed/i);
});

test('B004 gate1-v1 schema is an exact allowlist: extra index is rejected', async () => {
  const { backup } = await replacementBackupFixture();
  const hostile = structuredClone(backup);
  hostile.schema.push({
    type:'index', name:'hostile_extra_index', tbl_name:'ledger_movements',
    sql:'CREATE INDEX hostile_extra_index ON ledger_movements(entity_type)',
  });
  resignGate1Backup(hostile);
  assert.equal(await verifyPortableBackup(hostile), false);
});
