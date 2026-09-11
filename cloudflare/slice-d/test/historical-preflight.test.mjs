import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BACKUP_TABLES } from '../src/backup.mjs';
import { classifyHistoricalRows, runHistoricalPreflight, serializeHistoricalPreflight } from '../src/historical-preflight.mjs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';

const migrations = ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql'];
function fixture(t) {
  const value = createSeededSqliteD1(); t.after(() => value.raw.close());
  for (const name of migrations) value.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  return value;
}
function snapshot(raw) { return Object.fromEntries(BACKUP_TABLES.map(table => [table, raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()])); }
function state(raw) { return { schemaVersion: raw.prepare('PRAGMA schema_version').get().schema_version, totalChanges: raw.prepare('SELECT total_changes() n').get().n, revision: raw.prepare('SELECT * FROM household_revisions ORDER BY household_id').all(), tables: snapshot(raw) }; }

test('preflight is byte-for-byte deterministic across repeated and shuffled input', async t => {
  const { db } = fixture(t); const first = await runHistoricalPreflight(db); const second = await runHistoricalPreflight(db);
  assert.equal(first.serialization, second.serialization);
  const shuffled = Object.fromEntries([...Object.entries(snapshot(db.raw))].reverse().map(([table, rows]) => [table, [...rows].reverse()]));
  assert.equal(serializeHistoricalPreflight(classifyHistoricalRows(shuffled)), first.serialization);
  assert.equal(first.serialization.endsWith('\n'), true);
});

test('preflight inventories every row exactly once with no duplicate proposed component ownership', async t => {
  const { db } = fixture(t); const { report } = await runHistoricalPreflight(db);
  const classified = report.counts.logicalComponents + report.counts.balanceObservations + report.counts.nonTransactionItems + report.counts.ambiguousLegacyItems;
  assert.equal(classified, report.counts.sourceItems);
  const componentIds = report.logicalTransactions.flatMap(item => item.proposedComponents.map(component => component.itemId));
  assert.equal(new Set(componentIds).size, componentIds.length);
  assert.ok(report.logicalTransactions.some(item => item.reasonCode === 'AUTHORITATIVE_LEGACY_MAPPING'));
  assert.equal(report.logicalTransactions.every(item => item.proposedComponents.length > 0), true);
});

test('typed parents and foreign keys group complete actions while observations remain separate', async t => {
  const { db, raw } = fixture(t);
  raw.prepare("INSERT INTO one_off_payments VALUES('typed-1','family','2026-08-14',NULL,'Typed',10000,'Alex','2026-08-14T00:00:00.000Z','request-typed',NULL)").run();
  raw.prepare("INSERT INTO one_off_payment_allocations VALUES('typed-1','Alex',10000)").run();
  raw.prepare("INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,source_sheet,source_row,one_off_payment_id) VALUES('family','2026-08-15',2000000000,1,2,'Cloudflare',999,'typed-1')").run();
  const { report } = await runHistoricalPreflight(db); const tx = report.logicalTransactions.find(item => item.logicalTransactionId.endsWith('typed-1'));
  assert.deepEqual(tx.proposedComponents.map(item => item.componentKind), ['balance_effect','one_off_payment_allocation','one_off_payment']);
  assert.equal(report.balanceObservations.some(item => item.itemId.includes('balance_row_id=')), true);
  assert.equal(report.balanceObservations.some(item => tx.proposedComponents.some(component => component.itemId === item.itemId)), false);
});

test('similarity-only facts stay ambiguous and never gain proposed mappings', async t => {
  const { db, raw } = fixture(t);
  raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-15',900,'EF','Withdrawal',12345,'similar',1)").run();
  raw.prepare("INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,source_sheet,source_row) VALUES('family','2026-08-15',901,1,2,'Withdraw from EF',12345,'Alex','similar',2)").run();
  const { report } = await runHistoricalPreflight(db);
  assert.ok(report.ambiguousLegacyItems.some(item => item.reasonCode === 'MISSING_DURABLE_COUNTERPART_RELATIONSHIP'));
  assert.ok(report.balanceObservations.some(item => item.itemId.includes('balance_row_id=')));
  assert.equal(report.logicalTransactions.some(item => item.proposedComponents.some(component => component.itemId.includes('source_row=1'))), false);
});

test('success and read failure perform zero writes, including identity tables and revision', async t => {
  const { db, raw } = fixture(t); const before = state(raw);
  await runHistoricalPreflight(db); const afterSuccess = state(raw);
  assert.deepEqual(afterSuccess, before);
  const failing = { prepare: sql => db.prepare(sql), batch: async statements => { await db.batch(statements); throw new Error('injected read failure'); } };
  await assert.rejects(runHistoricalPreflight(failing), /injected read failure/);
  assert.deepEqual(state(raw), before);
  for (const table of ['logical_transactions','logical_transaction_versions','logical_transaction_components','transaction_management_audit']) assert.equal(raw.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
});

test('incomplete or duplicate durable inventory fails closed', () => {
  const empty = Object.fromEntries(BACKUP_TABLES.map(table => [table, []]));
  delete empty.households; assert.throws(() => classifyHistoricalRows(empty), /complete reviewed table inventory/);
  const duplicate = Object.fromEntries(BACKUP_TABLES.map(table => [table, []]));
  duplicate.households = [{ household_id: 'family' }, { household_id: 'family' }];
  assert.throws(() => classifyHistoricalRows(duplicate), /Duplicate durable source identity/);
});

test('incomplete typed groups classify each source component exactly once as ambiguous', () => {
  const tables = Object.fromEntries(BACKUP_TABLES.map(table => [table, []]));
  tables.one_off_payments.push({ one_off_payment_id: 'bad', household_id: 'family', amount_satang: 100, request_id: 'bad' });
  tables.one_off_payment_allocations.push({ one_off_payment_id: 'bad', account: 'Alex', amount_satang: 99 });
  const report = classifyHistoricalRows(tables);
  assert.equal(report.counts.sourceItems, 2);
  assert.equal(report.counts.ambiguousLegacyItems, 2);
  assert.equal(new Set(report.ambiguousLegacyItems.map(item => item.itemId)).size, 2);
  assert.equal(report.logicalTransactions.length, 0);
});
