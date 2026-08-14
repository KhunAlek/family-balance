import { bangkokBusinessDate, isoDate } from './dates.mjs';
import { latestUsableBalance, manualReconciliationFreshness } from './balances.mjs';
import { buildEmergencyFundDashboardData, accountLedgerBalance } from './ef-goals.mjs';
import { buildPlanningState } from './planning.mjs';
import { computeWeeklyVariablesCards } from './weekly.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const thb = satang => Number(satang || 0) / 100;

export function buildDashboardReadModel(snapshot, onDate = bangkokBusinessDate()) {
  const latest = latestUsableBalance(snapshot.balanceHistory || []);
  if (!latest) throw new Error('No usable account balance is available.');
  const planningState = buildPlanningState(snapshot, onDate);
  const guidance = planningState.guidanceAvailable;
  const cards = guidance ? computeWeeklyVariablesCards(snapshot, onDate, planningState) : [];
  const safeGoalTransferByName = new Map();
  if (guidance) for (const allocation of planningState.goalPreviewPlan.goalAllocations || []) safeGoalTransferByName.set(allocation.name, round2(allocation.previewAllocation));

  const goalsForDisplay = (snapshot.goals || []).map(goal => ({
    name: goal.name,
    targetAmount: round2(thb(goal.target_amount_satang)),
    savedSoFar: accountLedgerBalance(snapshot.ledger || [], goal.name),
    priorityRank: Number(goal.priority_rank),
    status: goal.status,
    targetDate: goal.target_date,
    safeTransferAmount: safeGoalTransferByName.get(goal.name) || 0
  }));
  const incomeSources = (snapshot.incomeDefinitions || []).map(item => ({
    source: String(item.source || ''),
    payDay: String(item.pay_day || ''),
    isSalary: String(item.pay_day || '') !== 'Variable'
  }));
  const emergencyFund = buildEmergencyFundDashboardData(snapshot);

  return {
    asOf: isoDate(onDate),
    guidanceAvailable: guidance,
    guidanceError: planningState.guidanceError,
    salaryCycle: planningState.salaryCycle,
    variablesState: guidance ? {
      asOf: planningState.asOf,
      monthlyBudget: planningState.defaultPlan.activeVariablesPlan,
      activeVariablesPlan: planningState.defaultPlan.activeVariablesPlan,
      spentCycleToDate: planningState.variables.spentCycleToDate,
      spentMonthToDate: planningState.variables.spentCycleToDate,
      remainingBudget: planningState.defaultPlan.remainingVariablesAvailable,
      remainingDays: planningState.salaryCycle.remainingSpendingDays,
      adjustedDaily: planningState.salaryCycle.remainingSpendingDays ? round2(planningState.defaultPlan.remainingVariablesAvailable / planningState.salaryCycle.remainingSpendingDays) : 0
    } : null,
    weeklyVariablesCards: cards,
    goalPreview: guidance ? {
      availableAmount: planningState.goalPreviewPlan.availableForGoals,
      appliedAmount: planningState.goalPreviewPlan.appliedAmount,
      allocations: planningState.goalPreviewPlan.goalAllocations
    } : { availableAmount: 0, appliedAmount: 0, allocations: [] },
    emergencyFund,
    fixedObligations: guidance ? planningState.fixedObligations : { items: [], remainingItems: [], remainingTotal: 0 },
    transferLimits: {
      emergencyFund: guidance ? round2(planningState.emergencyFund.availableNow) : 0,
      goalsTotal: guidance ? round2(planningState.goalPreviewPlan.availableForGoals) : 0
    },
    paymentSafety: guidance ? {
      safeDiscretionaryKTB: planningState.cash.safeDiscretionaryKTB,
      futureVariablesProtected: planningState.variables.mandatoryFutureNeeded,
      remainingFixedObligations: planningState.fixedObligations.remainingTotal
    } : null,
    currentBalances: { alex: round2(latest.alex), olga: round2(latest.olga), asOf: latest.date },
    reconciliationFreshness: manualReconciliationFreshness(snapshot.balanceHistory || [], onDate),
    config: {
      emergencyFundTarget: emergencyFund.target,
      emergencyFundCurrent: emergencyFund.current,
      currency: snapshot.config?.currency || 'THB',
      currentSalaryCycleStart: snapshot.salaryCycle?.current_cycle_start || '',
      nextSalaryDate: snapshot.salaryCycle?.next_salary_date || ''
    },
    goals: goalsForDisplay,
    suggestedNextGoalRank: goalsForDisplay.length + 1,
    incomeSources,
    variableIncomeSources: incomeSources.filter(item => !item.isSalary).map(item => item.source),
    cloudflareReadModel: true,
    readAuthority: 'cloudflare-d1'
  };
}
