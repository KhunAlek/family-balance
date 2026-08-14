import { addDays, compareDates, countInclusiveDays, isoDate } from './dates.mjs';
import { balanceOnDate, latestUsableBalance } from './balances.mjs';
import { sumLedgerFlows, sumScheduledFlows } from './flows.mjs';
import { remainingFixedObligations } from './obligations.mjs';
import { buildGoalPreviewWaterfall, currentMonthEFState, accountLedgerBalance } from './ef-goals.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const satangToThb = value => Number(value || 0) / 100;
const PLANNING_VARIABLES_MAX = 28000;

export function salaryCycleBoundary(snapshot, onDate) {
  const cycleStart = isoDate(snapshot.salaryCycle?.current_cycle_start);
  const nextSalaryDate = isoDate(snapshot.salaryCycle?.next_salary_date);
  const cycleEnd = nextSalaryDate ? isoDate(addDays(nextSalaryDate, -1)) : null;
  const result = { valid: false, cycleStart, nextSalaryDate, cycleEnd, error: null };
  if (!cycleStart || !nextSalaryDate) {
    result.error = 'Set the next salary date to calculate safe amounts.';
    return result;
  }
  if (compareDates(nextSalaryDate, cycleStart) <= 0) {
    result.error = 'Next salary date must be after the current salary-cycle start.';
    return result;
  }
  if (compareDates(onDate, cycleStart) < 0) {
    result.error = 'The selected date is before the current salary cycle.';
    return result;
  }
  if (compareDates(onDate, nextSalaryDate) >= 0) {
    result.error = 'Set the next salary date to calculate safe amounts.';
    return result;
  }
  result.valid = true;
  result.totalSpendingDays = countInclusiveDays(cycleStart, cycleEnd);
  result.remainingSpendingDays = countInclusiveDays(onDate, cycleEnd);
  return result;
}

export function computeCycleVariablesSpentToDate(snapshot, cycleStart, asOfDate, currentCombinedBalance) {
  const openingDate = isoDate(addDays(cycleStart, -1));
  const opening = balanceOnDate(snapshot.balanceHistory || [], openingDate);
  if (opening === null) return { spent: 'no data', openingBalance: 'no data' };
  const flows = sumScheduledFlows(snapshot, openingDate, asOfDate);
  const ledgerFlows = sumLedgerFlows(snapshot.ledger || [], openingDate, asOfDate);
  const spent = opening + flows.incomeSum - flows.obligationsSum - ledgerFlows.contributionsSum + ledgerFlows.withdrawalsSum - currentCombinedBalance;
  return { spent: round2(Math.max(spent, 0)), openingBalance: opening };
}

export function buildPlanningState(snapshot, onDate, options = {}) {
  const latest = options.balanceRecord || latestUsableBalance(snapshot.balanceHistory || []);
  if (!latest) throw new Error('No usable account balance is available.');
  const cycle = salaryCycleBoundary(snapshot, onDate);
  const variablesMin = satangToThb(snapshot.config?.planning_variables_min_satang) || 22000;
  const efMonthlyTarget = satangToThb(snapshot.config?.ef_monthly_claim_cap_satang) || 15000;
  const efBalance = accountLedgerBalance(snapshot.ledger || [], 'EF');
  const efTarget = satangToThb(snapshot.config?.emergency_fund_target_satang);

  if (!cycle.valid) {
    return {
      asOf: isoDate(onDate), balanceAsOf: latest.date, guidanceAvailable: false, guidanceError: cycle.error,
      salaryCycle: { valid: false, cycleStart: cycle.cycleStart, nextSalaryDate: cycle.nextSalaryDate },
      cash: { combinedBalance: round2(Math.max(latest.combinedBalance, 0)), safeDiscretionaryKTB: 0 },
      fixedObligations: { items: [], remainingItems: [], remainingTotal: 0, shortfall: 0, fullyCovered: false },
      variables: { minimum: variablesMin, maximum: PLANNING_VARIABLES_MAX },
      emergencyFund: { currentBalance: efBalance, targetBalance: efTarget, availableNow: 0 },
      defaultPlan: { monthlyVariablesBudget: 0, activeVariablesPlan: 0, remainingVariablesAvailable: 0, optionalVariablesTopUp: 0, unallocatedCash: 0 },
      goalPreviewPlan: { availableForGoals: 0, appliedAmount: 0, goalAllocations: [], unallocatedCash: 0 },
      unallocatedCash: 0
    };
  }

  const fixed = remainingFixedObligations(snapshot, onDate, options.obligationPaymentsAsOf || latest.date);
  const cash = Math.max(latest.combinedBalance, 0);
  const cashAfterFixed = Math.max(cash - fixed.total, 0);
  const fixedShortfall = Math.max(fixed.total - cash, 0);

  const mandatoryNeeded = round2(variablesMin / cycle.totalSpendingDays * cycle.remainingSpendingDays);
  const mandatoryReserved = round2(Math.min(mandatoryNeeded, cashAfterFixed));
  const cashAfterMandatory = round2(Math.max(cashAfterFixed - mandatoryReserved, 0));
  const safeDiscretionaryKTB = round2(cashAfterMandatory);

  let anchorDate = latest.date;
  if (compareDates(anchorDate, cycle.cycleStart) < 0) anchorDate = cycle.cycleStart;
  if (compareDates(anchorDate, cycle.cycleEnd) > 0) anchorDate = cycle.cycleEnd;
  const spentCycleResult = computeCycleVariablesSpentToDate(snapshot, cycle.cycleStart, anchorDate, cash);
  const spentCycle = spentCycleResult.spent === 'no data' ? 'no data' : Math.max(Number(spentCycleResult.spent) || 0, 0);

  const anchorRemainingDays = countInclusiveDays(anchorDate, cycle.cycleEnd);
  const anchorMandatoryNeeded = round2(variablesMin / cycle.totalSpendingDays * anchorRemainingDays);
  const anchorMandatoryReserved = round2(Math.min(anchorMandatoryNeeded, cashAfterFixed));
  const anchorCashAfterMandatory = round2(Math.max(cashAfterFixed - anchorMandatoryReserved, 0));

  const efMonth = currentMonthEFState(snapshot, anchorDate, efMonthlyTarget);
  const efReplenishmentAllocated = Math.min(efMonth.replenishmentOutstanding, anchorCashAfterMandatory);
  const cashAfterEFReplenishment = Math.max(anchorCashAfterMandatory - efReplenishmentAllocated, 0);
  const efNormalAllocated = Math.min(efMonth.normalContributionRemaining, cashAfterEFReplenishment);
  const cashAfterEF = round2(Math.max(cashAfterEFReplenishment - efNormalAllocated, 0));

  let activeVariablesPlan;
  let remainingPlanAmount;
  let optionalAdditionalReserved;
  if (spentCycle === 'no data') {
    activeVariablesPlan = variablesMin;
    remainingPlanAmount = anchorMandatoryReserved;
    optionalAdditionalReserved = 0;
  } else {
    const maximumAffordableTotal = spentCycle + anchorMandatoryReserved + cashAfterEF;
    activeVariablesPlan = round2(Math.min(PLANNING_VARIABLES_MAX, Math.max(variablesMin, maximumAffordableTotal)));
    const nominalRemainingAtPlan = Math.max(activeVariablesPlan - spentCycle, 0);
    optionalAdditionalReserved = round2(Math.min(Math.max(nominalRemainingAtPlan - anchorMandatoryReserved, 0), cashAfterEF));
    remainingPlanAmount = round2(Math.min(nominalRemainingAtPlan, anchorMandatoryReserved + optionalAdditionalReserved));
  }
  const cashAfterOptionalVariables = round2(Math.max(cashAfterEF - optionalAdditionalReserved, 0));
  const requestedAmount = options.goalPreviewAmount === undefined ? cashAfterOptionalVariables : Math.max(Number(options.goalPreviewAmount) || 0, 0);
  const goalPreview = buildGoalPreviewWaterfall(snapshot, Math.min(requestedAmount, cashAfterOptionalVariables));

  return {
    asOf: isoDate(onDate), balanceAsOf: latest.date, guidanceAvailable: true, guidanceError: null,
    salaryCycle: {
      valid: true, cycleStart: cycle.cycleStart, nextSalaryDate: cycle.nextSalaryDate, cycleEnd: cycle.cycleEnd,
      totalSpendingDays: cycle.totalSpendingDays, remainingSpendingDays: cycle.remainingSpendingDays
    },
    cash: {
      combinedBalance: round2(cash), afterFixedObligations: round2(cashAfterFixed),
      afterMandatoryVariables: round2(cashAfterMandatory), afterProtectedVariables: round2(cashAfterMandatory),
      safeDiscretionaryKTB, afterEF: round2(cashAfterEF), afterOptionalVariables: round2(cashAfterOptionalVariables)
    },
    fixedObligations: {
      items: fixed.items, remainingItems: fixed.remainingItems, remainingTotal: fixed.total,
      shortfall: round2(fixedShortfall), fullyCovered: fixedShortfall === 0
    },
    variables: {
      minimum: variablesMin, maximum: PLANNING_VARIABLES_MAX,
      spentCycleToDate: spentCycle, spentMonthToDate: spentCycle,
      mandatoryFutureNeeded: mandatoryNeeded, mandatoryFutureReserved: mandatoryReserved,
      protectedRemainingNeeded: mandatoryNeeded, protectedRemainingReserved: mandatoryReserved,
      protectedMinimumAffordable: mandatoryReserved >= mandatoryNeeded - 0.001,
      planAnchorDate: anchorDate, anchorMandatoryFutureNeeded: anchorMandatoryNeeded,
      anchorMandatoryFutureReserved: anchorMandatoryReserved,
      optionalFutureReserved: optionalAdditionalReserved,
      forwardProtectedNeeded: mandatoryNeeded, forwardProtectedReserved: mandatoryReserved,
      futureVariablesReserved: round2(anchorMandatoryReserved + optionalAdditionalReserved),
      remainingSpendingDays: cycle.remainingSpendingDays
    },
    emergencyFund: {
      currentBalance: efBalance, targetBalance: efTarget,
      replenishmentOutstanding: efMonth.replenishmentOutstanding, replenishmentAllocated: round2(efReplenishmentAllocated),
      normalMonthlyTarget: efMonthlyTarget, normalContributionRecorded: efMonth.normalContributionRecorded,
      normalContributionRemaining: efMonth.normalContributionRemaining, normalContributionAllocated: round2(efNormalAllocated),
      availableNow: round2(efReplenishmentAllocated + efNormalAllocated)
    },
    defaultPlan: {
      monthlyVariablesBudget: activeVariablesPlan, activeVariablesPlan,
      remainingVariablesAvailable: remainingPlanAmount,
      optionalVariablesTopUp: round2(Math.max(activeVariablesPlan - variablesMin, 0)),
      optionalVariablesReservedNow: optionalAdditionalReserved,
      unallocatedCash: round2(cashAfterOptionalVariables - goalPreview.allocatedTotal)
    },
    goalPreviewPlan: {
      availableForGoals: round2(cashAfterOptionalVariables), appliedAmount: goalPreview.allocatedTotal,
      goalAllocations: goalPreview.allocations, unallocatedCash: round2(cashAfterOptionalVariables - goalPreview.allocatedTotal)
    },
    goals: {
      availableForPreview: round2(cashAfterOptionalVariables), requestedPreviewAmount: requestedAmount,
      appliedPreviewAmount: goalPreview.allocatedTotal, allocations: goalPreview.allocations
    },
    unallocatedCash: round2(cashAfterOptionalVariables - goalPreview.allocatedTotal)
  };
}
