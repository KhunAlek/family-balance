import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  calculatePaymentSafetyNumbers,
  calculateWeeklyHeadlineNumbers,
  selectLaterSameDateBalance,
  findNearestPriorBalance,
  reconstructPartialBalances,
  computeEFStateByDate,
  allocateGoalWaterfall
} from '../src/financial.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./financial_regression_fixtures.json', import.meta.url), 'utf8'));
const approx = (actual, expected, label, tolerance = 0.011) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);

for (const fixture of fixtures.positiveFixtures) {
  test(fixture.id, () => {
    if (fixture.id.startsWith('PAYMENT_') || fixture.id.startsWith('CROSS_MONTH_')) {
      const actual = calculatePaymentSafetyNumbers(fixture.inputs);
      if (fixture.inputs.totalSpendingDays !== undefined) assert.equal(actual.totalSpendingDays, fixture.inputs.totalSpendingDays);
      if (fixture.inputs.remainingSpendingDays !== undefined) assert.equal(actual.remainingSpendingDays, fixture.inputs.remainingSpendingDays);
      for (const [key, expected] of Object.entries(fixture.expected)) approx(actual[key], expected, `${fixture.id}.${key}`);
      return;
    }
    if (fixture.id === 'WEEKLY_2026-06-30') {
      const actual = calculateWeeklyHeadlineNumbers(fixture.inputs);
      approx(actual.currentCardAvailable, fixture.expected.currentCardAvailable, `${fixture.id}.currentCardAvailable`);
      assert.equal(actual.cardDays, fixture.inputs.cardDays);
      return;
    }
    throw new Error(`Unhandled positive fixture ${fixture.id}`);
  });
}

for (const fixture of fixtures.branchFixtures) {
  test(fixture.id, () => {
    if (fixture.id === 'BALANCE_SAME_DATE_PRECEDENCE') {
      const actual = selectLaterSameDateBalance(fixture.rows, fixture.expected.date);
      assert.deepEqual(actual, fixture.expected);
      return;
    }
    if (fixture.id === 'BALANCE_NEAREST_PRIOR_FALLBACK') {
      const actual = findNearestPriorBalance(fixture.rows, fixture.requestedDate, fixture.maxFallbackDays);
      assert.equal(actual.selectedDate, fixture.expected.selectedDate);
      assert.equal(actual.fallbackDays, fixture.expected.fallbackDays);
      return;
    }
    if (fixture.id === 'EF_REPLENISH_BEFORE_NORMAL') {
      const actual = computeEFStateByDate(fixture.events, Object.keys(fixture.expectedByDate), fixture.monthlyNormalTarget);
      for (const [date, expected] of Object.entries(fixture.expectedByDate)) {
        assert.equal(actual[date].replenishmentOutstanding, expected.replenishmentOutstanding);
        assert.equal(actual[date].normalContributionRecorded, expected.normalContributionRecorded);
      }
      return;
    }
    if (fixture.id === 'GOAL_ASCENDING_RANK_WATERFALL') {
      assert.deepEqual(allocateGoalWaterfall(fixture.availableForGoals, fixture.goals), fixture.expectedAllocations);
      return;
    }
    if (fixture.id === 'PARTIAL_BALANCE_CARRY_FORWARD') {
      const actual = reconstructPartialBalances(fixture.rows, fixture.requestedDate);
      assert.equal(actual.alex, fixture.expected.alex);
      assert.equal(actual.olga, fixture.expected.olga);
      return;
    }
    throw new Error(`Unhandled branch fixture ${fixture.id}`);
  });
}

test('fixture inventory remains locked at 5 numeric + 5 branch fixtures', () => {
  assert.equal(fixtures.fixtureVersion, '2.5');
  assert.equal(fixtures.positiveFixtures.length, 5);
  assert.equal(fixtures.branchFixtures.length, 5);
});
