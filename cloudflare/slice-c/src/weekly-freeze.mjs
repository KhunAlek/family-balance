import { addDays, compareDates, countInclusiveDays, getWeekBounds, isoDate, maxDate, minDate, parseIsoDate } from '../../slice-b/src/dates.mjs';
import { balanceOnDate, nearestPriorBalance } from '../../slice-b/src/balances.mjs';
import { sumLedgerFlows, sumScheduledFlows } from '../../slice-b/src/flows.mjs';
import { buildPlanningState } from '../../slice-b/src/planning.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const toSatang = value => Math.round((Number(value) + Number.EPSILON) * 100);
const fromSatang = value => Number(value || 0) / 100;

function latestSnapshotEnd(rows) {
  let latest = null;
  for (const row of rows || []) {
    const end = isoDate(row.week_end);
    if (!end) continue;
    if (!latest || compareDates(end, latest) > 0) latest = end;
  }
  return latest;
}

function existingStarts(rows) {
  return new Set((rows || []).map(row => isoDate(row.week_start)).filter(Boolean));
}

function enumerateCards(cycleStart, cycleEnd, cursorStart, closedThrough) {
  const start = parseIsoDate(cycleStart);
  const end = parseIsoDate(cycleEnd);
  const cursor = parseIsoDate(cursorStart || cycleStart);
  const through = parseIsoDate(closedThrough || cycleEnd);
  if (!start || !end || !cursor || !through) return [];
  let pos = maxDate(start, cursor);
  const limit = minDate(end, through);
  const cards = [];
  while (pos && compareDates(pos, limit) <= 0) {
    const bounds = getWeekBounds(pos);
    const cardStart = maxDate(pos, maxDate(bounds.start, start));
    const cardEnd = minDate(bounds.end, end);
    if (compareDates(cardEnd, limit) > 0) break;
    cards.push({ start: cardStart, end: cardEnd });
    pos = addDays(cardEnd, 1);
  }
  return cards;
}

function balanceAtBoundary(snapshot, requestedDate) {
  const requested = isoDate(requestedDate);
  const exact = balanceOnDate(snapshot.balanceHistory || [], requested);
  if (exact !== null) return { balance: exact, dateIso: requested };
  const prior = nearestPriorBalance(snapshot.balanceHistory || [], requested, 14);
  return prior ? { balance: prior.balance, dateIso: prior.dateIso } : null;
}

function computeSliceFactual(snapshot, sliceStart, sliceEnd) {
  const opening = balanceAtBoundary(snapshot, addDays(sliceStart, -1));
  const closing = balanceAtBoundary(snapshot, sliceEnd);
  if (!opening || !closing) {
    return {
      factual: 'no data',
      openingBalance: opening ? opening.balance : 'no data',
      closingBalance: closing ? closing.balance : 'no data'
    };
  }
  const flows = sumScheduledFlows(snapshot, opening.dateIso, closing.dateIso);
  const ledger = sumLedgerFlows(snapshot.ledger || [], opening.dateIso, closing.dateIso);
  const factual = opening.balance + flows.incomeSum - flows.obligationsSum - ledger.contributionsSum + ledger.withdrawalsSum - closing.balance;
  return {
    factual: round2(factual),
    openingBalance: round2(opening.balance),
    closingBalance: round2(closing.balance),
    openingAsOf: opening.dateIso,
    closingAsOf: closing.dateIso
  };
}

function latestHistoricalBalance(snapshot, throughDate) {
  const found = nearestPriorBalance(snapshot.balanceHistory || [], throughDate, Number.MAX_SAFE_INTEGER);
  if (!found) return null;
  const row = found.row;
  return {
    row,
    date: found.dateIso,
    alex: fromSatang(row.alex_balance_satang),
    olga: fromSatang(row.olga_balance_satang),
    combinedBalance: found.balance
  };
}

export function buildMissingClosedWeeklySnapshots(snapshot, cycleStart, nextSalaryDate, closedThrough) {
  const start = isoDate(cycleStart);
  const next = isoDate(nextSalaryDate);
  const through = isoDate(closedThrough || addDays(next, -1));
  if (!start || !next || compareDates(next, start) <= 0 || !through) return [];
  const cycleEnd = isoDate(addDays(next, -1));
  const latestEnd = latestSnapshotEnd(snapshot.weeklySnapshots || []);
  const cursor = latestEnd ? isoDate(addDays(latestEnd, 1)) : start;
  if (compareDates(cursor, cycleEnd) > 0 || compareDates(cursor, through) > 0) return [];

  const knownStarts = existingStarts(snapshot.weeklySnapshots || []);
  const oldCycleSnapshot = {
    ...snapshot,
    salaryCycle: {
      ...(snapshot.salaryCycle || {}),
      current_cycle_start: start,
      next_salary_date: next
    }
  };

  const rows = [];
  for (const card of enumerateCards(start, cycleEnd, cursor, through)) {
    const weekStart = isoDate(card.start);
    const weekEnd = isoDate(card.end);
    if (knownStarts.has(weekStart)) continue;
    const historicalBalance = latestHistoricalBalance(snapshot, weekEnd);
    const state = historicalBalance
      ? buildPlanningState(oldCycleSnapshot, weekEnd, { balanceRecord: historicalBalance, obligationPaymentsAsOf: weekEnd })
      : null;
    const activePlan = state?.guidanceAvailable ? Number(state.defaultPlan.activeVariablesPlan) || 22000 : 22000;
    const totalDays = state?.guidanceAvailable ? Number(state.salaryCycle.totalSpendingDays) || countInclusiveDays(card.start, card.end) : countInclusiveDays(card.start, card.end);
    const planned = round2(activePlan / totalDays * countInclusiveDays(card.start, card.end));
    const factual = computeSliceFactual(oldCycleSnapshot, card.start, card.end);
    const hasFactual = factual.factual !== 'no data';
    rows.push({
      household_id: snapshot.householdId || 'family',
      week_start: weekStart,
      week_end: weekEnd,
      planned_variables_satang: toSatang(planned),
      spent_variables_satang: hasFactual ? toSatang(factual.factual) : null,
      spent_variables_status: hasFactual ? null : 'no data',
      difference_satang: hasFactual ? toSatang(round2(factual.factual - planned)) : 0,
      opening_balance_satang: typeof factual.openingBalance === 'number' ? toSatang(factual.openingBalance) : null,
      opening_balance_status: typeof factual.openingBalance === 'number' ? null : 'no data',
      closing_balance_satang: typeof factual.closingBalance === 'number' ? toSatang(factual.closingBalance) : null,
      status: hasFactual ? 'closed' : 'no data'
    });
  }
  return rows;
}
