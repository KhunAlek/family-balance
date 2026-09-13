import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BACKUP_TABLES } from '../src/backup.mjs';
import { buildBalanceHistory, runBalanceHistory, serializeBalanceHistory } from '../src/balance-history.mjs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { signSession } from '../src/auth.mjs';
import { handleFetch } from '../src/index.js';

const migrations = ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql','0014_one_off_management_lifecycle.sql','0015_other_income_receipt_parent.sql','0016_obligation_payment_management.sql','0017_ktb_transfer_management.sql','0018_fund_movement_management.sql'];
function fixture(t) {
  const value = createSeededSqliteD1(); t.after(() => value.raw.close());
  for (const name of migrations) value.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  return value;
}
function snapshot(raw) { return Object.fromEntries(BACKUP_TABLES.map(table => [table, raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()])); }
function state(raw) { return { schemaVersion: raw.prepare('PRAGMA schema_version').get().schema_version, changes: raw.prepare('SELECT total_changes() n').get().n, revision: raw.prepare('SELECT * FROM household_revisions').all(), tables: snapshot(raw) }; }
function addObservation(raw, date, order, alex, olga, sourceRow) {
  raw.prepare("INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,source_sheet,source_row) VALUES('family',?,?,?,?,?,?)").run(date, order, alex, olga, 'Synthetic Observation', sourceRow);
  return Number(raw.prepare('SELECT last_insert_rowid() id').get().id);
}
function addLinkedPayment(raw) {
  const payment = 'balance-history-payment', tx = 'balance-history-tx', version = `${tx}-v1`;
  raw.prepare("INSERT INTO one_off_payments VALUES(?,?,?,?,?,?,?,?,?,?)").run(payment, 'family', '2026-09-02', null, 'Linked payment', 100, 'Alex', '2026-09-02T00:00:00.000Z', 'balance-history-request', null);
  raw.prepare('INSERT INTO one_off_payment_allocations VALUES(?,?,?)').run(payment, 'Alex', 100);
  raw.prepare("INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,source_sheet,source_row,one_off_payment_id) VALUES('family','2026-09-02',1000000101,900,1500,'Cloudflare',101,?)").run(payment);
  const effectId = Number(raw.prepare('SELECT last_insert_rowid() id').get().id);
  raw.exec('BEGIN');
  raw.prepare('INSERT INTO logical_transactions VALUES(?,?,?,NULL,?,?,?,?,?)').run(tx, 'family', 'active', 'alex@example.com', '2026-09-02T00:00:00.000Z', 'create-balance-history', 'write-balance-history', 1);
  raw.prepare('INSERT INTO logical_transaction_versions VALUES(?,?,?,?,?,?,?,NULL)').run(version, tx, 1, 'one_off_payment', '2026-09-02', 1, 'created');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment', payment, 'primary');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'one_off_payment_allocation', `${payment}:Alex`, 'allocation');
  raw.prepare('INSERT INTO logical_transaction_components VALUES(?,?,?,?)').run(version, 'balance_effect', String(effectId), 'cash_effect');
  raw.prepare('UPDATE logical_transactions SET terminal_version_id=? WHERE logical_transaction_id=?').run(version, tx);
  raw.exec('COMMIT');
  return { effectId, tx };
}

test('observations and typed transaction effects remain separate with exact partial authority', async t => {
  const { raw } = fixture(t);
  const alexAnchor = addObservation(raw, '2026-09-01', 1000000001, 1000, null, 7001);
  const { effectId, tx } = addLinkedPayment(raw);
  const olgaAnchor = addObservation(raw, '2026-09-03', 1000000201, null, 2000, 7002);
  const result = await buildBalanceHistory(snapshot(raw), { pageSize: 100 });
  const alex = result.entries.find(item => item.balanceRowId === alexAnchor);
  const olga = result.entries.find(item => item.balanceRowId === olgaAnchor);
  const effect = result.entries.find(item => item.balanceRowId === effectId);
  assert.deepEqual(alex.observedAccounts, { alex: true, olga: false, combined: false });
  assert.deepEqual(alex.balancesSatang, { alex: 1000, olga: null, combined: null });
  assert.deepEqual(olga.observedAccounts, { alex: false, olga: true, combined: false });
  assert.equal(effect.entryType, 'transaction_balance_effect');
  assert.deepEqual(effect.transactionLink, { status: 'linked', logicalTransactionId: tx, lifecycle: 'active', terminalVersionId: `${tx}-v1` });
  assert.equal(result.entries.some(item => item.entryType === 'balance_observation' && item.balanceRowId === effectId), false);
  assert.deepEqual(result.currentPosition.accounts.alex, { authoritative: true, anchorBalanceRowId: alexAnchor, balanceSatang: 900, appliedLogicalTransactionIds: [tx] });
  assert.deepEqual(result.currentPosition.accounts.olga, { authoritative: true, anchorBalanceRowId: olgaAnchor, balanceSatang: 2000, appliedLogicalTransactionIds: [] });
  assert.deepEqual(result.currentPosition.combined, { authoritative: true, balanceSatang: 2900 });
  assert.equal(result.entries.every(item => !item.permittedActions.correct && !item.permittedActions.delete && !item.permittedActions.restore && !item.permittedActions.undo), true);
});

test('an observation after an effect re-anchors that account without double-applying the effect', async t => {
  const { raw } = fixture(t);
  addObservation(raw, '2026-09-01', 1000000001, 1000, 1500, 7101);
  const { tx } = addLinkedPayment(raw);
  const later = addObservation(raw, '2026-09-03', 1000000201, 850, 1600, 7102);
  const result = await buildBalanceHistory(snapshot(raw), { pageSize: 100 });
  assert.deepEqual(result.currentPosition.accounts.alex, { authoritative: true, anchorBalanceRowId: later, balanceSatang: 850, appliedLogicalTransactionIds: [] });
  assert.equal(result.currentPosition.accounts.alex.appliedLogicalTransactionIds.includes(tx), false);
  assert.deepEqual(result.currentPosition.combined, { authoritative: true, balanceSatang: 2450 });
});

test('typed but non-canonical effects stay explicitly unlinked and never affect current position', async t => {
  const { raw } = fixture(t);
  const anchor = addObservation(raw, '2026-09-01', 1000000001, 1000, 2000, 7201);
  raw.prepare("INSERT INTO one_off_payments VALUES(?,?,?,?,?,?,?,?,?,?)").run('malformed-payment', 'family', '2026-09-02', null, 'Malformed', 100, 'Alex', '2026-09-02T00:00:00.000Z', 'malformed-request', null);
  raw.prepare("INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,source_sheet,source_row,one_off_payment_id) VALUES('family','2026-09-02',1000000101,900,2000,'Cloudflare',201,'malformed-payment')").run();
  const id = Number(raw.prepare('SELECT last_insert_rowid() id').get().id);
  const result = await buildBalanceHistory(snapshot(raw), { pageSize: 100 });
  assert.deepEqual(result.entries.find(item => item.balanceRowId === id).transactionLink, { status: 'unlinked', logicalTransactionId: null, reasonCode: 'NO_CANONICAL_TYPED_COMPONENT' });
  assert.deepEqual(result.currentPosition.accounts.alex, { authoritative: true, anchorBalanceRowId: anchor, balanceSatang: 1000, appliedLogicalTransactionIds: [] });
});

test('durable income receipt foreign keys identify transaction effects without reclassifying them as observations', async t => {
  const { raw } = fixture(t); const tables = snapshot(raw);
  const linkedReceiptRows = tables.income_receipts.filter(row => row.source_balance_row_id !== null);
  assert.ok(linkedReceiptRows.length > 0);
  const result = await buildBalanceHistory(tables, { pageSize: 100 });
  for (const receipt of linkedReceiptRows) {
    const entry = result.entries.find(item => item.balanceRowId === Number(receipt.source_balance_row_id));
    assert.equal(entry.entryType, 'transaction_balance_effect');
    assert.equal(entry.typedEvidence.kind, 'income_receipt_source_balance_row_id');
    assert.equal(entry.typedEvidence.ids.includes(receipt.receipt_id), true);
    assert.ok(['linked', 'unlinked'].includes(entry.transactionLink.status));
    if (entry.transactionLink.status === 'unlinked') assert.equal(entry.transactionLink.reasonCode, 'NO_CANONICAL_TYPED_COMPONENT');
  }
});

test('ordering, revision-bound pagination, shuffled serialization, and all failures are deterministic and zero-write', async t => {
  const { db, raw } = fixture(t); addObservation(raw, '2026-09-10', 1, 100, 200, 7301); addObservation(raw, '2026-09-10', 2, 300, 400, 7302);
  const before = state(raw), tables = snapshot(raw);
  const first = await buildBalanceHistory(tables, { pageSize: 1 });
  const second = await buildBalanceHistory(tables, { pageSize: 1, cursor: first.pagination.nextCursor });
  assert.notEqual(first.entries[0].balanceRowId, second.entries[0].balanceRowId);
  const repeated = await buildBalanceHistory(tables, { pageSize: 1 });
  assert.equal(serializeBalanceHistory(first), serializeBalanceHistory(repeated));
  const shuffled = Object.fromEntries([...Object.entries(tables)].reverse().map(([name, rows]) => [name, [...rows].reverse()]));
  assert.equal(serializeBalanceHistory(await buildBalanceHistory(shuffled, { pageSize: 1 })), serializeBalanceHistory(first));
  await assert.rejects(buildBalanceHistory(tables, { pageSize: 2, cursor: first.pagination.nextCursor }), error => error.code === 'INVALID_CURSOR');
  const changed = structuredClone(tables); changed.household_revisions[0].current_revision++;
  await assert.rejects(buildBalanceHistory(changed, { pageSize: 1, cursor: first.pagination.nextCursor }), error => error.code === 'STALE_BALANCE_HISTORY_QUERY');
  await runBalanceHistory(db, { pageSize: 100 });
  const failing = { prepare: sql => db.prepare(sql), batch: async statements => { await db.batch(statements); throw new Error('injected read failure'); } };
  await assert.rejects(runBalanceHistory(failing), /injected read failure/);
  await assert.rejects(runBalanceHistory(db, { pageSize: 0 }), error => error.code === 'INVALID_QUERY');
  assert.deepEqual(state(raw), before);
});

test('Worker exposes Balance history only through authenticated same-origin read action', async t => {
  const { db, raw } = fixture(t); const before = state(raw); const origin = 'https://family.example';
  const env = { DB: db, GOOGLE_CLIENT_ID: 'client', APPROVED_GOOGLE_EMAILS: 'alex@example.com', SESSION_SIGNING_KEY: 'balance-history-test-signing-key-long-enough' };
  const token = await signSession({ sub: 'subject', email: 'alex@example.com' }, env, { jti: 'balance-history-route' });
  const request = (body, auth = true, requestOrigin = origin) => new Request(`${origin}/api/action`, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', ...(auth ? { cookie: `fcf_session=${token}` } : {}) }, body: JSON.stringify(body) });
  const allowed = await handleFetch(request({ apiAction: 'balanceHistory', payload: { pageSize: 10 } }), env);
  assert.equal(allowed.status, 200); assert.equal((await allowed.json()).format, 'family-cash-flow-balance-history-v1');
  const invalid = await handleFetch(request({ apiAction: 'balanceHistory', payload: { pageSize: 0 } }), env);
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, 'INVALID_QUERY');
  assert.equal((await handleFetch(request({ apiAction: 'balanceHistory' }, false), env)).status, 401);
  assert.equal((await handleFetch(request({ apiAction: 'balanceHistory' }, true, 'https://evil.example'), env)).status, 403);
  assert.deepEqual(state(raw), before);
});
