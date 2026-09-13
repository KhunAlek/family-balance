import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BACKUP_TABLES } from '../src/backup.mjs';
import { buildTransactionHistory, runTransactionHistory, serializeTransactionHistory } from '../src/transaction-history.mjs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { signSession } from '../src/auth.mjs';
import { handleFetch } from '../src/index.js';

const migrations = ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql','0014_one_off_management_lifecycle.sql','0015_other_income_receipt_parent.sql','0016_obligation_payment_management.sql','0017_ktb_transfer_management.sql'];
function fixture(t) {
  const value = createSeededSqliteD1(); t.after(() => value.raw.close());
  for (const name of migrations) value.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  value.raw.prepare("UPDATE salary_cycle_state SET current_cycle_start='2026-09-01',next_salary_date='2026-10-01' WHERE household_id='family'").run();
  value.raw.prepare("INSERT OR IGNORE INTO reporting_salary_cycles VALUES('family','2026-08-01')").run();
  value.raw.prepare("INSERT OR IGNORE INTO reporting_salary_cycles VALUES('family','2026-09-01')").run();
  return value;
}
function snapshot(raw) { return Object.fromEntries(BACKUP_TABLES.map(table => [table, raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()])); }
function state(raw) { return { changes: raw.prepare('SELECT total_changes() n').get().n, revision: raw.prepare('SELECT * FROM household_revisions').all(), tables: snapshot(raw) }; }
function insertPayment(raw, suffix, date, amount, account = 'Alex') {
  const tx = `history-${suffix}`, version = `${tx}-v1`, payment = `history-payment-${suffix}`;
  raw.prepare('INSERT INTO one_off_payments VALUES(?,?,?,?,?,?,?,?,?,?)').run(payment, 'family', date, null, `Unique ${suffix}`, amount, account, '2026-09-11T00:00:00.000Z', `history-request-${suffix}`, null);
  raw.prepare('INSERT INTO one_off_payment_allocations VALUES(?,?,?)').run(payment, account, amount);
  raw.exec('BEGIN');
  raw.prepare('INSERT INTO logical_transactions VALUES(?,?,?,NULL,?,?,?,?,?)').run(tx, 'family', 'active', 'alex@example.com', '2026-09-11T00:00:00.000Z', `create-${suffix}`, `write-${suffix}`, 1);
  raw.prepare('INSERT INTO logical_transaction_versions VALUES(?,?,?,?,?,?,?,NULL)').run(version, tx, 1, 'one_off_payment', date, 1, 'created');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment', payment, 'primary');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment_allocation', `${payment}:${account}`, 'allocation');
  raw.prepare('UPDATE logical_transactions SET terminal_version_id=? WHERE logical_transaction_id=?').run(version, tx);
  raw.exec('COMMIT');
  return tx;
}
function deletePayment(raw, suffix, date, amount, account = 'Olga') {
  const tx = insertPayment(raw, suffix, date, amount, account), prior = `${tx}-v1`, version = `${tx}-v2`, payment = `history-payment-${suffix}-deleted`, operation = `${tx}-delete`;
  raw.prepare('INSERT INTO one_off_payments VALUES(?,?,?,?,?,?,?,?,?,?)').run(payment, 'family', date, null, `Unique ${suffix}`, amount, account, '2026-09-11T00:01:00.000Z', `history-request-${suffix}-deleted`, null);
  raw.prepare('INSERT INTO one_off_payment_allocations VALUES(?,?,?)').run(payment, account, amount);
  raw.exec('BEGIN');
  raw.prepare('INSERT INTO logical_transaction_versions VALUES(?,?,?,?,?,?,?,?)').run(version, tx, 2, 'one_off_payment', date, 2, 'deleted', operation);
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment', payment, 'primary');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment_allocation', `${payment}:${account}`, 'allocation');
  raw.prepare('INSERT INTO transaction_management_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(operation, 'deleted', tx, prior, version, 'olga@example.com', '2026-09-11T00:01:00.000Z', 'entered_by_mistake', null, `delete-request-${suffix}`, 'a'.repeat(64), 1, 2, `delete-write-${suffix}`, '{}');
  raw.prepare("UPDATE logical_transactions SET lifecycle_status='deleted',terminal_version_id=? WHERE logical_transaction_id=?").run(version, tx);
  raw.exec('COMMIT');
  return tx;
}

test('periods, inclusive custom dates, filters, ordering, details, and complete-set totals use canonical DTOs', async t => {
  const { raw } = fixture(t);
  insertPayment(raw, 'a', '2026-09-10', 10000, 'Alex');
  insertPayment(raw, 'b', '2026-09-10', 20000, 'Olga');
  insertPayment(raw, 'previous', '2026-08-10', 30000, 'Alex');
  const tables = snapshot(raw);
  const current = await buildTransactionHistory(tables, { period: 'current_cycle', text: 'unique', kinds: ['one_off_payment'], pageSize: 1 });
  assert.deepEqual(current.period, { type: 'current_cycle', from: '2026-09-01', throughExclusive: '2026-10-01', throughInclusive: null, timezone: 'Asia/Bangkok' });
  assert.deepEqual(current.totals, { resultCount: 2, moneyInSatang: 0, moneyOutSatang: 30000 });
  assert.equal(current.transactions.length, 1); assert.equal(current.pagination.hasMore, true);
  const custom = await buildTransactionHistory(tables, { period: 'custom', customFrom: '2026-08-10', customThrough: '2026-08-10', text: 'unique', accounts: ['Alex'], exactAmountSatang: 30000, detailLogicalTransactionId: 'history-previous' });
  assert.equal(custom.totals.resultCount, 1); assert.equal(custom.detail.logicalTransactionId, 'history-previous');
  const previous = await buildTransactionHistory(tables, { period: 'previous_cycle', text: 'unique' });
  assert.equal(previous.totals.resultCount, 1);
});

test('cursor is opaque, query-bound, revision-bound, stable, and paginates without duplicates', async t => {
  const { raw } = fixture(t); insertPayment(raw, 'one', '2026-09-10', 100); insertPayment(raw, 'two', '2026-09-09', 200);
  const tables = snapshot(raw), query = { period: 'all', text: 'unique', pageSize: 1 };
  const first = await buildTransactionHistory(tables, query);
  assert.ok(first.pagination.nextCursor && !first.pagination.nextCursor.includes('history-'));
  const second = await buildTransactionHistory(tables, { ...query, cursor: first.pagination.nextCursor });
  assert.notEqual(first.transactions[0].logicalTransactionId, second.transactions[0].logicalTransactionId);
  await assert.rejects(buildTransactionHistory(tables, { ...query, text: 'changed', cursor: first.pagination.nextCursor }), error => error.code === 'INVALID_CURSOR' && error.restartRequired);
  const changed = structuredClone(tables); changed.household_revisions[0].current_revision++;
  await assert.rejects(buildTransactionHistory(changed, { ...query, cursor: first.pagination.nextCursor }), error => error.code === 'STALE_HISTORY_QUERY' && error.restartRequired);
  const repeated = await buildTransactionHistory(tables, query);
  assert.equal(serializeTransactionHistory(first), serializeTransactionHistory(repeated));
});

test('audit visibility is separate and never contaminates financial totals', async t => {
  const { raw } = fixture(t); insertPayment(raw, 'active', '2026-09-10', 10000); deletePayment(raw, 'deleted', '2026-09-10', 90000);
  const tables = snapshot(raw);
  const normal = await buildTransactionHistory(tables, { period: 'all', text: 'unique' });
  const audit = await buildTransactionHistory(tables, { period: 'all', text: 'unique', showAudit: true });
  assert.equal(normal.audit, undefined); assert.equal(normal.totals.moneyOutSatang, 10000);
  assert.equal(audit.audit.deletedTransactions.length, 1); assert.ok(audit.audit.ambiguousLegacyItems.length > 0);
  assert.deepEqual(audit.totals, normal.totals);
  assert.equal(audit.audit.deletedTransactions[0].permittedActions.delete, false);
});

test('invalid periods, ranges, amounts, audit filters, reads, and canonical failures make zero writes', async t => {
  const { db, raw } = fixture(t); insertPayment(raw, 'zero-write', '2026-09-10', 10000); const before = state(raw);
  await runTransactionHistory(db, { period: 'all' }); assert.deepEqual(state(raw), before);
  for (const payload of [
    { period: 'custom', customFrom: '2026-09-11', customThrough: '2026-09-10' },
    { period: 'all', minAmountSatang: 200, maxAmountSatang: 100 },
    { period: 'all', actorEmails: ['alex@example.com'] },
  ]) await assert.rejects(runTransactionHistory(db, payload), error => error.code === 'INVALID_QUERY');
  assert.deepEqual(state(raw), before);
  const unavailable = snapshot(raw); unavailable.salary_cycle_state[0].next_salary_date = null;
  await assert.rejects(buildTransactionHistory(unavailable, { period: 'current_cycle' }), error => error.code === 'PERIOD_UNAVAILABLE');
  assert.deepEqual(state(raw), before);
  const failing = { prepare: sql => db.prepare(sql), batch: async statements => { await db.batch(statements); throw new Error('injected read failure'); } };
  await assert.rejects(runTransactionHistory(failing, { period: 'all' }), /injected read failure/); assert.deepEqual(state(raw), before);
});

test('Worker exposes history only through authenticated same-origin read action with stable failures', async t => {
  const { db, raw } = fixture(t); insertPayment(raw, 'route', '2026-09-10', 12345); const before = state(raw);
  const origin = 'https://family.example';
  const env = { DB: db, GOOGLE_CLIENT_ID: 'client', APPROVED_GOOGLE_EMAILS: 'approved@example.com', SESSION_SIGNING_KEY: 'history-test-signing-key-longer-than-thirty-two-bytes' };
  const token = await signSession({ sub: 'subject', email: 'approved@example.com' }, env, { jti: 'history-route' });
  const request = body => new Request(`${origin}/api/action`, { method: 'POST', headers: { origin, cookie: `fcf_session=${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await handleFetch(request({ apiAction: 'transactionHistory', payload: { period: 'all', text: 'unique route' } }), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).totals.resultCount, 1);
  const invalid = await handleFetch(request({ apiAction: 'transactionHistory', payload: { period: 'custom', customFrom: 'bad', customThrough: '2026-09-10' } }), env);
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, 'INVALID_QUERY');
  const denied = await handleFetch(new Request(`${origin}/api/action`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(denied.status, 401); assert.deepEqual(state(raw), before);
});
