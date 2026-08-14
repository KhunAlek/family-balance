import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLockedSourceSnapshot } from '../../slice-b/test/source-snapshot.mjs';
import { buildOneOffPaymentPreview, planFinancialWrite } from '../src/write-actions.mjs';
import { FinancialWriteValidationError } from '../src/write-protocol.mjs';

const NOW = '2026-08-14T12:00:00.000Z';
const clone = value => structuredClone(value);
const baseSnapshot = () => loadLockedSourceSnapshot();

function context(action, payload, snapshot = baseSnapshot(), overrides = {}) {
  return {
    snapshot,
    householdId: 'family',
    baseRevision: 0,
    nextRevision: 1,
    actorEmail: 'abystrov66@gmail.com',
    action,
    payload,
    nowIso: NOW,
    writeToken: 'write-test-token',
    ...overrides
  };
}

async function expectValidation(promise, pattern) {
  await assert.rejects(promise, error => error instanceof FinancialWriteValidationError && pattern.test(error.message));
}

test('Balance Update may update one account and carries the counterpart from on/before the submitted date', async () => {
  const plan = await planFinancialWrite(context('balanceCheck', { date: '2026-08-12', alexBalance: '3000', olgaBalance: '' }));
  assert.equal(plan.statements.length, 1);
  assert.deepEqual(plan.response.balances, { alex: 3000, olga: 11455, asOf: '2026-08-12' });
  assert.equal(plan.statements[0].params[1], '2026-08-12');
});

test('Income received credits the selected account and creates a factual receipt', async () => {
  const plan = await planFinancialWrite(context('incomeReceipt', {
    date: '2026-08-14', incomeSource: 'Best Lingual (Alex)', incomeAlexAmount: 100, incomeOlgaAmount: 0
  }));
  assert.equal(plan.statements.length, 2);
  assert.equal(plan.response.alexBalance, 2385);
  assert.equal(plan.response.olgaBalance, 11455);
  assert.equal(plan.response.salaryCycleAdvanced, false);
  assert.match(plan.statements[1].sql, /INSERT INTO income_receipts/);
});

test('First salary at the explicit next-salary boundary advances the cycle and clears next salary', async () => {
  const plan = await planFinancialWrite(context('incomeReceipt', {
    date: '2026-08-31', incomeSource: 'Alex Salary', incomeAlexAmount: 33775, incomeOlgaAmount: 0
  }, baseSnapshot(), { nowIso: '2026-08-31T12:00:00.000Z' }));
  assert.equal(plan.response.salaryCycleAdvanced, true);
  assert.equal(plan.response.nextSalaryDateRequired, true);
  assert.match(plan.statements.at(-1).sql, /UPDATE salary_cycle_state/);
  assert.equal(plan.statements.at(-1).params[0], '2026-08-31');
});

test('Next salary date must stay strictly after the current cycle start', async () => {
  await expectValidation(
    planFinancialWrite(context('setNextSalaryDate', { nextSalaryDate: '2026-07-31' })),
    /after the current salary-cycle start/
  );
  const plan = await planFinancialWrite(context('setNextSalaryDate', { nextSalaryDate: '2026-09-29' }));
  assert.equal(plan.response.nextSalaryDate, '2026-09-29');
});

test('EF withdrawal is explicit: ledger withdrawal plus KTB credit', async () => {
  const plan = await planFinancialWrite(context('efWithdrawal', { date: '2026-08-14', destinationAccount: 'Alex', amount: 100 }));
  assert.equal(plan.statements.length, 2);
  assert.match(plan.statements[0].sql, /ledger_movements/);
  assert.match(plan.statements[1].sql, /balance_history/);
  assert.equal(plan.response.efBalance, 137131);
  assert.deepEqual(plan.response.balances, { alex: 2385, olga: 11455 });
});

test('KTB transfer preserves combined KTB and rejects account overdraft', async () => {
  const plan = await planFinancialWrite(context('ktbTransfer', {
    date: '2026-08-14', sourceAccount: 'Olga', destinationAccount: 'Alex', amount: 1000
  }));
  assert.deepEqual(plan.response.balances, { alex: 3285, olga: 10455 });
  assert.equal(plan.response.combined, 13740);
  await expectValidation(
    planFinancialWrite(context('ktbTransfer', { date: '2026-08-14', sourceAccount: 'Alex', destinationAccount: 'Olga', amount: 3000 })),
    /exceeds Alex KTB balance/
  );
});

test('Goal creation validates factual target and rank', async () => {
  const plan = await planFinancialWrite(context('addGoal', { name: 'Test Goal', targetAmount: '5000', priorityRank: '2', targetDate: '2026-12-31' }));
  assert.equal(plan.statements.length, 1);
  assert.deepEqual(plan.response.goal, { name: 'Test Goal', targetAmount: 5000, priorityRank: 2, status: 'active', targetDate: '2026-12-31' });
});

test('EF transfer revalidates current planning capacity server-side', async () => {
  const plan = await planFinancialWrite(context('dedicatedTransfer', {
    date: '2026-08-14', sourceAccount: 'Alex', amount: 100, destinationType: 'EF', destinationName: 'EF'
  }));
  assert.equal(plan.statements.length, 2);
  assert.equal(plan.response.destination, 'EF');
  await expectValidation(
    planFinancialWrite(context('dedicatedTransfer', { date: '2026-08-14', sourceAccount: 'Alex', amount: 300, destinationType: 'EF', destinationName: 'EF' })),
    /above the current safe limit/
  );
});

test('Goal movement follows current waterfall when cash exists after higher protections', async () => {
  const snapshot = clone(baseSnapshot());
  snapshot.balanceHistory.push({
    business_date: '2026-08-14', sheet_order: 999,
    alex_balance_satang: 228500, olga_balance_satang: 2145500,
    one_off_payment_name: null, income_receipt_source: null
  });
  const plan = await planFinancialWrite(context('dedicatedTransfer', {
    date: '2026-08-14', sourceAccount: 'Olga', amount: 1000, destinationType: 'Goal', destinationName: "Olga's laptop"
  }, snapshot));
  assert.equal(plan.response.destination, "Olga's laptop");
  assert.equal(plan.response.amount, 1000);
});

test('Obligation payment records the submitted backdated-permitted date and debits the account', async () => {
  const plan = await planFinancialWrite(context('obligationPayment', {
    date: '2026-08-12', sourceAccount: 'Alex', amount: 14,
    obligationName: 'Claude', occurrenceDueDate: '2026-08-03', note: 'finish', paymentStatus: 'Partial'
  }));
  assert.equal(plan.statements.length, 2);
  assert.equal(plan.response.amount, 14);
  assert.equal(plan.response.occurrenceDueDate, '2026-08-03');
  assert.equal(plan.statements[0].params[4], '2026-08-12');
  assert.deepEqual(plan.response.balances, { alex: 2271, olga: 11455 });
});

test('One-off preview is non-writing and matches the authoritative 14 Aug safe capacity', () => {
  const preview = buildOneOffPaymentPreview(baseSnapshot(), {
    date: '2026-08-14', oneOffName: 'Preview only', oneOffAlexAmount: 1000, oneOffOlgaAmount: 0
  }, NOW);
  assert.equal(preview.ok, true);
  assert.equal(preview.recordableNow, true);
  assert.equal(preview.safeDiscretionaryKTB, 1661.48);
  assert.equal(preview.safeKTBPortion, 1000);
  assert.equal(preview.efRequired, 0);
});

test('Final one-off payment recalculates from authoritative state and requires explicit EF first when needed', async () => {
  const safePlan = await planFinancialWrite(context('oneOffPayment', {
    date: '2026-08-14', oneOffName: 'Safe test', oneOffAlexAmount: 1000, oneOffOlgaAmount: 0
  }));
  assert.equal(safePlan.statements.length, 1);
  assert.deepEqual(safePlan.response.balances, { alex: 1285, olga: 11455 });

  await assert.rejects(
    planFinancialWrite(context('oneOffPayment', { date: '2026-08-14', oneOffName: 'Needs EF', oneOffAlexAmount: 2000, oneOffOlgaAmount: 0 })),
    error => error instanceof FinancialWriteValidationError && error.requiresEFWithdrawal === true && error.split.efPortion === 338.52
  );
});
