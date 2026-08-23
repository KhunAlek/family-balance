import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLockedSourceSnapshot } from './source-snapshot.mjs';
import { buildDashboardReadModel } from '../src/read-model.mjs';

const approx = (actual, expected, label, tolerance = 0.011) => {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

test('2026-08-14 accepted baseline reconciles under v3 mid-cycle cutover state', () => {
  const model = buildDashboardReadModel(loadLockedSourceSnapshot(), '2026-08-14');

  assert.equal(model.readAuthority, 'cloudflare-d1');
  assert.equal(model.cloudflareReadModel, true);
  assert.equal(model.spendingAuthority, 'availableToSpend');
  assert.equal(model.guidanceAvailable, true);
  assert.equal(model.planningState, 'target_not_set');
  assert.equal(model.planningReason, 'variables_target_required');
  assert.deepEqual(model.currentBalances, { alex: 2285, olga: 11455, asOf: '2026-08-12' });
  approx(model.operationalCash, 13740, 'operational cash');

  assert.equal(model.salaryCycle.cycleStart, '2026-07-31');
  assert.equal(model.salaryCycle.nextSalaryDate, '2026-08-31');
  assert.equal(model.salaryCycle.cycleEnd, '2026-08-30');
  assert.equal(model.salaryCycle.totalSpendingDays, 31);
  assert.equal(model.salaryCycle.remainingSpendingDays, 17);

  approx(model.fixedObligations.remainingTotal, 14, 'remaining fixed obligations');
  assert.equal(model.fixedObligations.remainingItems.length, 1);
  assert.equal(model.fixedObligations.remainingItems[0].name, 'Claude');
  approx(model.fixedObligations.remainingItems[0].remainingAmount, 14, 'Claude remaining');

  approx(model.emergencyFund.current, 137231, 'EF current factual balance');
  approx(model.emergencyFund.target, 220000, 'EF lifetime target');
  approx(model.emergencyFund.remaining, 82769, 'EF lifetime remaining');
  approx(model.commitments.ef.commitment, 15000, 'EF cycle commitment');
  approx(model.commitments.ef.grossCompleted, 14000, 'EF current-cycle gross completed');
  approx(model.commitments.ef.outstanding, 1000, 'EF current-cycle outstanding');

  assert.equal(model.goals.length, 1);
  assert.equal(model.goals[0].name, "Olga's laptop");
  assert.equal(model.goals[0].priorityRank, 1);
  approx(model.goals[0].targetAmount, 25000, 'Goal lifetime target');
  approx(model.goals[0].savedSoFar, 0, 'Goal factual balance');
  approx(model.goals[0].cycleCommitment, 0, 'Goal cutover cycle commitment');
  approx(model.goals[0].cycleOutstanding, 0, 'Goal cutover outstanding');

  assert.equal(model.variables.target, null);
  approx(model.variables.spentCycleToDate, 19008, 'Variables spent this salary cycle');
  assert.equal(model.variables.targetRemaining, null);
  assert.equal(model.variables.targetPace, null);
  assert.equal(model.variables.recommendedPace, null);
  approx(model.variables.runwayPace, 748.59, 'runway-only pace');

  approx(model.commitments.requiredOutstanding, 14, 'required commitments');
  approx(model.commitments.chosenOutstanding, 1000, 'chosen commitments');
  approx(model.commitments.totalOutstanding, 1014, 'total outstanding commitments');
  approx(model.availableToSpend, 12726, 'v3 Available to spend');
  approx(model.paymentSafety.availableToSpend, 12726, 'payment safety uses v3 Available');

  assert.equal(model.weeklyVariablesCards.length, 5);
  const [first, second, current, fourth, fifth] = model.weeklyVariablesCards;
  assert.deepEqual([first.weekStart, first.weekEnd, first.isClosed], ['2026-07-31', '2026-08-02', true]);
  assert.equal(first.planned, null);
  approx(first.spent, 4981, 'first card factual spent');
  assert.equal(first.provisional, true);

  assert.deepEqual([second.weekStart, second.weekEnd, second.isClosed], ['2026-08-03', '2026-08-09', true]);
  approx(second.planned, 4967.74, 'pre-v3 frozen second-card plan remains unchanged');
  approx(second.spent, 13104, 'second card spent');
  assert.equal(second.provisional, false);

  assert.deepEqual([current.weekStart, current.weekEnd, current.isCurrent], ['2026-08-10', '2026-08-16', true]);
  assert.equal(current.planned, null);
  approx(current.spent, 1172, 'current card factual spent');
  assert.equal(Object.prototype.hasOwnProperty.call(current, 'available'), false);

  assert.deepEqual([fourth.weekStart, fourth.weekEnd], ['2026-08-17', '2026-08-23']);
  assert.deepEqual([fifth.weekStart, fifth.weekEnd], ['2026-08-24', '2026-08-30']);
  assert.equal(fourth.planned, null);
  assert.equal(fifth.planned, null);
  assert.equal(Object.prototype.hasOwnProperty.call(fourth, 'available'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fifth, 'available'), false);
});
