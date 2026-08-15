import { addDays, compareDates, isoDate, parseIsoDate } from './dates.mjs';

const usable = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const fromSatang = value => usable(value) ? Number(value) / 100 : null;

const REVISION_HISTORY_BASE = 1_000_000_000;
const revisionOrderedSources = new Set(['cloudflare', 'correction']);

// Imported Sheet rows use sheet_order. Cloudflare writes and audited corrections
// share a revision-derived source_row, which is the only chronology that remains
// valid across both historical ordering namespaces.
export function historyRowOrder(row) {
  const source = String(row?.source_sheet || '').trim().toLowerCase();
  const rawSourceRow = row?.source_row;
  const sourceRow = Number(rawSourceRow);
  if (revisionOrderedSources.has(source) && rawSourceRow !== null && rawSourceRow !== undefined && rawSourceRow !== '' && Number.isFinite(sourceRow)) {
    return REVISION_HISTORY_BASE + sourceRow;
  }
  const sheetOrder = Number(row?.sheet_order || 0);
  return Number.isFinite(sheetOrder) ? sheetOrder : 0;
}

export function latestUsableBalance(rows) {
  let selected = null;
  for (const row of rows || []) {
    if (!usable(row.alex_balance_satang) || !usable(row.olga_balance_satang) || !isoDate(row.business_date)) continue;
    if (!selected || compareDates(row.business_date, selected.business_date) > 0 ||
        (row.business_date === selected.business_date && historyRowOrder(row) > historyRowOrder(selected))) {
      selected = row;
    }
  }
  if (!selected) return null;
  const alex = fromSatang(selected.alex_balance_satang);
  const olga = fromSatang(selected.olga_balance_satang);
  return {
    row: selected,
    date: selected.business_date,
    alex,
    olga,
    combinedBalance: alex + olga
  };
}

export function balanceOnDate(rows, date) {
  const requested = isoDate(date);
  let selected = null;
  for (const row of rows || []) {
    if (row.business_date !== requested || !usable(row.alex_balance_satang) || !usable(row.olga_balance_satang)) continue;
    if (!selected || historyRowOrder(row) > historyRowOrder(selected)) selected = row;
  }
  if (!selected) return null;
  return fromSatang(selected.alex_balance_satang) + fromSatang(selected.olga_balance_satang);
}

export function nearestPriorBalance(rows, requestedDate, maxFallbackDays = 14) {
  const target = parseIsoDate(requestedDate);
  if (!target) return null;
  let selected = null;
  for (const row of rows || []) {
    if (!usable(row.alex_balance_satang) || !usable(row.olga_balance_satang)) continue;
    const date = parseIsoDate(row.business_date);
    if (!date || date > target) continue;
    const fallbackDays = Math.floor((target.getTime() - date.getTime()) / 86400000);
    if (fallbackDays > maxFallbackDays) continue;
    if (!selected || date > selected.date || (date.getTime() === selected.date.getTime() && historyRowOrder(row) > historyRowOrder(selected.row))) {
      selected = { date, row, fallbackDays };
    }
  }
  if (!selected) return null;
  return {
    dateIso: isoDate(selected.date),
    fallbackDays: selected.fallbackDays,
    balance: fromSatang(selected.row.alex_balance_satang) + fromSatang(selected.row.olga_balance_satang),
    row: selected.row
  };
}

export function balanceAtOrBefore(rows, requestedDate) {
  return nearestPriorBalance(rows, requestedDate, Number.MAX_SAFE_INTEGER);
}

export function manualReconciliationFreshness(rows, today) {
  const latest = latestUsableBalance(rows);
  let manual = null;
  for (const row of rows || []) {
    if (!isoDate(row.business_date) || !usable(row.alex_balance_satang) || !usable(row.olga_balance_satang)) continue;
    const isManual = !String(row.one_off_payment_name || '').trim() && !String(row.income_receipt_source || '').trim();
    if (!isManual) continue;
    if (!manual || compareDates(row.business_date, manual) > 0) manual = row.business_date;
  }
  const daysSinceManual = manual ? Math.max(Math.floor((parseIsoDate(today) - parseIsoDate(manual)) / 86400000), 0) : null;
  return {
    latestMovementDate: latest ? latest.date : null,
    latestManualReconciliationDate: manual,
    daysSinceManual
  };
}

export function openingBalanceForPeriod(rows, startDate) {
  const openingDate = isoDate(addDays(startDate, -1));
  const exact = balanceOnDate(rows, openingDate);
  if (exact !== null) return { balance: exact, dateIso: openingDate, fallbackDays: 0 };
  return nearestPriorBalance(rows, openingDate, 14);
}
