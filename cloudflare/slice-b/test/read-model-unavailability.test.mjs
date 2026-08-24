import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardReadModel } from '../src/read-model.mjs';

const toSatang = value => Math.round((Number(value) + Number.EPSILON) * 100);
function balanceRow(date, alex, olga, order) {
  return {
    balance_row_id: order,
    business_date: date,
    sheet_order: order,
    alex_balance_satang: toSatang(alex),
    olga_balance_satang: toSatang(olga),
    source_sheet: 'Balance Check',
    source_row: order
  };
}
function baseSnapshot({ cycleStart = '2026-08-01', nextSalary = null, variablesTarget = null, balanceDate = '2026-08-20' } = {}) {
  return {
    householdId: 'family',
    config: {
      currency: 'THB',
      emergency_fund_target_satang: toSatang(220000),
      ef_monthly_claim_cap_satang: toSatang(15000),
      obligation_payments_cutover_period: '2026-08',
      salary_receipt_cutover_date: '2026-07-13'
    },
    salaryCycle: {
      current_cycle_start: cycleStart,
      next_salary_date: nextSalary,
      variables_target_satang: variablesTarget === null ? null : toSatang(variablesTarget),
      ef_cycle_commitment_satang: toSatang(9000)
    },
    salaryCycleSources: [],
    balanceHistory: [balanceRow('2026-07-31', 7000, 3000, 1), balanceRow(balanceDate, 7000, 3000, 2)],
    incomeDefinitions: [],
    incomeReceipts: [],
    obligations: [{ name: 'Rent', expected_amount_satang: toSatang(1500), due_type: 'Day of month', due_day: 15, amount_type: 'Fixed', category: 'Bill', legacy_paid_this_month: 0 }],
    obligationPayments: [],
    goals: [{ name: 'Laptop', target_amount_satang: toSatang(25000), priority_rank: 1, status: 'active', target_date: null, cycle_commitment_satang: toSatang(3500) }],
    ledger: [
      { ledger_id: 1, business_date: '2026-08-10', sheet_order: 1, account: 'EF', direction: 'Contribution', amount_satang: toSatang(5000), source_sheet: 'Ledger', source_row: 1 },
      { ledger_id: 2, business_date: '2026-08-11', sheet_order: 2, account: 'Laptop', direction: 'Contribution', amount_satang: toSatang(4000), source_sheet: 'Ledger', source_row: 2 }
    ],
    weeklySnapshots: [],
    correctionAudits: []
  };
}

function assertCurrentCycleCommitmentsSuppressed(model) {
  assert.equal(model.commitments, null);
  assert.equal(model.fixedObligations, null);
  assert.equal(model.transferLimits, null);
  assert.equal(model.paymentSafety, null);
  assert.equal(model.config.efCycleCommitment, null);
  assert.equal(model.goals.length, 1);
  assert.equal(model.goals[0].cycleCommitment, null);
  assert.equal(model.goals[0].cycleGrossCompleted, null);
  assert.equal(model.goals[0].cycleOutstanding, null);
  assert.equal(model.goals[0].commitmentValid, null);
  assert.equal(model.goals[0].planningDegraded, null);
  assert.equal(model.goals[0].safeTransferAmount, null);
}

test('salary_boundary_not_set preserves unavailable commitments while factual Accounting remains usable', () => {
  const model = buildDashboardReadModel(baseSnapshot(), '2026-08-20');
  assert.equal(model.planningState, 'salary_boundary_not_set');
  assert.equal(model.spendingAuthorityAvailable, false);
  assert.equal(model.availableToSpend, null);
  assertCurrentCycleCommitmentsSuppressed(model);
  assert.deepEqual(model.currentBalances, { alex: 7000, olga: 3000, asOf: '2026-08-20' });
  assert.equal(model.operationalCash, 10000);
  assert.equal(model.emergencyFund.current, 5000);
  assert.equal(model.goals[0].savedSoFar, 4000);
  assert.equal(model.goals[0].targetAmount, 25000);
  assert.equal(model.goals[0].lifetimeRemaining, 21000);
});

test('historical_not_authoritative suppresses current-cycle commitments instead of serializing them as historical truth', () => {
  const snapshot = baseSnapshot({ cycleStart: '2026-09-01', nextSalary: '2026-09-30', variablesTarget: 22000, balanceDate: '2026-09-10' });
  snapshot.balanceHistory.unshift(balanceRow('2026-08-31', 7000, 3000, 0));
  const model = buildDashboardReadModel(snapshot, '2026-08-20');
  assert.equal(model.planningState, 'historical_not_authoritative');
  assert.equal(model.spendingAuthorityAvailable, false);
  assert.equal(model.availableToSpend, null);
  assert.equal(model.variables, null);
  assertCurrentCycleCommitmentsSuppressed(model);
  assert.equal(model.goals[0].savedSoFar, 4000);
  assert.equal(model.goals[0].targetAmount, 25000);
  assert.equal(model.goals[0].lifetimeRemaining, 21000);
});
