import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLockedSourceSnapshot } from './source-snapshot.mjs';
import { buildDashboardReadModel } from '../src/read-model.mjs';

const approx = (actual, expected, label, tolerance = 0.011) => {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

test('2026-08-14 Cloudflare read model reconciles locked live snapshot', () => {
  const model = buildDashboardReadModel(loadLockedSourceSnapshot(), '2026-08-14');

  assert.equal(model.readAuthority, 'cloudflare-d1');
  assert.equal(model.cloudflareReadModel, true);
  assert.equal(model.guidanceAvailable, true);
  assert.deepEqual(model.currentBalances, { alex: 2285, olga: 11455, asOf: '2026-08-12' });
  approx(model.currentBalances.alex + model.currentBalances.olga, 13740, 'combined KTB');

  assert.equal(model.salaryCycle.cycleStart, '2026-07-31');
  assert.equal(model.salaryCycle.nextSalaryDate, '2026-08-31');
  assert.equal(model.salaryCycle.cycleEnd, '2026-08-30');
  assert.equal(model.salaryCycle.totalSpendingDays, 31);
  assert.equal(model.salaryCycle.remainingSpendingDays, 17);

  approx(model.fixedObligations.remainingTotal, 14, 'remaining fixed obligations');
  assert.equal(model.fixedObligations.remainingItems.length, 1);
  assert.equal(model.fixedObligations.remainingItems[0].name, 'Claude');
  approx(model.fixedObligations.remainingItems[0].remainingAmount, 14, 'Claude remaining');

  approx(model.emergencyFund.current, 137231, 'EF current');
  approx(model.emergencyFund.target, 220000, 'EF target');
  approx(model.emergencyFund.remaining, 82769, 'EF remaining');

  assert.equal(model.goals.length, 1);
  assert.equal(model.goals[0].name, "Olga's laptop");
  assert.equal(model.goals[0].priorityRank, 1);
  approx(model.goals[0].targetAmount, 25000, 'Goal target');
  approx(model.goals[0].savedSoFar, 0, 'Goal saved');

  approx(model.variablesState.activeVariablesPlan, 28000, 'active Variables plan');
  approx(model.variablesState.spentCycleToDate, 19008, 'Variables spent this cycle');
  approx(model.variablesState.remainingBudget, 8992, 'remaining Variables');
  approx(model.paymentSafety.safeDiscretionaryKTB, 1661.48, 'safe KTB payment capacity');
  approx(model.transferLimits.emergencyFund, 242.13, 'EF contribution capacity');
  approx(model.transferLimits.goalsTotal, 0, 'Goal capacity');

  assert.equal(model.weeklyVariablesCards.length, 5);
  const [first, second, current, fourth, fifth] = model.weeklyVariablesCards;
  assert.deepEqual([first.weekStart, first.weekEnd, first.isClosed], ['2026-07-31', '2026-08-02', true]);
  approx(first.planned, 2709.68, 'first card plan');
  approx(first.spent, 4981, 'first card spent');
  assert.equal(first.provisional, true);

  assert.deepEqual([second.weekStart, second.weekEnd, second.isClosed], ['2026-08-03', '2026-08-09', true]);
  approx(second.planned, 4967.74, 'frozen second card plan');
  approx(second.spent, 13104, 'second card spent');
  assert.equal(second.provisional, false);

  assert.deepEqual([current.weekStart, current.weekEnd, current.isCurrent], ['2026-08-10', '2026-08-16', true]);
  approx(current.planned, 6322.58, 'current card plan');
  approx(current.spent, 1172, 'current card spent');
  approx(current.available, 1586.82, 'current card available');

  assert.deepEqual([fourth.weekStart, fourth.weekEnd], ['2026-08-17', '2026-08-23']);
  assert.deepEqual([fifth.weekStart, fifth.weekEnd], ['2026-08-24', '2026-08-30']);
  approx(fourth.planned, 6322.58, 'fourth card plan');
  approx(fifth.planned, 6322.58, 'fifth card plan');
  approx(fourth.available, 3702.59, 'fourth card available');
  approx(fifth.available, 3702.59, 'fifth card available');
  approx(current.available + fourth.available + fifth.available, 8992, 'open card availability conservation');
});
