import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningState } from '../../slice-b/src/planning.mjs';
import { buildDashboardReadModel } from '../../slice-b/src/read-model.mjs';
import { buildOneOffPaymentPreview, planFinancialWrite } from '../src/write-actions.mjs';
import { FinancialWriteValidationError } from '../src/write-protocol.mjs';

const toSatang = value => Math.round((Number(value) + Number.EPSILON) * 100);
const approx = (actual, expected, label = 'value', tolerance = 0.011) => {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

function balanceRow(date, combined, order) {
  return {
    balance_row_id: order,
    business_date: date,
    sheet_order: order,
    alex_balance_satang: toSatang(combined),
    olga_balance_satang: 0,
    one_off_payment_name: null,
    income_receipt_source: null,
    source_sheet: 'Balance Check',
    source_row: order
  };
}
function goal(name, target, commitment, rank = 1) {
  return {
    name,
    target_amount_satang: toSatang(target),
    priority_rank: rank,
    status: 'active',
    target_date: null,
    cycle_commitment_satang: toSatang(commitment)
  };
}
function ledgerRow(id, date, account, direction, amount) {
  return {
    ledger_id: id,
    business_date: date,
    sheet_order: id,
    account,
    direction,
    amount_satang: toSatang(amount),
    source_sheet: 'Ledger',
    source_row: id
  };
}
function unresolvedCorrection(row) {
  return {
    correction_id: 'repair-run3',
    entity_type: 'ledger_movement',
    entity_id: String(row.ledger_id),
    before_json: JSON.stringify(row),
    after_json: JSON.stringify({ ...row, source_sheet: 'Correction', source_row: 998 }),
    reason: 'test unresolved replacement',
    actor_email: 'test@example.com',
    corrected_at: '2026-08-20T10:00:00Z',
    base_revision: 1,
    write_token: 'repair-run3-token'
  };
}
function snapshot({ nextSalary = '2026-08-31', variablesTarget = 22000, asOf = '2026-08-20' } = {}) {
  const ambiguous = ledgerRow(2, '2026-08-10', 'A', 'Contribution', 1000);
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
      current_cycle_start: '2026-08-01',
      next_salary_date: nextSalary,
      variables_target_satang: variablesTarget === null ? null : toSatang(variablesTarget),
      ef_cycle_commitment_satang: toSatang(1000)
    },
    salaryCycleSources: [],
    balanceHistory: [balanceRow('2026-07-31', 10000, 1), balanceRow(asOf, 10000, 2)],
    incomeDefinitions: [],
    incomeReceipts: [],
    obligations: [],
    obligationPayments: [],
    goals: [goal('A', 10000, 2000, 1), goal('B', 10000, 1000, 2)],
    ledger: [ambiguous],
    weeklySnapshots: [],
    correctionAudits: [unresolvedCorrection(ambiguous)]
  };
}
function writeContext(action, payload, snap, nowIso) {
  return {
    snapshot: snap,
    householdId: 'family',
    baseRevision: 3,
    nextRevision: 4,
    actorEmail: 'test@example.com',
    action,
    payload,
    nowIso,
    writeToken: 'repair-run3-write'
  };
}
async function assertRejectsUnavailable(promise) {
  await assert.rejects(promise, error => error instanceof FinancialWriteValidationError && /Spending authority is unavailable/.test(error.message));
}
async function assertLiveConsumers(s, date, nowIso) {
  const state = buildPlanningState(s, date);
  assert.equal(state.planningState, 'degraded_correction_data');
  assert.equal(state.planningReason, 'current_cycle_ledger_correction_unresolved');
  assert.deepEqual(state.affectedPlanningAccounts, ['A']);
  assert.equal(state.spendingAuthorityAvailable, true);
  assert.equal(state.conservativeSafeMinimum, true);
  approx(state.availableToSpend, 6000, 'conservative Available');

  const model = buildDashboardReadModel(s, date);
  assert.equal(model.planningState, 'degraded_correction_data');
  assert.equal(model.planningReason, 'current_cycle_ledger_correction_unresolved');
  assert.deepEqual(model.affectedPlanningAccounts, ['A']);
  assert.equal(model.availableToSpendIsConservativeMinimum, true);
  approx(model.availableToSpend, 6000, 'read-model conservative Available');

  const preview = buildOneOffPaymentPreview(s, { date, oneOffName: 'Preview', oneOffAlexAmount: 100, oneOffOlgaAmount: 0 }, nowIso);
  assert.equal(preview.paymentSafetyAvailable, true);
  assert.equal(preview.planningState, 'degraded_correction_data');
  approx(preview.availableToSpend, 6000, 'preview conservative Available');

  const ef = await planFinancialWrite(writeContext('dedicatedTransfer', { date, sourceAccount: 'Alex', destinationType: 'EF', amount: 100 }, s, nowIso));
  assert.ok(ef.statements.length > 0);
  const goalB = await planFinancialWrite(writeContext('dedicatedTransfer', { date, sourceAccount: 'Alex', destinationType: 'Goal', destinationName: 'B', amount: 100 }, s, nowIso));
  assert.ok(goalB.statements.length > 0);
  await assert.rejects(
    planFinancialWrite(writeContext('dedicatedTransfer', { date, sourceAccount: 'Alex', destinationType: 'Goal', destinationName: 'A', amount: 100 }, s, nowIso)),
    error => error instanceof FinancialWriteValidationError && /safe limit of 0 THB/.test(error.message)
  );
  return state;
}

test('repair run 3 — degraded correction data precedes awaiting_salary_receipt across read/payment/transfer consumers', async () => {
  const s = snapshot({ asOf: '2026-08-31' });
  const state = await assertLiveConsumers(s, '2026-08-31', '2026-08-31T12:00:00.000Z');
  assert.equal(state.guidanceAvailable, false);
  assert.equal(state.variables.targetRemaining, null);
  assert.equal(state.variables.targetPace, null);
  assert.equal(state.variables.runwayPace, null);
  assert.equal(state.variables.recommendedPace, null);
});

test('repair run 3 — degraded correction data precedes salary_boundary_not_set and keeps authority unavailable', async () => {
  const s = snapshot({ nextSalary: null, variablesTarget: null });
  const state = buildPlanningState(s, '2026-08-20');
  assert.equal(state.planningState, 'degraded_correction_data');
  assert.equal(state.planningReason, 'current_cycle_ledger_correction_unresolved');
  assert.deepEqual(state.affectedPlanningAccounts, ['A']);
  assert.equal(state.spendingAuthorityAvailable, false);
  assert.equal(state.availableToSpend, null);
  assert.equal(state.commitments, null);

  const model = buildDashboardReadModel(s, '2026-08-20');
  assert.equal(model.planningState, 'degraded_correction_data');
  assert.deepEqual(model.affectedPlanningAccounts, ['A']);
  assert.equal(model.commitments, null);
  assert.equal(model.fixedObligations, null);
  assert.equal(model.transferLimits, null);

  const preview = buildOneOffPaymentPreview(s, { date: '2026-08-20', oneOffName: 'Preview', oneOffAlexAmount: 100, oneOffOlgaAmount: 0 }, '2026-08-20T12:00:00.000Z');
  assert.equal(preview.paymentSafetyAvailable, false);
  assert.equal(preview.planningState, 'degraded_correction_data');
  await assertRejectsUnavailable(planFinancialWrite(writeContext('dedicatedTransfer', { date: '2026-08-20', sourceAccount: 'Alex', destinationType: 'EF', amount: 100 }, s, '2026-08-20T12:00:00.000Z')));
  await assertRejectsUnavailable(planFinancialWrite(writeContext('dedicatedTransfer', { date: '2026-08-20', sourceAccount: 'Alex', destinationType: 'Goal', destinationName: 'B', amount: 100 }, s, '2026-08-20T12:00:00.000Z')));
});

test('repair run 3 — degraded correction data precedes target_not_set across read/payment/transfer consumers', async () => {
  const s = snapshot({ variablesTarget: null });
  const state = await assertLiveConsumers(s, '2026-08-20', '2026-08-20T12:00:00.000Z');
  assert.equal(state.guidanceAvailable, true);
  assert.equal(state.variables.target, null);
});

test('repair run 3 — degraded correction data precedes ready across read/payment/transfer consumers', async () => {
  const s = snapshot({ variablesTarget: 22000 });
  const state = await assertLiveConsumers(s, '2026-08-20', '2026-08-20T12:00:00.000Z');
  assert.equal(state.guidanceAvailable, true);
  assert.equal(state.variables.target, 22000);
});
