import { isoDate, monthPeriod } from './dates.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const thb = satang => Number(satang || 0) / 100;

export function accountLedgerBalance(entries, account) {
  let balance = 0;
  for (const entry of entries || []) {
    if (entry.account !== account) continue;
    const amount = thb(entry.amount_satang);
    if (entry.direction === 'Contribution') balance += amount;
    else if (entry.direction === 'Withdrawal') balance -= amount;
  }
  return round2(balance);
}

export function buildEmergencyFundDashboardData(snapshot) {
  const entries = [...(snapshot.ledger || [])]
    .filter(entry => entry.account === 'EF' && isoDate(entry.business_date))
    .sort((a, b) => a.business_date.localeCompare(b.business_date) || Number(a.sheet_order || 0) - Number(b.sheet_order || 0));
  let runningBalance = 0;
  const history = entries.map(entry => {
    const amount = thb(entry.amount_satang);
    if (entry.direction === 'Contribution') runningBalance += amount;
    else if (entry.direction === 'Withdrawal') runningBalance -= amount;
    return { date: entry.business_date, direction: entry.direction, amount: round2(amount), balance: round2(runningBalance) };
  });
  const target = thb(snapshot.config?.emergency_fund_target_satang);
  return { current: round2(runningBalance), target: round2(target), remaining: round2(Math.max(target - runningBalance, 0)), history };
}

export function currentMonthEFState(snapshot, onDate, monthlyTarget = 15000) {
  const period = monthPeriod(onDate);
  const entries = [...(snapshot.ledger || [])]
    .filter(entry => entry.account === 'EF' && monthPeriod(entry.business_date) === period && entry.business_date <= isoDate(onDate))
    .sort((a, b) => a.business_date.localeCompare(b.business_date) || Number(a.sheet_order || 0) - Number(b.sheet_order || 0));
  let replenishmentOutstanding = 0;
  let normalContributionRecorded = 0;
  let withdrawals = 0;
  let contributions = 0;
  for (const entry of entries) {
    const amount = thb(entry.amount_satang);
    if (entry.direction === 'Withdrawal') {
      withdrawals += amount;
      replenishmentOutstanding += amount;
    } else if (entry.direction === 'Contribution') {
      contributions += amount;
      const replenishmentPart = Math.min(amount, replenishmentOutstanding);
      replenishmentOutstanding -= replenishmentPart;
      normalContributionRecorded += amount - replenishmentPart;
    }
  }
  return {
    withdrawals: round2(withdrawals),
    contributions: round2(contributions),
    replenishmentOutstanding: round2(replenishmentOutstanding),
    normalContributionRecorded: round2(normalContributionRecorded),
    normalContributionRemaining: round2(Math.max(monthlyTarget - normalContributionRecorded, 0))
  };
}

export function buildGoalPreviewWaterfall(snapshot, availableAmount) {
  let remainingCash = Math.max(Number(availableAmount) || 0, 0);
  const allocations = [...(snapshot.goals || [])]
    .sort((a, b) => Number(a.priority_rank) - Number(b.priority_rank))
    .map(goal => {
      const target = thb(goal.target_amount_satang);
      const saved = accountLedgerBalance(snapshot.ledger || [], goal.name);
      const remainingGoal = Math.max(target - saved, 0);
      const allocated = Math.min(remainingGoal, remainingCash);
      remainingCash -= allocated;
      return {
        name: goal.name,
        priorityRank: Number(goal.priority_rank) || 0,
        targetAmount: round2(target),
        savedSoFar: round2(saved),
        remainingBeforePreview: round2(remainingGoal),
        previewAllocation: round2(allocated),
        remainingAfterPreview: round2(remainingGoal - allocated)
      };
    });
  const initial = Math.max(Number(availableAmount) || 0, 0);
  return { allocations, allocatedTotal: round2(initial - remainingCash), leftover: round2(remainingCash) };
}
