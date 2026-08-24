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
  const planning = buildPlanningState(snapshot, onDate);
  const canSpend = planning.spendingAuthorityAvailable && planning.planningState !== 'historical_not_authoritative';
  const cards = planning.salaryCycle?.cycleStart && planning.salaryCycle?.cycleEnd
    ? computeWeeklyVariablesCards(snapshot, onDate, planning)
    : [];
  const commitmentsAvailable = planning.commitments !== null && planning.commitments !== undefined;
  const safeGoals = planning.transferLimits?.goals || null;

  const goalsForDisplay = (snapshot.goals || []).map(goal => {
    const commitment = commitmentsAvailable
      ? (planning.commitments.goals || []).find(item => item.name === goal.name)
      : null;
    const savedSoFar = accountLedgerBalance(snapshot.ledger || [], goal.name);
    const factualLifetimeRemaining = round2(Math.max(thb(goal.target_amount_satang) - savedSoFar, 0));
    const safeTransferAvailable = canSpend && safeGoals && Object.prototype.hasOwnProperty.call(safeGoals, goal.name);
    return {
      name: goal.name,
      targetAmount: round2(thb(goal.target_amount_satang)),
      savedSoFar,
      priorityRank: Number(goal.priority_rank),
      status: goal.status,
      targetDate: goal.target_date,
      cycleCommitment: commitment?.commitment ?? null,
      cycleGrossCompleted: commitment?.grossCompleted ?? null,
      cycleOutstanding: commitment?.outstanding ?? null,
      lifetimeRemaining: commitment?.lifetimeRemaining ?? factualLifetimeRemaining,
      commitmentValid: commitment ? !!commitment.valid : null,
      planningDegraded: commitment ? !!commitment.degraded : null,
      safeTransferAmount: safeTransferAvailable ? round2(Number(safeGoals[goal.name]) || 0) : null
    };
  });
  const incomeSources = (snapshot.incomeDefinitions || []).map(item => ({
    source: String(item.source || ''), payDay: String(item.pay_day || ''), isSalary: String(item.pay_day || '') !== 'Variable'
  }));
  const emergencyFund = buildEmergencyFundDashboardData(snapshot);
  const goalOutstandingTotal = commitmentsAvailable
    ? round2((planning.commitments.goals || []).reduce((sum,item)=>sum+Number(item.outstanding||0),0))
    : null;
  const transferLimits = canSpend && planning.transferLimits ? {
    emergencyFund: round2(Number(planning.transferLimits.emergencyFund) || 0),
    goals: safeGoals || {},
    goalsTotal: goalOutstandingTotal
  } : null;

  return {
    asOf: isoDate(onDate),
    planningState: planning.planningState,
    planningReason: planning.planningReason,
    affectedPlanningAccounts: planning.affectedPlanningAccounts || [],
    guidanceAvailable: planning.guidanceAvailable,
    guidanceError: planning.guidanceError,
    spendingAuthorityAvailable: !!planning.spendingAuthorityAvailable,
    operationalCash: planning.operationalCash,
    commitments: planning.commitments,
    availableToSpend: planning.availableToSpend,
    availableToSpendIsConservativeMinimum: !!planning.conservativeSafeMinimum,
    salaryCycle: planning.salaryCycle,
    variables: planning.variables,
    variablesState: planning.variables,
    weeklyVariablesCards: cards,
    emergencyFund,
    fixedObligations: planning.fixedObligations ?? null,
    transferLimits,
    paymentSafety: canSpend ? {
      availableToSpend: planning.availableToSpend,
      fundingNeededForAmount: 'max(paymentAmount - availableToSpend, 0)',
      remainingFixedObligations: planning.commitments?.requiredOutstanding ?? null,
      totalOutstandingCommitments: planning.commitments?.totalOutstanding ?? null
    } : null,
    currentBalances: { alex: round2(latest.alex), olga: round2(latest.olga), asOf: latest.date },
    reconciliationFreshness: manualReconciliationFreshness(snapshot.balanceHistory || [], onDate),
    config: {
      emergencyFundTarget: emergencyFund.target,
      emergencyFundCurrent: emergencyFund.current,
      currency: snapshot.config?.currency || 'THB',
      currentSalaryCycleStart: snapshot.salaryCycle?.current_cycle_start || '',
      nextSalaryDate: snapshot.salaryCycle?.next_salary_date || '',
      variablesTarget: planning.variables?.target ?? null,
      efCycleCommitment: planning.commitments?.ef?.commitment ?? null
    },
    goals: goalsForDisplay,
    suggestedNextGoalRank: goalsForDisplay.length + 1,
    incomeSources,
    variableIncomeSources: incomeSources.filter(item => !item.isSalary).map(item => item.source),
    cloudflareReadModel: true,
    readAuthority: 'cloudflare-d1',
    spendingAuthority: 'availableToSpend'
  };
}
