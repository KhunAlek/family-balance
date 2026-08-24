import { addDays, countInclusiveDays, getWeekBounds, isoDate, maxDate, minDate, parseIsoDate } from './dates.mjs';
import { balanceOnDate, latestUsableBalance, nearestPriorBalance } from './balances.mjs';
import { sumLedgerFlows, sumScheduledFlows } from './flows.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const thb = satang => Number(satang || 0) / 100;

function computeSliceFactual(snapshot, sliceStart, sliceEnd) {
  const openingDate = isoDate(addDays(sliceStart, -1));
  const closingDate = isoDate(sliceEnd);
  let opening = balanceOnDate(snapshot.balanceHistory || [], openingDate);
  let openingAsOf = openingDate;
  if (opening === null) {
    const fallback = nearestPriorBalance(snapshot.balanceHistory || [], openingDate, 14);
    if (fallback) { opening = fallback.balance; openingAsOf = fallback.dateIso; }
  }
  let closing = balanceOnDate(snapshot.balanceHistory || [], closingDate);
  let closingAsOf = closingDate;
  if (closing === null) {
    const fallback = nearestPriorBalance(snapshot.balanceHistory || [], closingDate, 14);
    if (fallback) { closing = fallback.balance; closingAsOf = fallback.dateIso; }
  }
  if (opening === null || closing === null) {
    return { factual: 'no data', openingBalance: opening === null ? 'no data' : opening, closingBalance: closing === null ? 'no data' : closing };
  }
  const flows = sumScheduledFlows(snapshot, openingAsOf, closingAsOf);
  const ledger = sumLedgerFlows(snapshot.ledger || [], openingAsOf, closingAsOf);
  const factual = opening + flows.incomeSum - flows.obligationsSum - ledger.contributionsSum + ledger.withdrawalsSum - closing;
  return { factual: round2(factual), openingBalance: opening, closingBalance: closing, openingAsOf, closingAsOf };
}

function computeCurrentSliceState(snapshot, sliceStart) {
  const openingDate = isoDate(addDays(sliceStart, -1));
  let opening = balanceOnDate(snapshot.balanceHistory || [], openingDate);
  let openingAsOf = openingDate;
  if (opening === null) {
    const fallback = nearestPriorBalance(snapshot.balanceHistory || [], openingDate, 14);
    if (!fallback) return { spent: 'no data', asOfDate: null };
    opening = fallback.balance;
    openingAsOf = fallback.dateIso;
  }
  const latest = latestUsableBalance(snapshot.balanceHistory || []);
  if (!latest) return { spent: 'no data', asOfDate: null };
  if (latest.date < isoDate(sliceStart)) return { spent: 0, asOfDate: latest.date };
  const flows = sumScheduledFlows(snapshot, openingAsOf, latest.date);
  const ledger = sumLedgerFlows(snapshot.ledger || [], openingAsOf, latest.date);
  const spent = opening + flows.incomeSum - flows.obligationsSum - ledger.contributionsSum + ledger.withdrawalsSum - latest.combinedBalance;
  return { spent: round2(spent), asOfDate: latest.date };
}

export function computeWeeklyVariablesCards(snapshot, onDate, planningState) {
  const cycleStartIso = planningState.salaryCycle?.cycleStart;
  const cycleEndIso = planningState.salaryCycle?.cycleEnd;
  if (!cycleStartIso || !cycleEndIso) return [];
  const cycleStart = parseIsoDate(cycleStartIso);
  const cycleEnd = parseIsoDate(cycleEndIso);
  const target = planningState.variables?.target;
  const totalDays = Number(planningState.salaryCycle.totalSpendingDays) || countInclusiveDays(cycleStart, cycleEnd);

  const ranges = [];
  let pos = new Date(cycleStart);
  while (pos <= cycleEnd) {
    const bounds = getWeekBounds(pos);
    const start = maxDate(bounds.start, cycleStart);
    const end = minDate(bounds.end, cycleEnd);
    ranges.push({ start, end });
    pos = addDays(end, 1);
  }

  const snapshots = new Map();
  for (const row of snapshot.weeklySnapshots || []) snapshots.set(`${row.week_start}|${row.week_end}`, row);

  return ranges.map(cardRange => {
    const start = isoDate(cardRange.start);
    const end = isoDate(cardRange.end);
    const isClosed = end < isoDate(onDate);
    const isCurrent = start <= isoDate(onDate) && isoDate(onDate) <= end;
    const planned = target === null || target === undefined ? null : round2(Number(target) / totalDays * countInclusiveDays(start, end));
    const card = { weekStart: start, weekEnd: end, cardStart: start, cardEnd: end, isClosed, isCurrent, planned };

    if (isClosed) {
      const frozen = snapshots.get(`${start}|${end}`);
      if (frozen) {
        card.planned = frozen.planned_variables_satang === null || frozen.planned_variables_satang === undefined ? null : thb(frozen.planned_variables_satang);
        card.spent = frozen.spent_variables_satang === null ? (frozen.spent_variables_status || 'no data') : thb(frozen.spent_variables_satang);
        card.difference = frozen.difference_satang === null || frozen.difference_satang === undefined ? null : thb(frozen.difference_satang);
        card.provisional = false;
      } else {
        const factual = computeSliceFactual(snapshot, start, end);
        card.spent = factual.factual;
        card.difference = factual.factual === 'no data' || planned === null ? null : round2(Number(factual.factual) - planned);
        card.provisional = true;
      }
      return card;
    }

    if (isCurrent) {
      const current = computeCurrentSliceState(snapshot, start);
      card.spent = current.spent;
      card.spentAsOf = current.asOfDate;
      card.difference = current.spent === 'no data' || planned === null ? null : round2(Number(current.spent) - planned);
    } else {
      card.spent = null;
      card.difference = null;
    }
    return card;
  });
}
