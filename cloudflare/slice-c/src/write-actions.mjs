import { FinancialWriteValidationError, statement } from './write-protocol.mjs';
import { bangkokBusinessDate, compareDates, isoDate, monthPeriod } from '../../slice-b/src/dates.mjs';
import { latestUsableBalance, manualReconciliationFreshness } from '../../slice-b/src/balances.mjs';
import { buildPlanningState } from '../../slice-b/src/planning.mjs';
import { accountLedgerBalance } from '../../slice-b/src/ef-goals.mjs';
import { enumerateObligationOccurrences } from '../../slice-b/src/obligations.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const toSatang = value => Math.round((Number(value) + Number.EPSILON) * 100);
const fromSatang = value => Number(value || 0) / 100;
const finite = value => Number.isFinite(Number(value));

function fail(message, details = {}) {
  const error = new FinancialWriteValidationError(message);
  Object.assign(error, details);
  throw error;
}

function positiveAmount(value, label = 'Amount') {
  const n = round2(Number(value));
  if (!Number.isFinite(n) || n <= 0) fail(`${label} must be greater than zero.`);
  return n;
}

function nonNegativeAmount(value, label = 'Amount') {
  const n = round2(Number(value));
  if (!Number.isFinite(n) || n < 0) fail(`${label} must be zero or positive.`);
  return n;
}

function normalizeAccount(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'alex' || v === 'alex ktb') return 'Alex';
  if (v === 'olga' || v === 'olga ktb') return 'Olga';
  return null;
}

function requireIsoDate(value, message) {
  const date = isoDate(value);
  if (!date) fail(message || 'A valid transaction date is required.');
  return date;
}

function recordAtOrBefore(rows, requestedDate) {
  const target = requireIsoDate(requestedDate);
  let selected = null;
  for (const row of rows || []) {
    const date = isoDate(row.business_date);
    if (!date || date > target) continue;
    if (!finite(row.alex_balance_satang) || !finite(row.olga_balance_satang)) continue;
    if (!selected || date > selected.business_date ||
        (date === selected.business_date && Number(row.sheet_order || 0) > Number(selected.sheet_order || 0))) selected = row;
  }
  return selected;
}

function balanceView(row) {
  if (!row) return null;
  return {
    row,
    date: row.business_date,
    alex: fromSatang(row.alex_balance_satang),
    olga: fromSatang(row.olga_balance_satang),
    combinedBalance: fromSatang(row.alex_balance_satang) + fromSatang(row.olga_balance_satang)
  };
}

function validateMovementDate(value, snapshot, nowIso) {
  const date = requireIsoDate(value || bangkokBusinessDate(new Date(nowIso)), 'A valid transaction date is required.');
  const today = bangkokBusinessDate(new Date(nowIso));
  if (date > today) fail('Transaction date cannot be in the future.');
  const latest = latestUsableBalance(snapshot.balanceHistory || []);
  if (!latest) fail('Latest account balances are unavailable.');
  if (date < latest.date) fail('Transaction date cannot be earlier than the latest saved balance.');
  return { date, latest };
}

function sourceIdentity(ctx, sequence) {
  // New Cloudflare-origin records use a revision-derived namespace so imported
  // sheet source rows and later writes can never collide.
  return {
    sheetOrder: 1_000_000_000 + ctx.nextRevision * 100 + sequence,
    sourceRow: ctx.nextRevision * 100 + sequence
  };
}

function balanceInsert(ctx, sequence, values) {
  const id = sourceIdentity(ctx, sequence);
  return statement(
    `INSERT INTO balance_history(
      household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,
      one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,
      income_receipt_source,income_receipt_amount_satang,source_sheet,source_row
    ) VALUES(?,?,?,?,?,?,?,?,?,?,'Cloudflare',?)`,
    ctx.householdId,
    values.date,
    id.sheetOrder,
    toSatang(values.alex),
    toSatang(values.olga),
    values.oneOffName || null,
    values.oneOffAmount === null || values.oneOffAmount === undefined || values.oneOffAmount === '' ? null : toSatang(values.oneOffAmount),
    values.oneOffAccount || null,
    values.incomeSource || null,
    values.incomeAmount === null || values.incomeAmount === undefined || values.incomeAmount === '' ? null : toSatang(values.incomeAmount),
    id.sourceRow
  );
}

function ledgerInsert(ctx, sequence, { date, account, direction, amount }) {
  const id = sourceIdentity(ctx, sequence);
  return statement(
    `INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row)
     VALUES(?,?,?,?,?,?,'Cloudflare',?)`,
    ctx.householdId,
    date,
    id.sheetOrder,
    account,
    direction,
    toSatang(amount),
    id.sourceRow
  );
}

function configuredIncome(snapshot, source) {
  return (snapshot.incomeDefinitions || []).find(item => String(item.source || '').trim() === source) || null;
}

function salarySources(snapshot) {
  return new Set((snapshot.incomeDefinitions || [])
    .filter(item => String(item.pay_day || '').trim() !== 'Variable')
    .map(item => String(item.source || '').trim()));
}

function receivedSalarySourcesInCurrentCycle(snapshot) {
  const start = isoDate(snapshot.salaryCycle?.current_cycle_start);
  if (!start) return new Set();
  const salaries = salarySources(snapshot);
  return new Set((snapshot.incomeReceipts || [])
    .filter(item => salaries.has(String(item.source || '').trim()) && isoDate(item.business_date) >= start)
    .map(item => String(item.source || '').trim()));
}

function salaryTransition(snapshot, receiptDate, source) {
  if (!salarySources(snapshot).has(source)) return { salary: false, advanced: false };
  const currentStart = isoDate(snapshot.salaryCycle?.current_cycle_start);
  const nextSalary = isoDate(snapshot.salaryCycle?.next_salary_date);
  if (!currentStart) return { salary: true, advanced: true, newCycleStart: receiptDate };
  const received = receivedSalarySourcesInCurrentCycle(snapshot);
  if (receiptDate <= currentStart) return { salary: true, advanced: false, cycleStart: currentStart };
  const sourceAlreadyReceived = received.has(source);
  const reachedExpectedBoundary = !!nextSalary && receiptDate >= nextSalary;
  if (!sourceAlreadyReceived && !reachedExpectedBoundary) return { salary: true, advanced: false, cycleStart: currentStart };
  return { salary: true, advanced: true, newCycleStart: receiptDate };
}

function planBalanceCheck(ctx) {
  const { snapshot, payload } = ctx;
  const date = requireIsoDate(payload.date || bangkokBusinessDate(new Date(ctx.nowIso)), 'A valid balance date is required.');
  const alexProvided = payload.alexBalance !== '' && payload.alexBalance !== null && payload.alexBalance !== undefined;
  const olgaProvided = payload.olgaBalance !== '' && payload.olgaBalance !== null && payload.olgaBalance !== undefined;
  if (!alexProvided && !olgaProvided) fail('Enter a new balance for Alex, Olga, or both.');
  const alexInput = alexProvided ? nonNegativeAmount(payload.alexBalance, 'Alex balance') : null;
  const olgaInput = olgaProvided ? nonNegativeAmount(payload.olgaBalance, 'Olga balance') : null;
  const previous = recordAtOrBefore(snapshot.balanceHistory || [], date);
  const alex = alexProvided ? alexInput : (previous ? fromSatang(previous.alex_balance_satang) : null);
  const olga = olgaProvided ? olgaInput : (previous ? fromSatang(previous.olga_balance_satang) : null);
  if (alex === null || olga === null) fail('The other account has no saved balance on or before this date. Enter both balances.');
  return {
    statements: [balanceInsert(ctx, 1, { date, alex, olga, oneOffName: payload.oneOffName, oneOffAmount: payload.oneOffAmount, oneOffAccount: payload.oneOffAccount })],
    response: { balances: { alex: round2(alex), olga: round2(olga), asOf: date } }
  };
}

function planIncomeReceipt(ctx) {
  const { snapshot, payload } = ctx;
  const alexAmount = nonNegativeAmount(payload.incomeAlexAmount || 0, 'Amounts');
  const olgaAmount = nonNegativeAmount(payload.incomeOlgaAmount || 0, 'Amounts');
  const total = round2(alexAmount + olgaAmount);
  if (total <= 0) fail('At least one account amount must be greater than zero.');
  const source = String(payload.incomeSource || '').trim();
  if (!source) fail('Income source is required.');
  if (!configuredIncome(snapshot, source)) fail('Income source is not configured.');
  const movement = validateMovementDate(payload.date, snapshot, ctx.nowIso);
  let alex = movement.latest.alex;
  let olga = movement.latest.olga;
  const statements = [];
  let seq = 1;
  if (alexAmount > 0) {
    alex = round2(alex + alexAmount);
    const identity = sourceIdentity(ctx, seq);
    statements.push(balanceInsert(ctx, seq, { date: movement.date, alex, olga, incomeSource: source, incomeAmount: alexAmount }));
    statements.push(statement(
      `INSERT INTO income_receipts(receipt_id,household_id,source,business_date,amount_satang,lands_in,source_balance_row_id)
       VALUES(?,?,?,?,?,?,(SELECT balance_row_id FROM balance_history WHERE household_id=? AND source_sheet='Cloudflare' AND source_row=?))`,
      `${ctx.writeToken}:income:alex`, ctx.householdId, source, movement.date, toSatang(alexAmount), 'Alex KTB', ctx.householdId, identity.sourceRow
    ));
    seq += 1;
  }
  if (olgaAmount > 0) {
    olga = round2(olga + olgaAmount);
    const identity = sourceIdentity(ctx, seq);
    statements.push(balanceInsert(ctx, seq, { date: movement.date, alex, olga, incomeSource: source, incomeAmount: olgaAmount }));
    statements.push(statement(
      `INSERT INTO income_receipts(receipt_id,household_id,source,business_date,amount_satang,lands_in,source_balance_row_id)
       VALUES(?,?,?,?,?,?,(SELECT balance_row_id FROM balance_history WHERE household_id=? AND source_sheet='Cloudflare' AND source_row=?))`,
      `${ctx.writeToken}:income:olga`, ctx.householdId, source, movement.date, toSatang(olgaAmount), 'Olga KTB', ctx.householdId, identity.sourceRow
    ));
    seq += 1;
  }
  const transition = salaryTransition(snapshot, movement.date, source);
  if (transition.advanced) {
    statements.push(statement(
      'UPDATE salary_cycle_state SET current_cycle_start=?,next_salary_date=NULL WHERE household_id=?',
      transition.newCycleStart,
      ctx.householdId
    ));
  }
  return {
    statements,
    response: {
      date: movement.date,
      alexBalance: alex,
      olgaBalance: olga,
      source,
      totalAmount: total,
      salaryCycleAdvanced: !!transition.advanced,
      nextSalaryDateRequired: !!transition.advanced
    }
  };
}

function planSetNextSalaryDate(ctx) {
  const date = requireIsoDate(ctx.payload.nextSalaryDate, 'A valid next salary date is required.');
  const start = isoDate(ctx.snapshot.salaryCycle?.current_cycle_start);
  if (!start) fail('Current salary-cycle start is not configured.');
  if (compareDates(date, start) <= 0) fail('Next salary date must be after the current salary-cycle start.');
  return {
    statements: [statement('UPDATE salary_cycle_state SET next_salary_date=? WHERE household_id=?', date, ctx.householdId)],
    response: { currentCycleStart: start, nextSalaryDate: date }
  };
}

function planEFWithdrawal(ctx) {
  const amount = positiveAmount(ctx.payload.amount, 'Withdrawal amount');
  const destination = normalizeAccount(ctx.payload.destinationAccount);
  if (!destination) fail('Choose Alex KTB or Olga KTB.');
  const movement = validateMovementDate(ctx.payload.date, ctx.snapshot, ctx.nowIso);
  const efBalance = accountLedgerBalance(ctx.snapshot.ledger || [], 'EF');
  if (amount > efBalance + 0.001) fail('Withdrawal amount exceeds the Emergency Fund balance.');
  let alex = movement.latest.alex;
  let olga = movement.latest.olga;
  if (destination === 'Alex') alex = round2(alex + amount); else olga = round2(olga + amount);
  return {
    statements: [
      ledgerInsert(ctx, 1, { date: movement.date, account: 'EF', direction: 'Withdrawal', amount }),
      balanceInsert(ctx, 2, { date: movement.date, alex, olga, oneOffName: 'Withdraw from EF', oneOffAmount: amount, oneOffAccount: destination })
    ],
    response: { amount, destination, efBalance: round2(efBalance - amount), balances: { alex, olga } }
  };
}

function planKTBTransfer(ctx) {
  const amount = positiveAmount(ctx.payload.amount, 'Transfer amount');
  const source = normalizeAccount(ctx.payload.sourceAccount);
  const destination = normalizeAccount(ctx.payload.destinationAccount);
  if (!source || !destination || source === destination) fail('Choose two different KTB accounts.');
  const movement = validateMovementDate(ctx.payload.date, ctx.snapshot, ctx.nowIso);
  let alex = movement.latest.alex;
  let olga = movement.latest.olga;
  if (source === 'Alex') {
    if (amount > alex + 0.001) fail('Transfer amount exceeds Alex KTB balance.');
    alex = round2(alex - amount); olga = round2(olga + amount);
  } else {
    if (amount > olga + 0.001) fail('Transfer amount exceeds Olga KTB balance.');
    olga = round2(olga - amount); alex = round2(alex + amount);
  }
  return {
    statements: [balanceInsert(ctx, 1, { date: movement.date, alex, olga, oneOffName: `KTB transfer ${source} to ${destination}` })],
    response: { amount, source, destination, balances: { alex, olga }, combined: round2(alex + olga) }
  };
}

function planAddGoal(ctx) {
  const name = String(ctx.payload.name || '').trim();
  const targetAmount = positiveAmount(ctx.payload.targetAmount, 'Target amount');
  if (!name) fail('name and targetAmount are required.');
  if ((ctx.snapshot.goals || []).some(goal => String(goal.name || '').trim() === name)) fail(`Goal already exists: ${name}`);
  const fallbackRank = (ctx.snapshot.goals || []).length + 1;
  const rank = Number(ctx.payload.priorityRank || fallbackRank);
  if (!Number.isInteger(rank) || rank <= 0) fail('Priority rank must be a positive whole number.');
  const targetDate = ctx.payload.targetDate ? requireIsoDate(ctx.payload.targetDate, 'Target date must be a valid date.') : null;
  return {
    statements: [statement(
      'INSERT INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES(?,?,?,?,?,?)',
      ctx.householdId, name, toSatang(targetAmount), rank, 'active', targetDate
    )],
    response: { goal: { name, targetAmount, priorityRank: rank, status: 'active', targetDate } }
  };
}

function planDedicatedTransfer(ctx) {
  const amount = positiveAmount(ctx.payload.amount, 'Transfer amount');
  const source = normalizeAccount(ctx.payload.sourceAccount);
  if (!source) fail('Choose Alex KTB or Olga KTB.');
  const destinationType = String(ctx.payload.destinationType || '').trim();
  if (destinationType !== 'EF' && destinationType !== 'Goal') fail('Transfer destination must be EF or Goal.');
  const destinationName = destinationType === 'EF' ? 'EF' : String(ctx.payload.destinationName || '').trim();
  if (destinationType === 'Goal' && !(ctx.snapshot.goals || []).some(goal => goal.name === destinationName && String(goal.status || '').toLowerCase() !== 'done')) fail('Active goal not found.');
  const movement = validateMovementDate(ctx.payload.date, ctx.snapshot, ctx.nowIso);
  const state = buildPlanningState(ctx.snapshot, movement.date);
  if (!state.guidanceAvailable) fail(state.guidanceError || 'Safety guidance is unavailable.');
  let safeLimit = 0;
  if (destinationType === 'EF') safeLimit = Number(state.emergencyFund.availableNow) || 0;
  else {
    const allocation = (state.goalPreviewPlan.goalAllocations || []).find(item => item.name === destinationName);
    safeLimit = allocation ? Number(allocation.previewAllocation) || 0 : 0;
  }
  if (amount > round2(safeLimit) + 0.001) fail(`This transfer is above the current safe limit of ${round2(safeLimit)} THB.`);
  let alex = movement.latest.alex;
  let olga = movement.latest.olga;
  if (source === 'Alex') {
    if (amount > alex + 0.001) fail('Transfer amount exceeds Alex KTB balance.');
    alex = round2(alex - amount);
  } else {
    if (amount > olga + 0.001) fail('Transfer amount exceeds Olga KTB balance.');
    olga = round2(olga - amount);
  }
  return {
    statements: [
      ledgerInsert(ctx, 1, { date: movement.date, account: destinationName, direction: 'Contribution', amount }),
      balanceInsert(ctx, 2, {
        date: movement.date,
        alex,
        olga,
        oneOffName: destinationType === 'EF' ? 'Transfer to EF' : `Transfer to Goal: ${destinationName}`,
        oneOffAmount: amount,
        oneOffAccount: source
      })
    ],
    response: { destination: destinationName, amount, balances: { alex, olga } }
  };
}

function occurrenceExists(snapshot, name, dueDate) {
  const start = isoDate(snapshot.salaryCycle?.current_cycle_start);
  const next = isoDate(snapshot.salaryCycle?.next_salary_date);
  if (!start || !next) return false;
  return enumerateObligationOccurrences(snapshot.obligations || [], start, next)
    .some(item => item.name === name && isoDate(item.dueDate) === dueDate);
}

function planObligationPayment(ctx) {
  const name = String(ctx.payload.obligationName || '').trim();
  const obligation = (ctx.snapshot.obligations || []).find(item => String(item.name || '').trim() === name);
  if (!obligation) fail('Obligation not found.');
  const amount = positiveAmount(ctx.payload.amount, 'Payment amount');
  const source = normalizeAccount(ctx.payload.sourceAccount);
  if (!source) fail('Choose Alex KTB or Olga KTB.');
  const movement = validateMovementDate(ctx.payload.date, ctx.snapshot, ctx.nowIso);
  let dueDate = isoDate(ctx.payload.occurrenceDueDate);
  if (!dueDate) {
    const occurrences = enumerateObligationOccurrences(ctx.snapshot.obligations || [], ctx.snapshot.salaryCycle?.current_cycle_start, ctx.snapshot.salaryCycle?.next_salary_date)
      .filter(item => item.name === name);
    if (occurrences.length === 1) dueDate = isoDate(occurrences[0].dueDate);
  }
  if (!dueDate || !occurrenceExists(ctx.snapshot, name, dueDate)) fail('Choose the obligation occurrence being paid.');
  let alex = movement.latest.alex;
  let olga = movement.latest.olga;
  if (source === 'Alex') {
    if (amount > alex + 0.001) fail('Transfer amount exceeds Alex KTB balance.');
    alex = round2(alex - amount);
  } else {
    if (amount > olga + 0.001) fail('Transfer amount exceeds Olga KTB balance.');
    olga = round2(olga - amount);
  }
  const amountType = String(obligation.amount_type || '').toLowerCase() === 'variable' ? 'Variable' : 'Fixed';
  const paymentStatus = amountType === 'Variable'
    ? (String(ctx.payload.paymentStatus || 'Final').trim().toLowerCase() === 'partial' ? 'Partial' : 'Final')
    : 'Partial';
  const expected = fromSatang(obligation.expected_amount_satang);
  return {
    statements: [
      statement(
        `INSERT INTO obligation_payments(payment_id,household_id,obligation_name,period,payment_date,occurrence_due_date,
          expected_amount_satang,actual_amount_satang,paid_from,balance_adjusted,payment_status,note)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        `${ctx.writeToken}:obligation`, ctx.householdId, name, monthPeriod(dueDate), movement.date, dueDate,
        toSatang(expected), toSatang(amount), source, 1, paymentStatus, String(ctx.payload.note || '').trim() || null
      ),
      balanceInsert(ctx, 1, { date: movement.date, alex, olga, oneOffName: `Fixed obligation: ${name}`, oneOffAmount: amount, oneOffAccount: source })
    ],
    response: { obligationName: name, occurrenceDueDate: dueDate, amount, paymentStatus, balances: { alex, olga } }
  };
}

export function buildOneOffPaymentPreview(snapshot, payload, nowIso = new Date().toISOString()) {
  const date = requireIsoDate(payload.date || bangkokBusinessDate(new Date(nowIso)), 'A valid payment date is required.');
  const alexAmount = Math.max(round2(Number(payload.oneOffAlexAmount) || 0), 0);
  const olgaAmount = Math.max(round2(Number(payload.oneOffOlgaAmount) || 0), 0);
  const total = round2(alexAmount + olgaAmount);
  if (total <= 0) fail('Enter a positive payment amount.');
  const latestNow = latestUsableBalance(snapshot.balanceHistory || []);
  if (!latestNow) fail('No account balance is available.');
  const today = bangkokBusinessDate(new Date(nowIso));
  let recordableNow = true;
  let recordabilityError = null;
  if (date > today) { recordableNow = false; recordabilityError = 'Transaction date cannot be in the future.'; }
  else if (date < latestNow.date) { recordableNow = false; recordabilityError = 'Transaction date cannot be earlier than the latest saved balance.'; }
  const previewRow = date < latestNow.date ? recordAtOrBefore(snapshot.balanceHistory || [], date) : latestNow.row;
  const previewBalance = balanceView(previewRow);
  if (!previewBalance) fail('No account balance is available on or before the entered payment date.');
  const state = buildPlanningState(snapshot, date, { balanceRecord: previewBalance, obligationPaymentsAsOf: date });
  if (!state.guidanceAvailable) {
    return { ok: true, guidanceAvailable: false, error: state.guidanceError, paymentAmount: total, date, recordableNow, recordabilityError };
  }
  const safeCapacity = round2(Math.max(Number(state.cash.safeDiscretionaryKTB) || 0, 0));
  const safePortion = round2(Math.min(total, safeCapacity));
  const efRequired = round2(total - safePortion);
  const alex = previewBalance.alex;
  const olga = previewBalance.olga;
  const alexShort = Math.max(alexAmount - alex, 0);
  const olgaShort = Math.max(olgaAmount - olga, 0);
  const combined = alex + olga;
  const efBalance = Number(state.emergencyFund.currentBalance) || 0;
  const impossible = efRequired > efBalance + 0.001;
  let efToAlex = 0, efToOlga = 0, efLeft = efRequired;
  if (efLeft > 0) {
    const fillAlex = Math.min(alexShort, efLeft); efToAlex += fillAlex; efLeft -= fillAlex;
    const fillOlga = Math.min(olgaShort, efLeft); efToOlga += fillOlga; efLeft -= fillOlga;
    if (efLeft > 0) {
      if (alexAmount >= olgaAmount && alexAmount > 0) efToAlex += efLeft;
      else efToOlga += efLeft;
    }
  }
  efToAlex = round2(efToAlex); efToOlga = round2(efToOlga);
  let alexAfterEF = alex + efToAlex;
  let olgaAfterEF = olga + efToOlga;
  const alexResidualShort = Math.max(alexAmount - alexAfterEF, 0);
  const olgaResidualShort = Math.max(olgaAmount - olgaAfterEF, 0);
  let transfer = null;
  if (alexResidualShort > 0 && olgaAfterEF - olgaAmount >= alexResidualShort) {
    transfer = { from: 'Olga', to: 'Alex', amount: round2(alexResidualShort) };
    alexAfterEF += alexResidualShort; olgaAfterEF -= alexResidualShort;
  } else if (olgaResidualShort > 0 && alexAfterEF - alexAmount >= olgaResidualShort) {
    transfer = { from: 'Alex', to: 'Olga', amount: round2(olgaResidualShort) };
    olgaAfterEF += olgaResidualShort; alexAfterEF -= olgaResidualShort;
  }
  const fundingPossible = !impossible && alexAfterEF + 0.001 >= alexAmount && olgaAfterEF + 0.001 >= olgaAmount;
  return {
    ok: true,
    guidanceAvailable: true,
    date,
    paymentAmount: total,
    paymentName: String(payload.oneOffName || '').trim(),
    recordableNow,
    recordabilityError,
    safeKTBPortion: safePortion,
    efRequired,
    safeDiscretionaryKTB: safeCapacity,
    ktbAlreadyBelowProtectedLevel: safeCapacity <= 0.001,
    combinedKTB: round2(combined),
    physicalCombinedShortfall: round2(Math.max(total - combined, 0)),
    accountFunding: {
      alexRequested: round2(alexAmount), olgaRequested: round2(olgaAmount), alexBalance: round2(alex), olgaBalance: round2(olga),
      alexShortfall: round2(alexShort), olgaShortfall: round2(olgaShort), recommendedTransfer: transfer
    },
    efFunding: { required: efRequired, suggestedAlex: efToAlex, suggestedOlga: efToOlga },
    expectedBalancesIfFunded: fundingPossible ? { alex: round2(alexAfterEF - alexAmount), olga: round2(olgaAfterEF - olgaAmount) } : null,
    efBalance: round2(efBalance),
    impossibleSafely: !fundingPossible,
    protection: {
      futureVariables: state.variables.mandatoryFutureNeeded,
      remainingFixedObligations: state.fixedObligations.remainingTotal,
      nextSalaryDate: state.salaryCycle.nextSalaryDate
    },
    reconciliationFreshness: manualReconciliationFreshness(snapshot.balanceHistory || [], bangkokBusinessDate(new Date(nowIso)))
  };
}

function planOneOffPayment(ctx) {
  const alexAmount = nonNegativeAmount(ctx.payload.oneOffAlexAmount || 0, 'Amounts');
  const olgaAmount = nonNegativeAmount(ctx.payload.oneOffOlgaAmount || 0, 'Amounts');
  const total = round2(alexAmount + olgaAmount);
  if (total <= 0) fail('At least one account amount must be greater than zero.');
  const name = String(ctx.payload.oneOffName || '').trim();
  if (!name) fail('Payment name is required.');
  const movement = validateMovementDate(ctx.payload.date, ctx.snapshot, ctx.nowIso);
  const state = buildPlanningState(ctx.snapshot, movement.date);
  if (!state.guidanceAvailable) fail(state.guidanceError || 'Safety guidance is unavailable.');
  const safeCapacity = round2(Math.max(Number(state.cash.safeDiscretionaryKTB) || 0, 0));
  const safePortion = round2(Math.min(total, safeCapacity));
  const efPortion = round2(total - safePortion);
  if (efPortion > 0.001) {
    fail('Record the required EF withdrawal to KTB first, then record the payment.', {
      requiresEFWithdrawal: true,
      split: { paymentAmount: total, guidanceAvailable: true, safeCapacity, safePortion, efPortion }
    });
  }
  if (alexAmount > movement.latest.alex + 0.001 || olgaAmount > movement.latest.olga + 0.001) {
    fail('The selected KTB account does not currently hold enough cash. Record the suggested KTB transfer first or change the payment allocation.', {
      requiresKTBTransfer: true,
      preview: buildOneOffPaymentPreview(ctx.snapshot, ctx.payload, ctx.nowIso)
    });
  }
  let alex = movement.latest.alex;
  let olga = movement.latest.olga;
  const statements = [];
  let seq = 1;
  if (alexAmount > 0) {
    alex = round2(alex - alexAmount);
    statements.push(balanceInsert(ctx, seq++, { date: movement.date, alex, olga, oneOffName: name, oneOffAmount: alexAmount, oneOffAccount: 'Alex' }));
  }
  if (olgaAmount > 0) {
    olga = round2(olga - olgaAmount);
    statements.push(balanceInsert(ctx, seq++, { date: movement.date, alex, olga, oneOffName: name, oneOffAmount: olgaAmount, oneOffAccount: 'Olga' }));
  }
  return {
    statements,
    response: {
      split: { paymentAmount: total, guidanceAvailable: true, safeCapacity, safePortion, efPortion },
      balances: { alex, olga }
    }
  };
}

export async function planFinancialWrite(ctx) {
  switch (ctx.action) {
    case 'balanceCheck': return planBalanceCheck(ctx);
    case 'incomeReceipt': return planIncomeReceipt(ctx);
    case 'setNextSalaryDate': return planSetNextSalaryDate(ctx);
    case 'efWithdrawal': return planEFWithdrawal(ctx);
    case 'ktbTransfer': return planKTBTransfer(ctx);
    case 'addGoal': return planAddGoal(ctx);
    case 'dedicatedTransfer': return planDedicatedTransfer(ctx);
    case 'obligationPayment': return planObligationPayment(ctx);
    case 'oneOffPayment': return planOneOffPayment(ctx);
    default: fail(`Unsupported financial write action: ${ctx.action}`);
  }
}
