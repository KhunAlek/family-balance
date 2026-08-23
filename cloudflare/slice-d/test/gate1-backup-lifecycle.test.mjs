import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { buildPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

let sourceRow = 70000;
function addLedger(raw, account, amount) {
  sourceRow += 1;
  return Number(raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-20',?,?,'Withdrawal',?,'Correction',?)")
    .run(sourceRow, account, amount, sourceRow).lastInsertRowid);
}

function classify(raw, ledgerId, goalName, token) {
  raw.prepare("INSERT INTO goal_withdrawal_classifications(ledger_id,household_id,goal_name,use_classification,actor_email,created_at,base_revision,write_token) VALUES(?,'family',?,'goal_purpose','owner@example.com','2026-08-20T00:00:00Z',0,?)")
    .run(ledgerId, goalName, token);
}

function authoritativePurposeRows(raw) {
  return raw.prepare(`
    SELECT l.ledger_id,l.account,l.amount_satang
    FROM goal_withdrawal_classifications c
    JOIN ledger_movements l ON l.ledger_id=c.ledger_id AND l.household_id=c.household_id
    LEFT JOIN goal_withdrawal_effect_events e ON e.household_id=c.household_id AND e.superseded_ledger_id=c.ledger_id
    WHERE c.household_id='family' AND c.use_classification='goal_purpose' AND e.effect_event_id IS NULL
    ORDER BY l.ledger_id
  `).all();
}

test('B002/B004 backup and restore preserve one authoritative purpose effect without rewriting factual Ledger history', async () => {
  const { db, raw } = createSeededSqliteD1();
  raw.prepare("INSERT INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES('family','Backup Lifecycle Goal',5000000,88,'active',NULL)").run();
  const original = addLedger(raw, 'Backup Lifecycle Goal', 5000);
  classify(raw, original, 'class-original');
  const replacement = addLedger(raw, 'Backup Lifecycle Goal', 3200);
  classify(raw, replacement, 'class-replacement');

  raw.exec('BEGIN IMMEDIATE');
  raw.prepare("INSERT INTO goal_withdrawal_effect_events(effect_event_id,household_id,superseded_ledger_id,authoritative_ledger_id,correction_id,effect_kind,actor_email,created_at,base_revision,write_token) VALUES('effect-backup','family',?,?,'corr-backup','replacement','owner@example.com','2026-08-20T00:00:00Z',0,'effect-backup-token')")
    .run(original, replacement);
  raw.prepare("INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token) VALUES('corr-backup','family','ledger_movement',?,'{}','{}','backup lifecycle proof','owner@example.com','2026-08-20T00:00:00Z',0,'effect-backup-token')")
    .run(String(original));
  raw.exec('COMMIT');

  assert.deepEqual(authoritativePurposeRows(raw).filter(row => row.account === 'Backup Lifecycle Goal').map(row => [Number(row.ledger_id),Number(row.amount_satang)]), [[replacement,3200]]);

  const { backup } = await buildPortableBackup(db, { environment:'staging', createdAt:'2026-08-23T10:40:00Z' });
  assert.equal(backup.tables.goal_withdrawal_classifications.filter(row => row.goal_name === 'Backup Lifecycle Goal').length, 2);
  assert.equal(backup.tables.goal_withdrawal_effect_events.filter(row => row.correction_id === 'corr-backup').length, 1);
  assert.equal(backup.tables.ledger_movements.filter(row => row.account === 'Backup Lifecycle Goal').length, 2);

  const restoreSql = await buildRestoreSql(backup, { includeSchema:true });
  const restored = new DatabaseSync(':memory:');
  restored.exec('PRAGMA foreign_keys=ON;');
  restored.exec(restoreSql);
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM ledger_movements WHERE account='Backup Lifecycle Goal'").get().n, 2);
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM goal_withdrawal_classifications WHERE goal_name='Backup Lifecycle Goal'").get().n, 2);
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM goal_withdrawal_effect_events WHERE correction_id='corr-backup'").get().n, 1);
  assert.deepEqual(authoritativePurposeRows(restored).filter(row => row.account === 'Backup Lifecycle Goal').map(row => [Number(row.ledger_id),Number(row.amount_satang)]), [[replacement,3200]]);
});
