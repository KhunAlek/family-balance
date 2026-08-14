import { isLastDayOfMonth, iterateDatesExclusiveInclusive, isoDate, monthPeriod } from './dates.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const thb = satang => Number(satang || 0) / 100;

export function sumIncomeReceipts(receipts, fromDate, toDate) {
  let total = 0;
  for (const receipt of receipts || []) {
    const date = isoDate(receipt.business_date);
    if (!date || date <= isoDate(fromDate) || date > isoDate(toDate)) continue;
    total += thb(receipt.amount_satang);
  }
  return round2(total);
}

export function sumLedgerFlows(entries, fromDate, toDate) {
  let contributionsSum = 0;
  let withdrawalsSum = 0;
  for (const entry of entries || []) {
    const date = isoDate(entry.business_date);
    if (!date || date <= isoDate(fromDate) || date > isoDate(toDate)) continue;
    const amount = thb(entry.amount_satang);
    if (entry.direction === 'Contribution') contributionsSum += amount;
    else if (entry.direction === 'Withdrawal') withdrawalsSum += amount;
  }
  return { contributionsSum: round2(contributionsSum), withdrawalsSum: round2(withdrawalsSum) };
}

export function sumScheduledFlows(snapshot, fromDate, toDate) {
  const obligations = snapshot.obligations || [];
  const income = snapshot.incomeDefinitions || [];
  const payments = snapshot.obligationPayments || [];
  const cutoverPeriod = String(snapshot.config?.obligation_payments_cutover_period || '').slice(0, 7);
  const salaryCutoverDate = isoDate(snapshot.salaryCycle?.salary_receipt_cutover_date || snapshot.config?.salary_receipt_cutover_date);
  const migrationPaidPeriod = salaryCutoverDate ? salaryCutoverDate.slice(0, 7) : '';
  let incomeSum = sumIncomeReceipts(snapshot.incomeReceipts || [], fromDate, toDate);
  let obligationsSum = 0;
  const actualByDate = new Map();
  const actualByObligationPeriod = new Map();

  for (const payment of payments) {
    const date = isoDate(payment.payment_date);
    if (!date || date > isoDate(toDate)) continue;
    const amount = thb(payment.actual_amount_satang);
    const name = String(payment.obligation_name || '').trim();
    const period = String(payment.period || date).slice(0, 7);
    actualByDate.set(date, (actualByDate.get(date) || 0) + amount);
    const key = `${period}|${name}`;
    actualByObligationPeriod.set(key, (actualByObligationPeriod.get(key) || 0) + amount);
  }

  for (const dateObj of iterateDatesExclusiveInclusive(fromDate, toDate)) {
    const date = isoDate(dateObj);
    const period = monthPeriod(date);
    const day = dateObj.getUTCDate();

    if ((!salaryCutoverDate || date < salaryCutoverDate) && isLastDayOfMonth(date)) {
      for (const definition of income) {
        if (definition.pay_day === 'Last office day') incomeSum += thb(definition.expected_amount_satang);
      }
    }

    obligationsSum += actualByDate.get(date) || 0;
    for (const obligation of obligations) {
      const name = String(obligation.name || '').trim();
      const hasActualThisMonth = (actualByObligationPeriod.get(`${period}|${name}`) || 0) > 0;
      if (hasActualThisMonth) continue;
      const scheduledToday =
        (obligation.due_type === 'Day of month' && Number(obligation.due_day) === day) ||
        (obligation.due_type === 'Payday' && isLastDayOfMonth(date));
      if (!scheduledToday) continue;
      const legacyPeriod = !cutoverPeriod || period < cutoverPeriod;
      const paidFlag = Number(obligation.legacy_paid_this_month || 0) === 1;
      const migrationLegacyPaid = period === migrationPaidPeriod && paidFlag;
      const cutoverLegacyPaid = period === cutoverPeriod && paidFlag;
      if (legacyPeriod || migrationLegacyPaid || cutoverLegacyPaid) obligationsSum += thb(obligation.expected_amount_satang);
    }
  }

  return { incomeSum: round2(incomeSum), obligationsSum: round2(obligationsSum) };
}
