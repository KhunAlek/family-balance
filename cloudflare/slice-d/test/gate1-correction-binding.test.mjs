import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { buildPortableBackup, verifyPortableBackup } from '../src/backup.mjs';

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

function addEffect(raw, { ledgerId, correctionId = 'corr-binding', token = 'token-binding' }) {
  raw.prepare("INSERT INTO goal_withdrawal_effect_events(effect_event_id,household_id,superseded_ledger_id,authoritative_ledger_id,correction_id,effect_kind,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,NULL,?,'reversal','owner@example.com','2026-08-23T00:00:00Z',0,?)")
    .run(`effect-${correctionId}`, ledgerId, correctionId, token);
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
