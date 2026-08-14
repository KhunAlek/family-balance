import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededSqliteD1 } from './sqlite-d1.mjs';
import { executeRevisionClaimWrite, StaleFinancialWriterError, FinancialWriteValidationError } from '../src/write-protocol.mjs';
import { buildOneOffPaymentPreview, planFinancialWrite } from '../src/write-actions.mjs';
import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';

const NOW = '2026-08-14T12:00:00.000Z';

function raceBarrier(expected = 2) {
  let arrivals = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === expected) release();
    await gate;
  };
}

function write(db, action, payload, extra = {}) {
  return executeRevisionClaimWrite(db, {
    householdId: 'family',
    actorEmail: 'abystrov66@gmail.com',
    action,
    payload,
    planWrite: planFinancialWrite,
    nowIso: NOW,
    ...extra
  });
}

function scalar(raw, sql) { return raw.prepare(sql).get(); }

async function assertExactlyOneStale(promises) {
  const results = await Promise.allSettled(promises);
  const fulfilled = results.filter(item => item.status === 'fulfilled');
  const rejected = results.filter(item => item.status === 'rejected');
  assert.equal(fulfilled.length, 1, JSON.stringify(results));
  assert.equal(rejected.length, 1, JSON.stringify(results));
  assert.ok(rejected[0].reason instanceof StaleFinancialWriterError, String(rejected[0].reason));
  return fulfilled[0].value;
}

test('two payments racing from one base revision: exactly one claim wins', async () => {
  const { db, raw } = createSeededSqliteD1();
  const barrier = raceBarrier();
  const winner = await assertExactlyOneStale([
    write(db, 'oneOffPayment', { date: '2026-08-14', oneOffName: 'Race A', oneOffAlexAmount: 100, oneOffOlgaAmount: 0 }, { writeToken: 'race-payment-a', testOnlyBeforeBatch: barrier }),
    write(db, 'oneOffPayment', { date: '2026-08-14', oneOffName: 'Race B', oneOffAlexAmount: 0, oneOffOlgaAmount: 100 }, { writeToken: 'race-payment-b', testOnlyBeforeBatch: barrier })
  ]);
  assert.equal(winner.baseRevision, 0);
  assert.equal(winner.revision, 1);
  assert.equal(scalar(raw, 'SELECT current_revision AS n FROM household_revisions WHERE household_id=\'family\'').n, 1);
  assert.equal(scalar(raw, 'SELECT COUNT(*) AS n FROM financial_write_claims').n, 1);
});

test('Balance Update racing payment: exactly one logical action commits', async () => {
  const { db, raw } = createSeededSqliteD1();
  const barrier = raceBarrier();
  await assertExactlyOneStale([
    write(db, 'balanceCheck', { date: '2026-08-14', alexBalance: '2500', olgaBalance: '' }, { writeToken: 'race-balance', testOnlyBeforeBatch: barrier }),
    write(db, 'oneOffPayment', { date: '2026-08-14', oneOffName: 'Race payment', oneOffAlexAmount: 100, oneOffOlgaAmount: 0 }, { writeToken: 'race-payment', testOnlyBeforeBatch: barrier })
  ]);
  assert.equal(scalar(raw, 'SELECT current_revision AS n FROM household_revisions').n, 1);
  assert.equal(scalar(raw, 'SELECT COUNT(*) AS n FROM financial_write_claims').n, 1);
});

test('EF movement racing payment: exactly one logical action commits', async () => {
  const { db, raw } = createSeededSqliteD1();
  const barrier = raceBarrier();
  await assertExactlyOneStale([
    write(db, 'dedicatedTransfer', { date: '2026-08-14', sourceAccount: 'Alex', amount: 100, destinationType: 'EF', destinationName: 'EF' }, { writeToken: 'race-ef', testOnlyBeforeBatch: barrier }),
    write(db, 'oneOffPayment', { date: '2026-08-14', oneOffName: 'Race payment', oneOffAlexAmount: 100, oneOffOlgaAmount: 0 }, { writeToken: 'race-pay', testOnlyBeforeBatch: barrier })
  ]);
  assert.equal(scalar(raw, 'SELECT current_revision AS n FROM household_revisions').n, 1);
  assert.equal(scalar(raw, 'SELECT COUNT(*) AS n FROM financial_write_claims').n, 1);
});

test('forced mid-batch failure rolls back claim and every business mutation', async () => {
  const { db, raw } = createSeededSqliteD1();
  const beforeRows = scalar(raw, 'SELECT COUNT(*) AS n FROM balance_history').n;
  await assert.rejects(
    write(db, 'balanceCheck', { date: '2026-08-14', alexBalance: '3000', olgaBalance: '' }, { writeToken: 'forced-failure', testOnlyForcedFailure: true }),
    /__slice_c_forced_failure__|no such table/i
  );
  assert.equal(scalar(raw, 'SELECT COUNT(*) AS n FROM balance_history').n, beforeRows);
  assert.equal(scalar(raw, 'SELECT COUNT(*) AS n FROM financial_write_claims').n, 0);
  assert.equal(scalar(raw, 'SELECT current_revision AS n FROM household_revisions').n, 0);
});

test('account overdraft is rejected before a revision claim exists', async () => {
  const { db, raw } = createSeededSqliteD1();
  await assert.rejects(
    write(db, 'ktbTransfer', { date: '2026-08-14', sourceAccount: 'Alex', destinationAccount: 'Olga', amount: 3000 }),
    error => error instanceof FinancialWriteValidationError && /exceeds Alex KTB balance/.test(error.message)
  );
  assert.equal(scalar(raw, 'SELECT COUNT(*) AS n FROM financial_write_claims').n, 0);
  assert.equal(scalar(raw, 'SELECT current_revision AS n FROM household_revisions').n, 0);
});

test('preview makes zero writes', async () => {
  const { db, raw } = createSeededSqliteD1();
  const snapshot = await loadFinancialSnapshot(db, 'family');
  const before = {
    claims: scalar(raw, 'SELECT COUNT(*) AS n FROM financial_write_claims').n,
    balances: scalar(raw, 'SELECT COUNT(*) AS n FROM balance_history').n,
    ledger: scalar(raw, 'SELECT COUNT(*) AS n FROM ledger_movements').n
  };
  const preview = buildOneOffPaymentPreview(snapshot, { date: '2026-08-14', oneOffName: 'No write', oneOffAlexAmount: 500, oneOffOlgaAmount: 0 }, NOW);
  assert.equal(preview.ok, true);
  assert.deepEqual({
    claims: scalar(raw, 'SELECT COUNT(*) AS n FROM financial_write_claims').n,
    balances: scalar(raw, 'SELECT COUNT(*) AS n FROM balance_history').n,
    ledger: scalar(raw, 'SELECT COUNT(*) AS n FROM ledger_movements').n
  }, before);
  assert.equal(scalar(raw, 'SELECT current_revision AS n FROM household_revisions').n, 0);
});

test('final payment recalculates from fresh authoritative state after a preceding write', async () => {
  const { db } = createSeededSqliteD1();
  const before = await loadFinancialSnapshot(db, 'family');
  const preview = buildOneOffPaymentPreview(before, { date: '2026-08-14', oneOffName: '1600', oneOffAlexAmount: 1600, oneOffOlgaAmount: 0 }, NOW);
  assert.equal(preview.efRequired, 0);

  await write(db, 'dedicatedTransfer', { date: '2026-08-14', sourceAccount: 'Alex', amount: 100, destinationType: 'EF', destinationName: 'EF' }, { writeToken: 'preceding-ef' });

  await assert.rejects(
    write(db, 'oneOffPayment', { date: '2026-08-14', oneOffName: '1600', oneOffAlexAmount: 1600, oneOffOlgaAmount: 0 }, { writeToken: 'final-payment' }),
    error => error instanceof FinancialWriteValidationError && error.requiresEFWithdrawal === true && error.split.efPortion > 0
  );
});

test('explicit EF withdrawal is persisted as a ledger withdrawal and KTB credit', async () => {
  const { db, raw } = createSeededSqliteD1();
  const result = await write(db, 'efWithdrawal', { date: '2026-08-14', destinationAccount: 'Alex', amount: 500 }, { writeToken: 'ef-withdrawal' });
  assert.equal(result.ok, true);
  const ledger = raw.prepare("SELECT account,direction,amount_satang FROM ledger_movements WHERE source_sheet='Cloudflare' ORDER BY ledger_id DESC LIMIT 1").get();
  assert.deepEqual({ ...ledger }, { account: 'EF', direction: 'Withdrawal', amount_satang: 50000 });
  const latest = raw.prepare('SELECT business_date,alex_balance_satang,olga_balance_satang FROM balance_history ORDER BY business_date DESC,sheet_order DESC LIMIT 1').get();
  assert.deepEqual({ ...latest }, { business_date: '2026-08-14', alex_balance_satang: 278500, olga_balance_satang: 1145500 });
});

test('backdated permitted obligation payment persists the submitted movement date', async () => {
  const { db, raw } = createSeededSqliteD1();
  await write(db, 'obligationPayment', {
    date: '2026-08-12', sourceAccount: 'Alex', amount: 14,
    obligationName: 'Claude', occurrenceDueDate: '2026-08-03', paymentStatus: 'Partial', note: 'finish'
  }, { writeToken: 'backdated-payment' });
  const payment = raw.prepare("SELECT payment_date,occurrence_due_date,actual_amount_satang FROM obligation_payments WHERE payment_id='backdated-payment:obligation'").get();
  assert.deepEqual({ ...payment }, { payment_date: '2026-08-12', occurrence_due_date: '2026-08-03', actual_amount_satang: 1400 });
  const movement = raw.prepare("SELECT business_date FROM balance_history WHERE source_sheet='Cloudflare' ORDER BY balance_row_id DESC LIMIT 1").get();
  assert.equal(movement.business_date, '2026-08-12');
});
