import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { findAuthoritativeGoalPurposeWithdrawals } from '../../slice-b/src/d1-repository.mjs';
import { BACKUP_TABLES, buildPortableBackup, verifyPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

let sourceRow = 91000;

function addGoal(raw, name) {
  raw.prepare("INSERT OR IGNORE INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES('family',?,5000000,990,'active',NULL)").run(name);
}

function addLedger(raw, account, amount = 5000) {
  sourceRow += 1;
  return Number(raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-23',?,?, 'Withdrawal',?,'Correction',?)")
    .run(sourceRow, account, amount, sourceRow).lastInsertRowid);
}

function classify(raw, ledgerId, goalName) {
  raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,'goal_purpose','owner@example.com','2026-08-23T00:00:00Z',0,?)")
    .run(ledgerId, goalName, `class-${ledgerId}`);
}

function addEffect(raw, {
  ledgerId,
  authoritativeLedgerId = null,
  correctionId = 'corr-binding',
  token = 'token-binding',
}) {
  const kind = authoritativeLedgerId === null ? 'reversal' : 'replacement';
  raw.prepare("INSERT INTO goal_withdrawal_effect_events(effect_event_id,household_id,superseded_ledger_id,authoritative_ledger_id,correction_id,effect_kind,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,?,?,?,'owner@example.com','2026-08-23T00:00:00Z',0,?)")
    .run(`effect-${correctionId}`, ledgerId, authoritativeLedgerId, correctionId, kind, token);
}

function addAudit(raw, { correctionId = 'corr-binding', entityType = 'ledger_movement', entityId, token = 'token-binding' }) {
  raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES(?,'family',?,?, '{}','{}','Gate 1 binding test','owner@example.com','2026-08-23T00:00:00Z',0,?)")
    .run(correctionId, entityType, String(entityId), token);
}

function fixture(name = 'Binding Goal') {
  const { db, raw } = createSeededSqliteD1();
  addGoal(raw, name);
  const ledgerId = addLedger(raw, name);
  classify(raw, ledgerId, name);
  return { db, raw, ledgerId };
}

function chainFixture(count = 3, name = 'Binding Chain Goal') {
  const { db, raw } = createSeededSqliteD1();
  addGoal(raw, name);
  const ledgerIds = [];
  for (let index = 0; index < count; index += 1) {
    const ledgerId = addLedger(raw, name, 5000 + index);
    classify(raw, ledgerId, name);
    ledgerIds.push(ledgerId);
  }
  return { db, raw, ledgerIds };
}

function commitEffect(raw, { ledgerId, authoritativeLedgerId = null, correctionId, token }) {
  raw.exec('BEGIN IMMEDIATE');
  try {
    addEffect(raw, { ledgerId, authoritativeLedgerId, correctionId, token });
    addAudit(raw, { correctionId, entityId: ledgerId, token });
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
}

function expectAuditRejected({ entityType = 'ledger_movement', entityIdForLedger = id => id, auditToken = 'token-binding' }) {
  const { raw, ledgerId } = fixture();
  raw.exec('BEGIN IMMEDIATE');
  try {
    addEffect(raw, { ledgerId });
    assert.throws(
      () => addAudit(raw, { entityType, entityId: entityIdForLedger(ledgerId), token: auditToken }),
      /must match household, Ledger entity, correction id, and write token/i,
    );
  } finally {
    raw.exec('ROLLBACK');
  }
}

function expectEffectRejectedAfterAudit(entityIdForLedger) {
  const { raw, ledgerId } = fixture();
  const correctionId = `audit-first-${sourceRow}`;
  const token = `audit-first-token-${sourceRow}`;
  addAudit(raw, { correctionId, entityId: entityIdForLedger(ledgerId), token });
  assert.throws(
    () => addEffect(raw, { ledgerId, correctionId, token }),
    /matching Ledger correction audit/i,
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resignV3Backup(backup) {
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

async function validBackupFixture() {
  const { db, raw, ledgerId } = fixture('Backup Binding Goal');
  raw.exec('BEGIN IMMEDIATE');
  addEffect(raw, { ledgerId, correctionId: 'backup-corr', token: 'backup-token' });
  addAudit(raw, { correctionId: 'backup-corr', entityId: ledgerId, token: 'backup-token' });
  raw.exec('COMMIT');
  const { backup } = await buildPortableBackup(db, {
    environment: 'staging',
    createdAt: '2026-08-23T00:00:00Z',
  });
  assert.equal(await verifyPortableBackup(backup), true);
  return { backup, ledgerId };
}

async function replacementBackupFixture() {
  const { db, raw, ledgerIds } = chainFixture(2, 'Backup Chain Goal');
  const [a, b] = ledgerIds;
  commitEffect(raw, {
    ledgerId: a,
    authoritativeLedgerId: b,
    correctionId: 'backup-chain-a-b',
    token: 'backup-chain-token-a-b',
  });
  const { backup } = await buildPortableBackup(db, {
    environment: 'staging',
    createdAt: '2026-08-23T00:10:00Z',
  });
  assert.equal(await verifyPortableBackup(backup), true);
  return { backup, a, b };
}

test('B002 rejects an effect whose deferred correction id is satisfied by an unrelated correction type', () => {
  expectAuditRejected({ entityType: 'balance_history' });
});

test('B002 rejects an effect whose correction audit targets the wrong Ledger entity id', () => {
  expectAuditRejected({ entityIdForLedger: ledgerId => ledgerId + 1 });
});

test('B002 rejects an effect whose correction audit uses a different write token', () => {
  expectAuditRejected({ auditToken: 'wrong-token' });
});

test('B002 effect-first rejects a coercive Ledger entity id with trailing text', () => {
  expectAuditRejected({ entityIdForLedger: ledgerId => `${ledgerId}junk` });
});

test('B002 effect-first rejects a non-canonical zero-padded Ledger entity id', () => {
  expectAuditRejected({ entityIdForLedger: ledgerId => `0${ledgerId}` });
});

test('B002 rejects an effect inserted after an already-existing unrelated correction audit', () => {
  const { raw, ledgerId } = fixture();
  addAudit(raw, { correctionId: 'audit-first', entityType: 'balance_history', entityId: ledgerId, token: 'audit-first-token' });
  assert.throws(
    () => addEffect(raw, { ledgerId, correctionId: 'audit-first', token: 'audit-first-token' }),
    /matching Ledger correction audit/i,
  );
});

test('B002 audit-first rejects a coercive Ledger entity id with trailing text', () => {
  expectEffectRejectedAfterAudit(ledgerId => `${ledgerId}junk`);
});

test('B002 audit-first rejects a non-canonical zero-padded Ledger entity id', () => {
  expectEffectRejectedAfterAudit(ledgerId => `0${ledgerId}`);
});

test('B002 accepts a correctly bound effect and canonical Ledger correction audit', () => {
  const { raw, ledgerId } = fixture();
  raw.exec('BEGIN IMMEDIATE');
  addEffect(raw, { ledgerId, correctionId: 'valid-corr', token: 'valid-token' });
  addAudit(raw, { correctionId: 'valid-corr', entityId: ledgerId, token: 'valid-token' });
  raw.exec('COMMIT');
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
});

test('B002 effect-bound correction audit is immutable after the valid pair commits', () => {
  const { raw, ledgerId } = fixture('Immutable Audit Goal');
  commitEffect(raw, { ledgerId, correctionId:'immutable-audit', token:'immutable-audit-token' });
  raw.prepare("INSERT INTO households(household_id,name,currency,timezone) VALUES('other','Other','THB','Asia/Bangkok')").run();
  for (const [assignment,label] of [
    ["entity_id='999999'",'entity_id'],
    ["entity_type='balance_history'",'entity_type'],
    ["write_token='different-token'",'write_token'],
    ["household_id='other'",'household_id'],
    ["reason='rewritten evidence'",'reason'],
  ]) {
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

test('B002 unrelated correction audit remains outside the effect-bound immutability guard', () => {
  const { raw } = createSeededSqliteD1();
  raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES('ordinary-audit','family','balance_history','1','{}','{}','old','owner@example.com','2026-08-23T00:00:00Z',0,'ordinary-token')").run();
  raw.prepare("UPDATE correction_audit SET reason='new' WHERE correction_id='ordinary-audit'").run();
  assert.equal(raw.prepare("SELECT reason FROM correction_audit WHERE correction_id='ordinary-audit'").get().reason, 'new');
});

test('B002 rejects two-node correction cycle A→B→A', () => {
  const { raw, ledgerIds } = chainFixture(2);
  const [a,b] = ledgerIds;
  commitEffect(raw, { ledgerId:a, authoritativeLedgerId:b, correctionId:'cycle-a-b', token:'cycle-token-a-b' });
  raw.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(
      () => addEffect(raw, { ledgerId:b, authoritativeLedgerId:a, correctionId:'cycle-b-a', token:'cycle-token-b-a' }),
      /graph must remain acyclic/i,
    );
  } finally {
    raw.exec('ROLLBACK');
  }
});

test('B002 rejects longer correction back-edge A→B→C→A', () => {
  const { raw, ledgerIds } = chainFixture(3);
  const [a,b,c] = ledgerIds;
  commitEffect(raw, { ledgerId:a, authoritativeLedgerId:b, correctionId:'long-a-b', token:'long-token-a-b' });
  commitEffect(raw, { ledgerId:b, authoritativeLedgerId:c, correctionId:'long-b-c', token:'long-token-b-c' });
  raw.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(
      () => addEffect(raw, { ledgerId:c, authoritativeLedgerId:a, correctionId:'long-c-a', token:'long-token-c-a' }),
      /graph must remain acyclic/i,
    );
  } finally {
    raw.exec('ROLLBACK');
  }
});

test('B002 ordinary A→B→C chain reconstructs exactly one authoritative purpose member', async () => {
  const { db, raw, ledgerIds } = chainFixture(3, 'Valid Chain Goal');
  const [a,b,c] = ledgerIds;
  commitEffect(raw, { ledgerId:a, authoritativeLedgerId:b, correctionId:'valid-a-b', token:'valid-token-a-b' });
  commitEffect(raw, { ledgerId:b, authoritativeLedgerId:c, correctionId:'valid-b-c', token:'valid-token-b-c' });
  const authoritative = await findAuthoritativeGoalPurposeWithdrawals(db, 'family');
  const chainMembers = authoritative.filter(row => [a,b,c].includes(row.ledger_id));
  assert.deepEqual(chainMembers.map(row => row.ledger_id), [c]);
});

test('B004 verifier rejects recomputed-hash backup with unrelated correction type', async () => {
  const { backup } = await validBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.correction_audit.find(row => row.correction_id === 'backup-corr').entity_type = 'balance_history';
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects recomputed-hash backup with wrong Ledger entity id', async () => {
  const { backup, ledgerId } = await validBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.correction_audit.find(row => row.correction_id === 'backup-corr').entity_id = String(ledgerId + 1);
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects recomputed-hash backup with coercive trailing-text Ledger entity id', async () => {
  const { backup, ledgerId } = await validBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.correction_audit.find(row => row.correction_id === 'backup-corr').entity_id = `${ledgerId}junk`;
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects recomputed-hash backup with non-canonical zero-padded Ledger entity id', async () => {
  const { backup, ledgerId } = await validBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.correction_audit.find(row => row.correction_id === 'backup-corr').entity_id = `0${ledgerId}`;
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects recomputed-hash backup with non-text Ledger entity id', async () => {
  const { backup, ledgerId } = await validBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.correction_audit.find(row => row.correction_id === 'backup-corr').entity_id = ledgerId;
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects recomputed-hash backup with wrong write token', async () => {
  const { backup } = await validBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.correction_audit.find(row => row.correction_id === 'backup-corr').write_token = 'wrong-token';
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 schema manifest rejects a recomputed-hash backup that restores the old coercive entity-id trigger', async () => {
  const { backup } = await validBackupFixture();
  const tampered = structuredClone(backup);
  const trigger = tampered.schema.find(item => item.name === 'goal_withdrawal_effect_correction_audit_validate_insert');
  assert.ok(trigger);
  trigger.sql = trigger.sql.replace(
    'NEW.entity_id = CAST(e.superseded_ledger_id AS TEXT)',
    'e.superseded_ledger_id = CAST(NEW.entity_id AS INTEGER)',
  );
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects a recomputed-hash hostile cycle graph', async () => {
  const { backup, a, b } = await replacementBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.correction_audit.push({
    correction_id:'hostile-cycle-b-a', household_id:'family', entity_type:'ledger_movement', entity_id:String(b),
    before_json:'{}', after_json:'{}', reason:'hostile cycle', actor_email:'owner@example.com',
    corrected_at:'2026-08-23T00:11:00Z', base_revision:0, write_token:'hostile-cycle-token',
  });
  tampered.tables.goal_withdrawal_effect_events.push({
    effect_event_id:'hostile-cycle-effect', household_id:'family', superseded_ledger_id:b,
    authoritative_ledger_id:a, correction_id:'hostile-cycle-b-a', effect_kind:'replacement',
    actor_email:'owner@example.com', created_at:'2026-08-23T00:11:00Z', base_revision:0,
    write_token:'hostile-cycle-token',
  });
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects numeric-string, decimal/exponent and zero-padded effect identities', async () => {
  const { backup, a } = await replacementBackupFixture();
  for (const malformed of [String(a), `${a}.0`, `${a}e0`, `0${a}`]) {
    const tampered = structuredClone(backup);
    tampered.tables.goal_withdrawal_effect_events.find(row => row.superseded_ledger_id === a).superseded_ledger_id = malformed;
    resignV3Backup(tampered);
    assert.equal(await verifyPortableBackup(tampered), false, `${malformed} must not coerce to Ledger identity`);
  }
});

test('B004 verifier rejects unsafe JavaScript integer identities rather than aliasing them', async () => {
  const { backup, a } = await replacementBackupFixture();
  const tampered = structuredClone(backup);
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  const movement = tampered.tables.ledger_movements.find(row => row.ledger_id === a);
  const classification = tampered.tables.goal_withdrawal_classifications.find(row => row.ledger_id === a);
  const effect = tampered.tables.goal_withdrawal_effect_events.find(row => row.superseded_ledger_id === a);
  const audit = tampered.tables.correction_audit.find(row => row.correction_id === effect.correction_id);
  movement.ledger_id = unsafe;
  classification.ledger_id = unsafe;
  effect.superseded_ledger_id = unsafe;
  audit.entity_id = String(unsafe);
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 verifier rejects stringified satang even when numerically coercible', async () => {
  const { backup, a } = await replacementBackupFixture();
  const tampered = structuredClone(backup);
  tampered.tables.ledger_movements.find(row => row.ledger_id === a).amount_satang = '5000';
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});

test('B004 gate1-v1 exact schema allowlist rejects an extra trigger and restore cannot execute it', async () => {
  const { backup } = await replacementBackupFixture();
  const tampered = structuredClone(backup);
  tampered.schema.push({
    type:'trigger', name:'hostile_extra_trigger', tbl_name:'ledger_movements',
    sql:"CREATE TRIGGER hostile_extra_trigger BEFORE INSERT ON ledger_movements BEGIN SELECT RAISE(ABORT, 'hostile'); END",
  });
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
  await assert.rejects(() => buildRestoreSql(tampered, { includeSchema:true }), /integrity verification failed/i);
});

test('B004 gate1-v1 exact schema allowlist rejects an extra valid index', async () => {
  const { backup } = await replacementBackupFixture();
  const tampered = structuredClone(backup);
  tampered.schema.push({
    type:'index', name:'hostile_extra_index', tbl_name:'ledger_movements',
    sql:'CREATE INDEX hostile_extra_index ON ledger_movements(account)',
  });
  resignV3Backup(tampered);
  assert.equal(await verifyPortableBackup(tampered), false);
});
