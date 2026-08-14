const DAY_MS = 86400000;

export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function parseDate(value) {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function isoDate(value) {
  const d = parseDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

export function addDays(value, days) {
  const d = parseDate(value);
  if (!d) return null;
  return new Date(d.getTime() + Number(days) * DAY_MS);
}

export function countInclusiveDays(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b || b < a) return 0;
  return Math.floor((b - a) / DAY_MS) + 1;
}

export function salaryCycleBoundary({ cycleStart, nextSalaryDate, calculationDate }) {
  const start = parseDate(cycleStart);
  const next = parseDate(nextSalaryDate);
  const on = parseDate(calculationDate);
  if (!start || !next || !on || next <= start || on < start || on >= next) {
    throw new Error('Invalid salary-cycle fixture.');
  }
  const end = addDays(next, -1);
  return {
    cycleStart: isoDate(start),
    nextSalaryDate: isoDate(next),
    cycleEnd: isoDate(end),
    totalSpendingDays: countInclusiveDays(start, end),
    remainingSpendingDays: countInclusiveDays(on, end)
  };
}

export function calculatePaymentSafetyNumbers(input) {
  const cycle = salaryCycleBoundary(input);
  const mandatoryVariables = Math.max(Number(input.mandatoryVariables ?? 22000), 0);
  const futureProtectedVariables = round2(mandatoryVariables / cycle.totalSpendingDays * cycle.remainingSpendingDays);
  const combinedKTB = input.combinedKTB !== undefined
    ? Math.max(Number(input.combinedKTB) || 0, 0)
    : Math.max((Number(input.alexBalance) || 0) + (Number(input.olgaBalance) || 0), 0);
  const fixed = Math.max(Number(input.remainingFixedObligations) || 0, 0);
  const safeDiscretionaryKTB = round2(Math.max(combinedKTB - fixed - futureProtectedVariables, 0));
  const proposedPayment = Math.max(Number(input.proposedPayment ?? input.paymentAmount) || 0, 0);
  const safeKTBPaymentPortion = round2(Math.min(proposedPayment, safeDiscretionaryKTB));
  return {
    ...cycle,
    futureProtectedVariables,
    safeDiscretionaryKTB,
    safeKTBPaymentPortion,
    safePortion: safeKTBPaymentPortion,
    efRequired: round2(Math.max(proposedPayment - safeKTBPaymentPortion, 0))
  };
}

function mondayWeekEnd(value) {
  const d = parseDate(value);
  const dow = d.getUTCDay(); // Sun=0
  const daysFromMonday = (dow + 6) % 7;
  const monday = addDays(d, -daysFromMonday);
  return addDays(monday, 6);
}

export function calculateWeeklyHeadlineNumbers(input) {
  const cycle = salaryCycleBoundary(input);
  const on = parseDate(input.calculationDate);
  const cycleEnd = parseDate(cycle.cycleEnd);
  const weekEnd = mondayWeekEnd(on) < cycleEnd ? mondayWeekEnd(on) : cycleEnd;
  const cardDays = input.cardDays !== undefined
    ? Number(input.cardDays)
    : countInclusiveDays(on, weekEnd);
  const activeVariablesPlan = Math.max(Number(input.activeVariablesPlan) || 0, 0);
  const spentSoFar = Math.max(Number(input.spentSoFar) || 0, 0);
  const remainingAvailability = round2(Math.max(activeVariablesPlan - spentSoFar, 0));
  return {
    ...cycle,
    cardDays,
    remainingAvailability,
    currentCardAvailable: round2(cycle.remainingSpendingDays > 0
      ? remainingAvailability / cycle.remainingSpendingDays * cardDays
      : 0),
    cardEnd: isoDate(weekEnd)
  };
}

const usable = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export function selectLaterSameDateBalance(rows, requestedDate) {
  let selected = null;
  for (const row of rows || []) {
    if (isoDate(row.date) !== requestedDate) continue;
    if (!usable(row.alex) || !usable(row.olga)) continue;
    selected = { ...row, alex: Number(row.alex), olga: Number(row.olga) };
  }
  return selected;
}

export function findNearestPriorBalance(rows, requestedDate, maxFallbackDays = 14) {
  const target = parseDate(requestedDate);
  let best = null;
  for (const row of rows || []) {
    const d = parseDate(row.date);
    if (!d || d > target || !usable(row.alex) || !usable(row.olga)) continue;
    const fallbackDays = Math.floor((target - d) / DAY_MS);
    if (fallbackDays > maxFallbackDays) continue;
    if (!best || d > best.date || (d.getTime() === best.date.getTime() && Number(row.sheetOrder || 0) > Number(best.row.sheetOrder || 0))) {
      best = { date: d, row, fallbackDays };
    }
  }
  return best ? { selectedDate: isoDate(best.date), fallbackDays: best.fallbackDays, row: best.row } : null;
}

export function reconstructPartialBalances(rows, requestedDate) {
  const target = parseDate(requestedDate);
  let alex = null;
  let olga = null;
  let latestDate = null;
  for (const row of rows || []) {
    const d = parseDate(row.date);
    if (!d || d > target) continue;
    if (usable(row.alex)) alex = Number(row.alex);
    if (usable(row.olga)) olga = Number(row.olga);
    latestDate = !latestDate || d >= latestDate ? d : latestDate;
  }
  return { alex, olga, selectedDate: latestDate ? isoDate(latestDate) : null };
}

export function computeEFState(events, asOfDate, monthlyNormalTarget = 15000) {
  const on = parseDate(asOfDate);
  const month = isoDate(on).slice(0, 7);
  const sorted = (events || []).map((e, index) => ({ ...e, index, dateObj: parseDate(e.date) }))
    .filter(e => e.dateObj && e.dateObj <= on && isoDate(e.dateObj).startsWith(month))
    .sort((a, b) => a.dateObj - b.dateObj || a.index - b.index);
  let replenishmentOutstanding = 0;
  let normalContributionRecorded = 0;
  let withdrawals = 0;
  let contributions = 0;
  for (const e of sorted) {
    const amount = Math.max(Number(e.amount) || 0, 0);
    if (e.direction === 'Withdrawal') {
      withdrawals += amount;
      replenishmentOutstanding += amount;
    } else if (e.direction === 'Contribution') {
      contributions += amount;
      const replenish = Math.min(amount, replenishmentOutstanding);
      replenishmentOutstanding -= replenish;
      normalContributionRecorded += amount - replenish;
    }
  }
  return {
    withdrawals: round2(withdrawals),
    contributions: round2(contributions),
    replenishmentOutstanding: round2(replenishmentOutstanding),
    normalContributionRecorded: round2(normalContributionRecorded),
    normalContributionRemaining: round2(Math.max(monthlyNormalTarget - normalContributionRecorded, 0))
  };
}

export function computeEFStateByDate(events, dates, monthlyNormalTarget = 15000) {
  return Object.fromEntries((dates || []).map(d => [d, computeEFState(events, d, monthlyNormalTarget)]));
}

export function allocateGoalWaterfall(availableForGoals, goals) {
  let remaining = Math.max(Number(availableForGoals) || 0, 0);
  return [...(goals || [])]
    .sort((a, b) => Number(a.priorityRank) - Number(b.priorityRank))
    .map(goal => {
      const amount = round2(Math.min(Math.max(Number(goal.remainingTarget) || 0, 0), remaining));
      remaining = round2(Math.max(remaining - amount, 0));
      return { name: goal.name, amount };
    });
}
