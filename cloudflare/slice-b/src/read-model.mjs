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
  const safeGoals = planning.transferLimits?.goals || {};

  const goalsForDisplay = (snapshot.goals || []).map(goal => {
    const commitment = (planning.commitments?.goals || []).find(item => item.name === goal.name);
    return {
      name: goal.name,
      targetAmount: round2(thb(goal.target_amount_satang)),
      savedSoFar: accountLedgerBalance(snapshot.ledger || [], goal.name),
      priorityRank: Number(goal.priority_rank),
      status: goal.status,
      targetDate: goal.target_date,
      cycleCommitment: round2(thb(goal.cycle_commitment_satang)),
      cycleGrossCompleted: commitment?.grossCompleted ?? null,
      cycleOutstanding: commitment?.outstanding ?? null,
      lifetimeRemaining: commitment?.lifetimeRemaining ?? round2(Math.max(thb(goal.target_amount_satang) - accountLedgerBalance(snapshot.ledger || [], goal.name), 0)),
      commitmentValid: commitment?.valid ?? true,
      planningDegraded: commitment?.degraded ?? false,
      safeTransferAmount: canSpend ? round2(Number(safeGoals[goal.name]) || 0) : 0
    };
  });
  const incomeSources = (snapshot.incomeDefinitions || []).map(item => ({
    source: String(item.source || ''), payDay: String(item.pay_day || ''), isSalary: String(item.pay_day || '') !== 'Variable'
  }));
  const emergencyFund = buildEmergencyFundDashboardData(snapshot);
  const goalOutstandingTotal = round2((planning.commitments?.goals || []).reduce((sum,item)=>sum+Number(item.outstanding||0),0));

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
    fixedObligations: planning.fixedObligations || { items: [], remainingItems: [], remainingTotal: 0 },
    transferLimits: {
      emergencyFund: canSpend ? round2(Number(planning.transferLimits?.emergencyFund) || 0) : 0,
      goals: canSpend ? safeGoals : {},
      goalsTotal: canSpend ? goalOutstandingTotal : 0
    },
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
