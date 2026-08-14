import { addDays, compareDates, isoDate, monthPeriod, parseIsoDate } from './dates.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const thb = satang => Number(satang || 0) / 100;

function dueDateForMonth(obligation, monthDate) {
  if (obligation.due_type === 'Payday') return null;
  if (obligation.due_type !== 'Day of month') return null;
  const day = Number(obligation.due_day || 0);
  if (!day) return null;
  const d = parseIsoDate(isoDate(monthDate));
  const maxDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = Math.min(Math.max(day, 1), maxDay);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), clamped));
}

export function enumerateObligationOccurrences(obligations, cycleStart, nextSalaryDate) {
  const start = parseIsoDate(cycleStart);
  const next = parseIsoDate(nextSalaryDate);
  const end = addDays(next, -1);
  if (!start || !next || next <= start) return [];
  const occurrences = [];

  for (const obligation of obligations || []) {
    const name = String(obligation.name || '').trim();
    if (!name) continue;
    if (obligation.due_type === 'Payday') {
      occurrences.push({ obligation, name, dueDate: new Date(start) });
      continue;
    }
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const finalMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= finalMonth) {
      const due = dueDateForMonth(obligation, cursor);
      if (due && due >= start && due <= end) occurrences.push({ obligation, name, dueDate: due });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
  }

  return occurrences.sort((a, b) => a.dueDate - b.dueDate || a.name.localeCompare(b.name));
}

function buildPaymentIndex(snapshot, asOfDate) {
  const index = new Map();
  const limit = isoDate(asOfDate);
  for (const payment of snapshot.obligationPayments || []) {
    const paymentDate = isoDate(payment.payment_date);
    if (!paymentDate || (limit && paymentDate > limit)) continue;
    const name = String(payment.obligation_name || '').trim();
    const dueDate = isoDate(payment.occurrence_due_date);
    if (!name || !dueDate) continue;
    const key = `${name}|${dueDate}`;
    const entry = index.get(key) || { paid: 0, final: false };
    entry.paid += thb(payment.actual_amount_satang);
    const status = String(payment.payment_status || '').trim().toLowerCase();
    const obligation = (snapshot.obligations || []).find(item => item.name === name);
    const variable = String(obligation?.amount_type || '').toLowerCase() === 'variable';
    if (status === 'final' || (!status && variable)) entry.final = true;
    index.set(key, entry);
  }
  return index;
}

export function remainingFixedObligations(snapshot, onDate, paymentsAsOfDate) {
  const cycle = snapshot.salaryCycle || {};
  const cycleStart = isoDate(cycle.current_cycle_start);
  const nextSalaryDate = isoDate(cycle.next_salary_date);
  if (!cycleStart || !nextSalaryDate || compareDates(nextSalaryDate, cycleStart) <= 0) {
    return { period: null, items: [], remainingItems: [], total: 0, cycleUnavailable: true, error: 'Salary cycle is unavailable.' };
  }

  const paymentIndex = buildPaymentIndex(snapshot, paymentsAsOfDate || onDate);
  const cutoverPeriod = String(snapshot.config?.obligation_payments_cutover_period || '').slice(0, 7);
  const migrationPaidPeriod = String(snapshot.salaryCycle?.salary_receipt_cutover_date || snapshot.config?.salary_receipt_cutover_date || '').slice(0, 7);
  const occurrences = enumerateObligationOccurrences(snapshot.obligations || [], cycleStart, nextSalaryDate);

  const items = occurrences.map(({ obligation, name, dueDate }) => {
    const due = isoDate(dueDate);
    const expected = thb(obligation.expected_amount_satang);
    const amountType = String(obligation.amount_type || '').toLowerCase() === 'variable' ? 'Variable' : 'Fixed';
    const payment = paymentIndex.get(`${name}|${due}`) || { paid: 0, final: false };
    let paid = round2(payment.paid || 0);
    let legacyPaid = false;
    const period = monthPeriod(due);
    const legacyFlagApplies = Number(obligation.legacy_paid_this_month || 0) === 1 &&
      ((cutoverPeriod && period === cutoverPeriod) || (migrationPaidPeriod && period === migrationPaidPeriod));
    if (paid === 0 && legacyFlagApplies) {
      paid = expected;
      legacyPaid = true;
    }
    const finalVariable = amountType === 'Variable' && payment.final === true;
    const remaining = finalVariable ? 0 : round2(Math.max(expected - paid, 0));
    let status;
    if (remaining <= 0) status = 'Paid';
    else if (paid > 0) status = 'Partially paid';
    else if (due < isoDate(onDate)) status = 'Overdue';
    else if (due === isoDate(onDate)) status = 'Due today';
    else status = 'Upcoming';
    return {
      name,
      expectedAmount: round2(expected),
      paidAmount: round2(paid),
      remainingAmount: remaining,
      amountType,
      isFinalPayment: finalVariable,
      estimateDifference: amountType === 'Variable' && finalVariable ? round2(expected - paid) : null,
      dueType: obligation.due_type,
      dueDay: obligation.due_day,
      dueDate: due,
      occurrenceKey: `${name}|${due}`,
      status,
      legacyPaid
    };
  });

  const remainingItems = items.filter(item => item.remainingAmount > 0);
  return {
    period: `${cycleStart}..${isoDate(addDays(nextSalaryDate, -1))}`,
    items,
    remainingItems,
    total: round2(remainingItems.reduce((sum, item) => sum + item.remainingAmount, 0)),
    cycleUnavailable: false
  };
}
