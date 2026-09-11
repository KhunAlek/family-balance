import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BACKUP_TABLES } from '../src/backup.mjs';
import { buildTerminalTransactionReadModel, runTerminalTransactionReadModel, serializeTerminalTransactionReadModel } from '../src/terminal-transaction-read-model.mjs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';

const migrations = ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql'];
function fixture(t) {
  const value = createSeededSqliteD1(); t.after(() => value.raw.close());
  for (const name of migrations) value.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  return value;
}
function snapshot(raw) { return Object.fromEntries(BACKUP_TABLES.map(table => [table, raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()])); }
function state(raw) { return { schemaVersion: raw.prepare('PRAGMA schema_version').get().schema_version, changes: raw.prepare('SELECT total_changes() n').get().n, revision: raw.prepare('SELECT * FROM household_revisions ORDER BY household_id').all(), tables: snapshot(raw) }; }
function insertPayment(raw, id, date, amount, account = 'Alex') {
  raw.prepare('INSERT INTO one_off_payments VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, 'family', date, null, `Payment ${id}`, amount, account, '2026-09-11T00:00:00.000Z', `request-${id}`, null);
  raw.prepare('INSERT INTO one_off_payment_allocations VALUES(?,?,?)').run(id, account, amount);
}
function insertCreatedIdentity(raw, suffix = 'active') {
  const tx = `tx-${suffix}`, version = `${tx}-v1`, payment = `payment-${suffix}`;
  insertPayment(raw, payment, '2026-09-10', 12345);
  raw.exec('BEGIN');
  raw.prepare('INSERT INTO logical_transactions VALUES(?,?,?,NULL,?,?,?,?,?)').run(tx, 'family', 'active', 'alex@example.com', '2026-09-11T10:00:00.000Z', `create-${suffix}`, `write-${suffix}`, 1);
  raw.prepare('INSERT INTO logical_transaction_versions VALUES(?,?,?,?,?,?,?,NULL)').run(version, tx, 1, 'one_off_payment', '2026-09-10', 1, 'created');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment', payment, 'primary');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment_allocation', `${payment}:Alex`, 'allocation');
  raw.prepare('UPDATE logical_transactions SET terminal_version_id=? WHERE logical_transaction_id=?').run(version, tx);
  raw.exec('COMMIT');
  return { tx, version, payment };
}
function appendVersion(raw, identity, operationType, suffix, lifecycle = 'active') {
  const payment = `${identity.payment}-${suffix}`, version = `${identity.tx}-v${suffix}`, operation = `${identity.tx}-op${suffix}`;
  insertPayment(raw, payment, '2026-09-09', 20000, 'Olga');
  raw.exec('BEGIN');
  raw.prepare('INSERT INTO logical_transaction_versions VALUES(?,?,?,?,?,?,?,?)').run(version, identity.tx, Number(suffix), 'one_off_payment', '2026-09-09', Number(suffix), operationType, operation);
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment', payment, 'primary');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment_allocation', `${payment}:Olga`, 'allocation');
  raw.prepare('INSERT INTO transaction_management_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(operation, operationType, identity.tx, identity.version, version, 'olga@example.com', '2026-09-11T10:05:00.000Z', 'owner_change', null, `request-${operation}`, 'a'.repeat(64), Number(suffix) - 1, Number(suffix), `write-${operation}`, '{"cashDeltaSatang":7655}');
  raw.prepare('UPDATE logical_transactions SET lifecycle_status=?,terminal_version_id=? WHERE logical_transaction_id=?').run(lifecycle, version, identity.tx);
  raw.exec('COMMIT');
  return { ...identity, version, payment };
}

test('canonical model resolves terminal versions, complete allocations, audit, and active/deleted visibility', async t => {
  const { db, raw } = fixture(t);
  const active = appendVersion(raw, insertCreatedIdentity(raw), 'corrected', '2');
  const deleted = appendVersion(raw, insertCreatedIdentity(raw, 'deleted'), 'deleted', '2', 'deleted');
  const { model } = await runTerminalTransactionReadModel(db);
  const current = model.activeTransactions.find(item => item.logicalTransactionId === active.tx);
  assert.equal(current.terminalVersion.id, active.version);
  assert.equal(current.totalSatang, 20000);
  assert.deepEqual(current.allocations, [{ account: 'Olga', amountSatang: 20000 }]);
  assert.equal(current.auditSummary.operationCount, 1);
  assert.equal(current.auditSummary.operations[0].priorVersionId, 'tx-active-v1');
  assert.equal(current.permittedActions.correct, false);
  assert.ok(current.permittedActions.refusalCodes.includes('MANAGEMENT_NOT_ENABLED_STEP_4'));
  assert.equal(model.activeTransactions.some(item => item.logicalTransactionId === deleted.tx), false);
  assert.equal(model.deletedTransactions.some(item => item.logicalTransactionId === deleted.tx), true);
});

test('legacy groups adapt deterministically while ambiguity, observations, and exclusions remain separate', async t => {
  const { db } = fixture(t); const { model } = await runTerminalTransactionReadModel(db);
  assert.ok(model.activeTransactions.some(item => item.identitySource === 'historical_adapter' && item.kind === 'one_off_payment'));
  assert.ok(model.ambiguousLegacyItems.some(item => item.reasonCode === 'MISSING_DURABLE_CASH_EFFECT_RELATIONSHIP'));
  assert.equal(model.ambiguousLegacyItems.every(item => !item.permittedActions.correct && item.permittedActions.refusalCodes[0] === 'AMBIGUOUS_LEGACY_ITEM'), true);
  assert.ok(model.counts.balanceObservations > 0);
  assert.ok(model.exclusions.nonTransactionItemCount > 0);
  assert.equal(model.activeTransactions.some(item => item.kind === 'balance_observation'), false);
});

test('repeated and shuffled complete inputs serialize byte-for-byte identically', async t => {
  const { db, raw } = fixture(t); insertCreatedIdentity(raw);
  const first = await runTerminalTransactionReadModel(db), second = await runTerminalTransactionReadModel(db);
  assert.equal(first.serialization, second.serialization);
  const shuffled = Object.fromEntries([...Object.entries(snapshot(raw))].reverse().map(([table, rows]) => [table, [...rows].reverse()]));
  assert.equal(serializeTerminalTransactionReadModel(buildTerminalTransactionReadModel(shuffled)), first.serialization);
  assert.equal(first.serialization.endsWith('\n'), true);
});

test('success and every read or validation failure perform zero writes', async t => {
  const { db, raw } = fixture(t); insertCreatedIdentity(raw); const before = state(raw);
  await runTerminalTransactionReadModel(db); assert.deepEqual(state(raw), before);
  const failing = { prepare: sql => db.prepare(sql), batch: async statements => { await db.batch(statements); throw new Error('injected read failure'); } };
  await assert.rejects(runTerminalTransactionReadModel(failing), /injected read failure/); assert.deepEqual(state(raw), before);
  const invalid = snapshot(raw); invalid.logical_transactions[0].terminal_version_id = 'missing';
  assert.throws(() => buildTerminalTransactionReadModel(invalid), error => error.code === 'MISSING_TERMINAL_VERSION');
  assert.deepEqual(state(raw), before);
});

test('missing, crossed, duplicate, unsupported, and incomplete chains fail closed with stable codes', t => {
  const { raw } = fixture(t); insertCreatedIdentity(raw); const base = snapshot(raw);
  const check = (mutate, code) => { const value = structuredClone(base); mutate(value); assert.throws(() => buildTerminalTransactionReadModel(value), error => error.code === code); };
  check(value => { value.logical_transactions[0].terminal_version_id = null; }, 'MISSING_TERMINAL_POINTER');
  check(value => {
    const otherVersion = { ...value.logical_transaction_versions[0], version_id: 'other-v1', logical_transaction_id: 'tx-other' };
    value.logical_transaction_versions.push(otherVersion);
    value.logical_transactions.push({ ...value.logical_transactions[0], logical_transaction_id: 'tx-other', terminal_version_id: 'other-v1' });
    value.logical_transactions[0].terminal_version_id = 'other-v1';
  }, 'CROSSED_TERMINAL_POINTER');
  check(value => { value.logical_transaction_versions.push({ ...value.logical_transaction_versions[0] }); }, 'DUPLICATE_VERSION_ID');
  check(value => { value.logical_transaction_versions[0].kind = 'ktb_transfer'; }, 'UNSUPPORTED_TRANSACTION_KIND');
  check(value => { value.logical_transaction_components = value.logical_transaction_components.filter(item => item.component_kind !== 'one_off_payment_allocation'); }, 'INCOMPLETE_TYPED_COMPONENTS');
  check(value => { value.logical_transaction_components.push({ ...value.logical_transaction_components[0], version_id: value.logical_transaction_components[0].version_id }); }, 'DUPLICATE_COMPONENT_OWNERSHIP');
});
