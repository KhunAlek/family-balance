import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BACKUP_TABLES } from '../src/backup.mjs';
import { buildTerminalTransactionReadModel } from '../src/terminal-transaction-read-model.mjs';
import { buildOneOffPreview, buildOneOffReplacement, oneOffEligibility } from '../src/one-off-payment-management.mjs';
import { executeTransactionManagementCommit, previewTransactionManagement } from '../src/transaction-management-protocol.mjs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';

const earlierMigrations = ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql','0014_one_off_management_lifecycle.sql','0015_other_income_receipt_parent.sql','0016_obligation_payment_management.sql','0017_ktb_transfer_management.sql','0018_fund_movement_management.sql','0019_salary_receipt_management.sql'];
const migration = fs.readFileSync(new URL('../migrations/0020_historical_one_off_management.sql', import.meta.url), 'utf8');
const rows = (raw, table) => raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
const snapshot = raw => Object.fromEntries(BACKUP_TABLES.map(table => [table, rows(raw, table)]));

function fixture(t) {
  const value = createSeededSqliteD1();
  t.after(() => value.raw.close());
  for (const name of earlierMigrations) value.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  return value;
}

test('0020 promotes every complete historical one-off without changing factual financial rows', t => {
  const { raw } = fixture(t);
  const factualTables = ['one_off_payments','one_off_payment_allocations','balance_history','income_receipts','obligation_payments','ledger_movements','weekly_snapshots','salary_cycle_state','household_revisions'];
  const before = Object.fromEntries(factualTables.map(table => [table, rows(raw, table)]));
  const eligible = raw.prepare(`SELECT COUNT(*) AS n FROM one_off_payments p WHERE
    (SELECT COUNT(*) FROM one_off_payment_allocations a WHERE a.one_off_payment_id=p.one_off_payment_id)>0
    AND (SELECT SUM(a.amount_satang) FROM one_off_payment_allocations a WHERE a.one_off_payment_id=p.one_off_payment_id)=p.amount_satang
    AND (SELECT COUNT(*) FROM balance_history b WHERE b.one_off_payment_id=p.one_off_payment_id)<=1`).get().n;

  raw.exec(migration);

  for (const table of factualTables) assert.deepEqual(rows(raw, table), before[table], table);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM logical_transactions WHERE logical_transaction_id LIKE 'managed-history:one-off:%'").get().n, eligible);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM logical_transaction_versions WHERE logical_transaction_id LIKE 'managed-history:one-off:%'").get().n, eligible);
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
});

test('promoted historical one-offs become correctable while incomplete rows stay unclaimed', t => {
  const { raw } = fixture(t);
  raw.prepare("INSERT INTO one_off_payments VALUES('incomplete','family','2026-09-10',NULL,'Incomplete',10000,'Alex','2026-09-10T00:00:00.000Z','incomplete-request',NULL)").run();
  raw.prepare("INSERT INTO one_off_payment_allocations VALUES('incomplete','Alex',9000)").run();
  raw.exec(migration);

  const model = buildTerminalTransactionReadModel(snapshot(raw));
  const promoted = model.activeTransactions.filter(item => item.logicalTransactionId.startsWith('managed-history:one-off:'));
  assert.ok(promoted.length > 0);
  assert.equal(promoted.every(item => item.identitySource === 'persisted' && item.permittedActions.correct && item.permittedActions.delete), true);
  assert.equal(promoted.every(item => oneOffEligibility({ transaction: item, payload: { operation: 'corrected' }, tables: snapshot(raw) }).eligible), true);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM logical_transaction_components WHERE component_kind='one_off_payment' AND component_id='incomplete'").get().n, 0);
  assert.ok(model.ambiguousLegacyItems.some(item => item.itemId.includes('incomplete')));
});

test('deleting a promoted historical expense returns its exact allocation to cash once and preserves the original facts', async t => {
  const { db, raw } = fixture(t);
  raw.exec(migration);
  const beforeModel = buildTerminalTransactionReadModel(snapshot(raw));
  const transaction = beforeModel.activeTransactions.find(item => item.logicalTransactionId.startsWith('managed-history:one-off:'));
  const originalPayment = structuredClone(rows(raw, 'one_off_payments').find(item => transaction.components.some(component => component.kind === 'one_off_payment' && component.id === item.one_off_payment_id)));
  const originalAllocations = rows(raw, 'one_off_payment_allocations').filter(item => item.one_off_payment_id === originalPayment.one_off_payment_id);
  const latestBefore = rows(raw, 'balance_history').filter(item => item.alex_balance_satang !== null && item.olga_balance_satang !== null).at(-1);
  const semanticPayload = { reasonCode: 'entered_by_mistake' };
  const preview = await previewTransactionManagement(db, {
    logicalTransactionId: transaction.logicalTransactionId,
    operation: 'deleted',
    correlationId: 'historical-delete-preview',
    semanticPayload,
  }, 'family', { eligibility: oneOffEligibility, buildPreview: buildOneOffPreview, nowIso: '2026-09-14T10:00:00.000Z' });
  const payload = {
    logicalTransactionId: transaction.logicalTransactionId,
    operation: 'deleted',
    requestId: 'historical-delete-request',
    baseRevision: preview.baseRevision,
    terminalVersionId: preview.terminalVersionId,
    semanticPayload,
  };
  const options = { actorEmail: 'alex@example.com', eligibility: oneOffEligibility, buildReplacement: buildOneOffReplacement, nowIso: '2026-09-14T10:00:00.000Z', writeToken: 'historical-delete-write' };
  const first = await executeTransactionManagementCommit(db, payload, options);
  const replay = await executeTransactionManagementCommit(db, payload, options);
  const latestAfter = rows(raw, 'balance_history').filter(item => item.alex_balance_satang !== null && item.olga_balance_satang !== null).at(-1);
  const allocated = account => originalAllocations.find(item => item.account === account)?.amount_satang || 0;

  assert.deepEqual(replay, first);
  assert.equal(latestAfter.alex_balance_satang, latestBefore.alex_balance_satang + allocated('Alex'));
  assert.equal(latestAfter.olga_balance_satang, latestBefore.olga_balance_satang + allocated('Olga'));
  assert.equal(JSON.stringify(rows(raw, 'one_off_payments').find(item => item.one_off_payment_id === originalPayment.one_off_payment_id)), JSON.stringify(originalPayment));
  assert.equal(JSON.stringify(rows(raw, 'one_off_payment_allocations').filter(item => item.one_off_payment_id === originalPayment.one_off_payment_id)), JSON.stringify(originalAllocations));
  const afterModel = buildTerminalTransactionReadModel(snapshot(raw));
  assert.equal(afterModel.activeTransactions.some(item => item.logicalTransactionId === transaction.logicalTransactionId), false);
  assert.equal(afterModel.deletedTransactions.some(item => item.logicalTransactionId === transaction.logicalTransactionId), true);
});
