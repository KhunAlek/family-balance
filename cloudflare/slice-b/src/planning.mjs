import { addDays, compareDates, countInclusiveDays, getWeekBounds, isoDate, minDate } from './dates.mjs';
import { balanceOnDate, latestUsableBalance } from './balances.mjs';
import { sumLedgerFlows, sumScheduledFlows } from './flows.mjs';
import { remainingFixedObligations } from './obligations.mjs';
import { accountLedgerBalance } from './ef-goals.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const satangToThb = value => Number(value || 0) / 100;
const EF_DEFAULT_THB = 15000;

function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
function inWindow(value, start, end) {
  const d = isoDate(value);
  return !!d && !!start && compareDates(d, start) >= 0 && (!end || compareDates(d, end) <= 0);
}
function ledgerIdentity(row) {
  return `${String(row?.source_sheet || '')}|${String(row?.source_row ?? '')}`;
}

// Production Ledger corrections are additive: the original factual row remains,
// a reversal row is appended, a replacement row is appended, and correction_audit
// points at the replacement by (source_sheet='Correction', source_row). This
// resolver is intentionally read-only and is used only for gross commitment
// completion; factual balances continue to use raw net Ledger arithmetic.
export function authoritativeLedgerMovements(snapshot, options = {}) {
  const rows = snapshot.ledger || [];
  const audits = (snapshot.correctionAudits || []).filter(a => String(a.entity_type || '') === 'ledger_movement');
  const byId = new Map(rows.map(row => [String(row.ledger_id), row]));
  const byIdentity = new Map(rows.map(row => [ledgerIdentity(row), row]));
  const superseded = new Set();
  const replacementIdentities = new Set();
  const auditCountByEntity = new Map();
  const ambiguities = [];
  const cycleStart = isoDate(options.cycleStart);
  const throughDate = isoDate(options.throughDate);

  const relevantAccounts = (...candidates) => {
    const present = candidates.filter(Boolean);
    if (!present.some(item => inWindow(item.business_date, cycleStart, throughDate))) return [];
    return [...new Set(present.map(item => String(item.account || '').trim()).filter(Boolean))];
  };

  for (const audit of audits) {
    const entityId = String(audit.entity_id ?? '').trim();
    if (!entityId) continue;
    superseded.add(entityId);
    auditCountByEntity.set(entityId, (auditCountByEntity.get(entityId) || 0) + 1);

    const before = parseJson(audit.before_json) || byId.get(entityId) || null;
    const after = parseJson(audit.after_json);
    const sourceRow = after?.source_row;
    const identity = sourceRow === null || sourceRow === undefined ? null : `Correction|${String(sourceRow)}`;
    const replacement = identity ? byIdentity.get(identity) || null : null;
    if (identity) replacementIdentities.add(identity);
    if (!after || !identity || !replacement) {
      ambiguities.push({ entityId, accounts: relevantAccounts(before, after, replacement), reason: 'replacement_unresolved' });
    }
  }

  for (const [entityId, count] of auditCountByEntity) {
    if (count <= 1) continue;
    const before = byId.get(entityId) || null;
    ambiguities.push({ entityId, accounts: relevantAccounts(before), reason: 'multiple_replacements' });
  }

  const authoritative = rows.filter(row => {
    if (superseded.has(String(row.ledger_id))) return false;
    if (String(row.source_sheet || '') !== 'Correction') return true;
    return replacementIdentities.has(ledgerIdentity(row));
  });

  const affectedAccounts = [...new Set(ambiguities.flatMap(item => item.accounts || []).filter(Boolean))];
  return { rows: authoritative, ambiguities, affectedAccounts };
}

export function qualifyingCurrentCycleContributions(snapshot, account, throughDate) {
  const cycleStart = isoDate(snapshot.salaryCycle?.current_cycle_start);
  const end = isoDate(throughDate);
  if (!cycleStart || !end) return { grossCompleted: 0, degraded: false, affectedAccounts: [] };
  const resolved = authoritativeLedgerMovements(snapshot, { cycleStart, throughDate: end });
  const degraded = resolved.affectedAccounts.includes(account);
  if (degraded) return { grossCompleted: 0, degraded: true, affectedAccounts: resolved.affectedAccounts };
  const grossCompleted = resolved.rows.reduce((sum, row) => {
    if (String(row.account || '') !== account || String(row.direction || '') !== 'Contribution') return sum;
    const d = isoDate(row.business_date);
    if (!d || compareDates(d, cycleStart) < 0 || compareDates(d, end) > 0) return sum;
    return sum + satangToThb(row.amount_satang);
  }, 0);
  return { grossCompleted: round2(grossCompleted), degraded: false, affectedAccounts: resolved.affectedAccounts };
}

export function goalCommitmentState(snapshot, goalName, throughDate, proposedCommitment = undefined) {
  const goal = (snapshot.goals || []).find(item => String(item.name || '') === String(goalName || ''));
  if (!goal) return null;
  const commitment = proposedCommitment === undefined
    ? satangToThb(goal.cycle_commitment_satang)
    : round2(Math.max(Number(proposedCommitment) || 0, 0));
  const completion = qualifyingCurrentCycleContributions(snapshot, goal.name, throughDate);
  const factualBalance = round2(accountLedgerBalance(snapshot.ledger || [], goal.name));
  const lifetimeTarget = satangToThb(goal.target_amount_satang);
  const lifetimeRemaining = round2(Math.max(lifetimeTarget - factualBalance, 0));
  const grossCompleted = completion.degraded ? 0 : completion.grossCompleted;
  const outstanding = round2(Math.max(commitment - grossCompleted, 0));
  return {
    name: goal.name,
    commitment,
    grossCompleted,
    outstanding,
    factualBalance,
    lifetimeTarget,
    lifetimeRemaining,
    valid: outstanding <= lifetimeRemaining + 0.001,
    degraded: completion.degraded
  };
}

export function salaryCycleBoundary(snapshot, onDate) {
  const cycleStart = isoDate(snapshot.salaryCycle?.current_cycle_start);
  const nextSalaryDate = isoDate(snapshot.salaryCycle?.next_salary_date);
  const cycleEnd = nextSalaryDate ? isoDate(addDays(nextSalaryDate, -1)) : null;
  const result = { valid: false, cycleStart, nextSalaryDate, cycleEnd, error: null, boundaryExpired: false };
  if (!cycleStart) {
    result.error = 'Current salary cycle is not configured.';
    return result;
  }
  if (!nextSalaryDate) {
    result.error = 'Set the next salary date to calculate current-cycle commitments and runway.';
    return result;
  }
  if (compareDates(nextSalaryDate, cycleStart) <= 0) {
    result.error = 'Next salary date must be after the current salary-cycle start.';
    return result;
  }
  result.totalSpendingDays = countInclusiveDays(cycleStart, cycleEnd);
  if (compareDates(onDate, nextSalaryDate) >= 0) {
    result.valid = true;
    result.boundaryExpired = true;
    result.remainingSpendingDays = null;
    return result;
  }
  if (compareDates(onDate, cycleStart) < 0) {
    result.error = 'Historical v3 planning state is not authoritative after current-cycle state has moved on.';
    return result;
  }
  result.valid = true;
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

function unavailableHistorical(onDate, latest, cycle) {
  return {
    asOf: isoDate(onDate),
    balanceAsOf: latest?.date || null,
    guidanceAvailable: false,
    guidanceError: 'Historical v3 planning state is not authoritative after current-only commitment state has moved on.',
    planningState: 'historical_not_authoritative',
    planningReason: 'requested_date_before_current_cycle',
    affectedPlanningAccounts: [],
    salaryCycle: { valid: false, cycleStart: cycle.cycleStart, nextSalaryDate: cycle.nextSalaryDate, cycleEnd: cycle.cycleEnd },
    operationalCash: latest ? round2(Math.max(latest.combinedBalance, 0)) : null,
    commitments: null,
    availableToSpend: null,
    variables: null,
    availablePace: null
  };
}

export function buildPlanningState(snapshot, onDate, options = {}) {
  const requestedDate = isoDate(onDate);
  const latest = options.balanceRecord || latestUsableBalance(snapshot.balanceHistory || []);
  if (!latest) throw new Error('No usable account balance is available.');
  const cycle = salaryCycleBoundary(snapshot, requestedDate);
  const cycleStart = isoDate(snapshot.salaryCycle?.current_cycle_start);
  if (cycleStart && compareDates(requestedDate, cycleStart) < 0) return unavailableHistorical(requestedDate, latest, cycle);

  const efCommitment = snapshot.salaryCycle?.ef_cycle_commitment_satang === null || snapshot.salaryCycle?.ef_cycle_commitment_satang === undefined
    ? (satangToThb(snapshot.config?.ef_monthly_claim_cap_satang) || EF_DEFAULT_THB)
    : satangToThb(snapshot.salaryCycle.ef_cycle_commitment_satang);
  const operationalCash = round2(Math.max(Number(latest.combinedBalance) || 0, 0));

  if (!cycle.valid) {
    const unresolved = authoritativeLedgerMovements(snapshot, { cycleStart, throughDate: requestedDate });
    const affectedPlanningAccounts = unresolved.affectedAccounts || [];
    const missingBoundary = !!cycleStart && !cycle.nextSalaryDate;
    return {
      asOf: requestedDate,
      balanceAsOf: latest.date,
      guidanceAvailable: false,
      guidanceError: cycle.error,
      planningState: affectedPlanningAccounts.length ? 'degraded_correction_data' : (missingBoundary ? 'salary_boundary_not_set' : 'ready'),
      planningReason: affectedPlanningAccounts.length ? 'current_cycle_ledger_correction_unresolved' : (missingBoundary ? 'next_salary_date_required' : 'salary_cycle_invalid'),
      affectedPlanningAccounts,
      spendingAuthorityAvailable: false,
      salaryCycle: { valid: false, cycleStart: cycle.cycleStart, nextSalaryDate: cycle.nextSalaryDate, cycleEnd: cycle.cycleEnd },
      operationalCash,
      commitments: null,
      availableToSpend: null,
      variables: { spent: null, spentCycleToDate: null },
      availablePace: null
    };
  }

  const paymentAsOf = options.obligationPaymentsAsOf || latest.date || requestedDate;
  const fixed = remainingFixedObligations(snapshot, requestedDate, paymentAsOf);
  const completionThrough = compareDates(latest.date, requestedDate) < 0 ? latest.date : requestedDate;

  const efCompletion = qualifyingCurrentCycleContributions(snapshot, 'EF', completionThrough);
  const efGrossCompleted = efCompletion.degraded ? 0 : efCompletion.grossCompleted;
  const efOutstanding = round2(Math.max(efCommitment - efGrossCompleted, 0));

  const goalStates = (snapshot.goals || []).map(goal => goalCommitmentState(snapshot, goal.name, completionThrough)).filter(Boolean);
  const affected = new Set(efCompletion.affectedAccounts || []);
  for (const goal of goalStates) if (goal.degraded) affected.add(goal.name);
  const goalsOutstanding = round2(goalStates.reduce((sum, goal) => sum + goal.outstanding, 0));
  const chosenOutstanding = round2(efOutstanding + goalsOutstanding);
  const totalOutstanding = round2(fixed.total + chosenOutstanding);
  const availableToSpend = round2(operationalCash - totalOutstanding);

  const spentResult = computeCycleVariablesSpentToDate(snapshot, cycle.cycleStart, completionThrough, operationalCash);
  const spent = spentResult.spent === 'no data' ? null : round2(Math.max(Number(spentResult.spent) || 0, 0));
  const affectedPlanningAccounts = [...affected];
  let planningState = 'ready';
  let planningReason = null;
  if (affectedPlanningAccounts.length) {
    planningState = 'degraded_correction_data';
    planningReason = 'current_cycle_ledger_correction_unresolved';
  } else if (cycle.boundaryExpired) {
    planningState = 'awaiting_salary_receipt';
    planningReason = 'next_salary_boundary_reached_without_cycle_advance';
  }

  const remainingRunwayDays = cycle.boundaryExpired ? null : cycle.remainingSpendingDays;
  const paceBase = round2(Math.max(availableToSpend, 0));
  const guidanceEnd = cycle.boundaryExpired ? null : isoDate(minDate(getWeekBounds(requestedDate).end, cycle.cycleEnd));
  const currentGuidanceDays = guidanceEnd ? countInclusiveDays(requestedDate, guidanceEnd) : null;
  const availablePace = cycle.boundaryExpired || !remainingRunwayDays ? null : {
    today: round2(paceBase / remainingRunwayDays),
    throughSunday: round2(Math.min(paceBase, paceBase * currentGuidanceDays / remainingRunwayDays)),
    remainingRunwayDays,
    guidanceEnd,
    currentGuidanceDays,
    basis: 'available_to_spend'
  };

  const goals = goalStates.map(goal => ({ ...goal }));
  const guidanceAvailable = !cycle.boundaryExpired;
  const spendingAuthorityAvailable = true;
  const authoritativeAvailable = availableToSpend;
  const voluntaryCapacity = round2(Math.max(availableToSpend, 0));
  const efSafeContribution = round2(efOutstanding + voluntaryCapacity);
  const goalSafeLimits = Object.fromEntries(goals.map(goal => {
    if (!goal.valid || goal.degraded) return [goal.name, 0];
    return [goal.name, round2(Math.min(goal.outstanding + voluntaryCapacity, goal.lifetimeRemaining))];
  }));

  return {
    asOf: requestedDate,
    balanceAsOf: latest.date,
    guidanceAvailable,
    guidanceError: guidanceAvailable ? null : 'Next salary date has arrived. Record the qualifying salary receipt; forward pace guidance is unavailable until the cycle advances.',
    spendingAuthorityAvailable,
    planningState,
    planningReason,
    affectedPlanningAccounts,
    salaryCycle: {
      valid: true,
      cycleStart: cycle.cycleStart,
      nextSalaryDate: cycle.nextSalaryDate,
      cycleEnd: cycle.cycleEnd,
      totalSpendingDays: cycle.totalSpendingDays,
      remainingSpendingDays: remainingRunwayDays,
      boundaryExpired: cycle.boundaryExpired
    },
    operationalCash,
    commitments: {
      requiredOutstanding: round2(fixed.total),
      ef: { commitment: round2(efCommitment), grossCompleted: round2(efGrossCompleted), outstanding: efOutstanding, degraded: efCompletion.degraded },
      goals,
      goalsOutstanding,
      chosenOutstanding,
      totalOutstanding
    },
    availableToSpend: authoritativeAvailable,
    fixedObligations: {
      items: fixed.items,
      remainingItems: fixed.remainingItems,
      remainingTotal: round2(fixed.total),
      shortfall: round2(Math.max(fixed.total - operationalCash, 0)),
      fullyCovered: operationalCash >= fixed.total
    },
    variables: { spent, spentCycleToDate: spent },
    availablePace,
    emergencyFund: {
      currentBalance: accountLedgerBalance(snapshot.ledger || [], 'EF'),
      commitment: round2(efCommitment),
      grossCompleted: round2(efGrossCompleted),
      outstanding: efOutstanding,
      maxSafeContribution: efSafeContribution
    },
    goals,
    transferLimits: { emergencyFund: efSafeContribution, goals: goalSafeLimits },
    paymentSafety: {
      availableToSpend: authoritativeAvailable,
      safeKTBPortionForPositivePayment: round2(Math.max(authoritativeAvailable, 0))
    },
    conservativeSafeMinimum: affectedPlanningAccounts.length > 0
  };
}
