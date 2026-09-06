import { FinancialWriteValidationError, statement } from './write-protocol.mjs';
import { bangkokBusinessDate, compareDates, isoDate, monthPeriod } from '../../slice-b/src/dates.mjs';
import { historyRowOrder, latestUsableBalance, manualReconciliationFreshness } from '../../slice-b/src/balances.mjs';
import { buildPlanningState, goalCommitmentState } from '../../slice-b/src/planning.mjs';
import { accountLedgerBalance } from '../../slice-b/src/ef-goals.mjs';
import { enumerateObligationOccurrences } from '../../slice-b/src/obligations.mjs';
import {fixedOccurrenceDates} from './fixed-expenses.mjs';
import { planCorrection } from './correction.mjs';
import { planSalaryReceiptTransition } from './salary-cycle.mjs';

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
    if (!selected || date > selected.business_date || (date === selected.business_date && historyRowOrder(row) > historyRowOrder(selected))) selected = row;
  }
  return selected;
}
function balanceView(row) {
  if (!row) return null;
  return { row, date: row.business_date, alex: fromSatang(row.alex_balance_satang), olga: fromSatang(row.olga_balance_satang), combinedBalance: fromSatang(row.alex_balance_satang) + fromSatang(row.olga_balance_satang) };
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
  return { sheetOrder: 1_000_000_000 + ctx.nextRevision * 100 + sequence, sourceRow: ctx.nextRevision * 100 + sequence };
}
function balanceInsert(ctx, sequence, values) {
  const id = sourceIdentity(ctx, sequence);
  return statement(
    `INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,
      one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,income_receipt_source,income_receipt_amount_satang,source_sheet,source_row)
     VALUES(?,?,?,?,?,?,?,?,?,?,'Cloudflare',?)`,
    ctx.householdId, values.date, id.sheetOrder, toSatang(values.alex), toSatang(values.olga), values.oneOffName || null,
    values.oneOffAmount === null || values.oneOffAmount === undefined || values.oneOffAmount === '' ? null : toSatang(values.oneOffAmount),
    values.oneOffAccount || null, values.incomeSource || null,
    values.incomeAmount === null || values.incomeAmount === undefined || values.incomeAmount === '' ? null : toSatang(values.incomeAmount), id.sourceRow
  );
}
function ledgerInsert(ctx, sequence, { date, account, direction, amount }) {
  const id = sourceIdentity(ctx, sequence);
  return statement(
    `INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row)
     VALUES(?,?,?,?,?,?,'Cloudflare',?)`,
    ctx.householdId, date, id.sheetOrder, account, direction, toSatang(amount), id.sourceRow
  );
}
function configuredIncome(snapshot, source) {
  return (snapshot.incomeDefinitions || []).find(item => String(item.source || '').trim() === source) || null;
}

function planBalanceCheck(ctx) {
  const { snapshot, payload } = ctx;
  const date = requireIsoDate(payload.date || bangkokBusinessDate(new Date(ctx.nowIso)), 'A valid balance date is required.');
  const alexProvided = payload.alexBalance !== '' && payload.alexBalance !== null && payload.alexBalance !== undefined;
  const olgaProvided = payload.olgaBalance !== '' && payload.olgaBalance !== null && payload.olgaBalance !== undefined;
  if (!alexProvided && !olgaProvided) fail('Enter a new balance for Alex, Olga, or both.');
  const previous = recordAtOrBefore(snapshot.balanceHistory || [], date);
  const alex = alexProvided ? nonNegativeAmount(payload.alexBalance, 'Alex balance') : (previous ? fromSatang(previous.alex_balance_satang) : null);
  const olga = olgaProvided ? nonNegativeAmount(payload.olgaBalance, 'Olga balance') : (previous ? fromSatang(previous.olga_balance_satang) : null);
  if (alex === null || olga === null) fail('The other account has no saved balance on or before this date. Enter both balances.');
  return { statements:[balanceInsert(ctx,1,{date,alex,olga,oneOffName:payload.oneOffName,oneOffAmount:payload.oneOffAmount,oneOffAccount:payload.oneOffAccount})], response:{balances:{alex:round2(alex),olga:round2(olga),asOf:date}} };
}

function planIncomeReceipt(ctx) {
  const { snapshot, payload } = ctx;
  const alexAmount = nonNegativeAmount(payload.incomeAlexAmount || 0, 'Amounts');
  const olgaAmount = nonNegativeAmount(payload.incomeOlgaAmount || 0, 'Amounts');
  const total = round2(alexAmount + olgaAmount);
  if (total <= 0) fail('At least one account amount must be greater than zero.');
  const source = String(payload.incomeSource || '').trim();
  if (!source) fail('Income source is required.');
  const definition = configuredIncome(snapshot, source);
  if (!ctx.otherIncomeSource && !definition) fail('Income source is not configured.');
  if (snapshot.otherIncomeEnabled && !ctx.otherIncomeSource && definition?.pay_day === 'Variable') fail('Validate the active other-income source before recording this receipt.');
  const movement = validateMovementDate(payload.date, snapshot, ctx.nowIso);
  let alex = movement.latest.alex, olga = movement.latest.olga, seq = 1;
  const statements = [];
  if (alexAmount > 0) {
    alex = round2(alex + alexAmount); const identity = sourceIdentity(ctx, seq);
    statements.push(balanceInsert(ctx,seq,{date:movement.date,alex,olga,incomeSource:source,incomeAmount:alexAmount}));
    statements.push(statement(`INSERT INTO income_receipts(receipt_id,household_id,source,business_date,amount_satang,lands_in,source_balance_row_id)
      VALUES(?,?,?,?,?,?,(SELECT balance_row_id FROM balance_history WHERE household_id=? AND source_sheet='Cloudflare' AND source_row=?))`,
      `${ctx.writeToken}:income:alex`,ctx.householdId,source,movement.date,toSatang(alexAmount),'Alex KTB',ctx.householdId,identity.sourceRow));
    seq += 1;
  }
  if (olgaAmount > 0) {
    olga = round2(olga + olgaAmount); const identity = sourceIdentity(ctx, seq);
    statements.push(balanceInsert(ctx,seq,{date:movement.date,alex,olga,incomeSource:source,incomeAmount:olgaAmount}));
    statements.push(statement(`INSERT INTO income_receipts(receipt_id,household_id,source,business_date,amount_satang,lands_in,source_balance_row_id)
      VALUES(?,?,?,?,?,?,(SELECT balance_row_id FROM balance_history WHERE household_id=? AND source_sheet='Cloudflare' AND source_row=?))`,
      `${ctx.writeToken}:income:olga`,ctx.householdId,source,movement.date,toSatang(olgaAmount),'Olga KTB',ctx.householdId,identity.sourceRow));
    seq += 1;
  }
  const transition = ctx.otherIncomeSource ? { advanced:false, variablesTargetRequired:false, statements:[] } : planSalaryReceiptTransition(snapshot,movement.date,source,ctx.householdId);
  statements.push(...transition.statements);
  return { statements, response:{ date:movement.date,alexBalance:alex,olgaBalance:olga,source,totalAmount:total,salaryCycleAdvanced:!!transition.advanced,nextSalaryDateRequired:!!transition.advanced,variablesTargetRequired:!!transition.variablesTargetRequired } };
}

function planSetNextSalaryDate(ctx) {
  const date = requireIsoDate(ctx.payload.nextSalaryDate, 'A valid next salary date is required.');
  const start = isoDate(ctx.snapshot.salaryCycle?.current_cycle_start);
  if (!start) fail('Current salary-cycle start is not configured.');
  if (compareDates(date,start) <= 0) fail('Next salary date must be after the current salary-cycle start.');
  const statements=[statement('UPDATE salary_cycle_state SET next_salary_date=? WHERE household_id=?',date,ctx.householdId)];
  if(ctx.snapshot.fixedExpenseEnabled)for(const def of ctx.snapshot.obligations||[])for(const due of fixedOccurrenceDates(def,start,date))statements.push(statement('INSERT OR IGNORE INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start,category) VALUES(?,?,?,?,?,?,?,?)',`${ctx.writeToken}:occ:${def.name}:${due}`,ctx.householdId,def.name,due,def.expected_amount_satang,def.amount_type,start,def.category));
  return { statements, response:{currentCycleStart:start,nextSalaryDate:date} };
}
function planSetVariablesTarget(ctx) {
  const amount = nonNegativeAmount(ctx.payload.amount, 'Variables target');
  return { statements:[statement('UPDATE salary_cycle_state SET variables_target_satang=? WHERE household_id=?',toSatang(amount),ctx.householdId)], response:{variablesTarget:amount} };
}
function planSetEFCommitment(ctx) {
  const amount = nonNegativeAmount(ctx.payload.amount, 'EF commitment');
  return { statements:[statement('UPDATE salary_cycle_state SET ef_cycle_commitment_satang=? WHERE household_id=?',toSatang(amount),ctx.householdId)], response:{efCommitment:amount} };
}
function planSetGoalCommitment(ctx) {
  const name = String(ctx.payload.goalName || '').trim();
  const amount = nonNegativeAmount(ctx.payload.amount, 'Goal commitment');
  const goal = (ctx.snapshot.goals || []).find(item => item.name === name);
  if (!goal) fail('Goal not found.');
  const through = bangkokBusinessDate(new Date(ctx.nowIso));
  const proposed = goalCommitmentState(ctx.snapshot,name,through,amount);
  if (!proposed) fail('Goal not found.');
  if (proposed.degraded) fail('This Goal has unresolved current-cycle correction data. Resolve the correction before changing its commitment.');
  if (!proposed.valid) fail(`Goal commitment would leave ${proposed.outstanding} THB outstanding while only ${proposed.lifetimeRemaining} THB remains to the lifetime target. Reduce the cycle commitment or change the lifetime target first.`);
  return { statements:[statement('UPDATE goals SET cycle_commitment_satang=? WHERE household_id=? AND name=?',toSatang(amount),ctx.householdId,name)], response:{goalName:name,cycleCommitment:amount,outstanding:proposed.outstanding,lifetimeRemaining:proposed.lifetimeRemaining} };
}

function planEFWithdrawal(ctx) {
  const amount=positiveAmount(ctx.payload.amount,'Withdrawal amount'),destination=normalizeAccount(ctx.payload.destinationAccount);
  if(!destination)fail('Choose Alex KTB or Olga KTB.');
  const movement=validateMovementDate(ctx.payload.date,ctx.snapshot,ctx.nowIso),efBalance=accountLedgerBalance(ctx.snapshot.ledger||[],'EF');
  if(amount>efBalance+0.001)fail('Withdrawal amount exceeds the Emergency Fund balance.');
  let alex=movement.latest.alex,olga=movement.latest.olga;if(destination==='Alex')alex=round2(alex+amount);else olga=round2(olga+amount);
  return {statements:[ledgerInsert(ctx,1,{date:movement.date,account:'EF',direction:'Withdrawal',amount}),balanceInsert(ctx,2,{date:movement.date,alex,olga,oneOffName:'Withdraw from EF',oneOffAmount:amount,oneOffAccount:destination})],response:{amount,destination,efBalance:round2(efBalance-amount),balances:{alex,olga}}};
}
function planGoalWithdrawal(ctx) {
  const amount=positiveAmount(ctx.payload.amount,'Withdrawal amount'),destination=normalizeAccount(ctx.payload.destinationAccount),name=String(ctx.payload.goalName||'').trim(),purpose=String(ctx.payload.purpose||'').trim();
  if(!destination)fail('Choose Alex KTB or Olga KTB.');
  if(!['useForGoal','anotherReason'].includes(purpose))fail('Choose a withdrawal purpose.');
  const goal=(ctx.snapshot.goals||[]).find(item=>item.name===name);if(!goal)fail('Goal not found.');
  const movement=validateMovementDate(ctx.payload.date,ctx.snapshot,ctx.nowIso),balance=accountLedgerBalance(ctx.snapshot.ledger||[],name),target=fromSatang(goal.target_amount_satang);
  if(amount>balance+0.001)fail('Withdrawal amount exceeds the Goal balance.');
  let alex=movement.latest.alex,olga=movement.latest.olga;if(destination==='Alex')alex=round2(alex+amount);else olga=round2(olga+amount);
  const movementLabel=purpose==='useForGoal'?`Use Goal funds: ${name}`:`Withdraw from Goal for another reason: ${name}`;
  const statements=[ledgerInsert(ctx,1,{date:movement.date,account:name,direction:'Withdrawal',amount}),balanceInsert(ctx,2,{date:movement.date,alex,olga,oneOffName:movementLabel,oneOffAmount:amount,oneOffAccount:destination})];
  const completed=purpose==='useForGoal'&&balance+0.001>=target;if(completed&&goal.status!=='done')statements.push(statement('UPDATE goals SET status=? WHERE household_id=? AND name=?','done',ctx.householdId,name));
  return{statements,response:{goalName:name,amount,destination,purpose,goalBalance:round2(balance-amount),status:completed?'done':goal.status,balances:{alex,olga}}};
}
function planKTBTransfer(ctx) {
  const amount=positiveAmount(ctx.payload.amount,'Transfer amount'),source=normalizeAccount(ctx.payload.sourceAccount),destination=normalizeAccount(ctx.payload.destinationAccount);
  if(!source||!destination||source===destination)fail('Choose two different KTB accounts.');
  const movement=validateMovementDate(ctx.payload.date,ctx.snapshot,ctx.nowIso);let alex=movement.latest.alex,olga=movement.latest.olga;
  if(source==='Alex'){if(amount>alex+0.001)fail('Transfer amount exceeds Alex KTB balance.');alex=round2(alex-amount);olga=round2(olga+amount)}else{if(amount>olga+0.001)fail('Transfer amount exceeds Olga KTB balance.');olga=round2(olga-amount);alex=round2(alex+amount)}
  return {statements:[balanceInsert(ctx,1,{date:movement.date,alex,olga,oneOffName:`KTB transfer ${source} to ${destination}`})],response:{amount,source,destination,balances:{alex,olga},combined:round2(alex+olga)}};
}
function planAddGoal(ctx) {
  const name=String(ctx.payload.name||'').trim(),targetAmount=positiveAmount(ctx.payload.targetAmount,'Target amount');
  if(!name)fail('name and targetAmount are required.');
  if((ctx.snapshot.goals||[]).some(goal=>String(goal.name||'').trim()===name))fail(`Goal already exists: ${name}`);
  const fallbackRank=(ctx.snapshot.goals||[]).length+1,rank=Number(ctx.payload.priorityRank||fallbackRank);
  if(!Number.isInteger(rank)||rank<=0)fail('Priority rank must be a positive whole number.');
  const targetDate=ctx.payload.targetDate?requireIsoDate(ctx.payload.targetDate,'Target date must be a valid date.'):null;
  return {statements:[statement('INSERT INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date,cycle_commitment_satang) VALUES(?,?,?,?,?,?,0)',ctx.householdId,name,toSatang(targetAmount),rank,'active',targetDate)],response:{goal:{name,targetAmount,priorityRank:rank,status:'active',targetDate,cycleCommitment:0}}};
}

function planDedicatedTransfer(ctx) {
  const amount=positiveAmount(ctx.payload.amount,'Transfer amount'),source=normalizeAccount(ctx.payload.sourceAccount);
  if(!source)fail('Choose Alex KTB or Olga KTB.');
  const destinationType=String(ctx.payload.destinationType||'').trim();
  if(destinationType!=='EF'&&destinationType!=='Goal')fail('Transfer destination must be EF or Goal.');
  const destinationName=destinationType==='EF'?'EF':String(ctx.payload.destinationName||'').trim();
  if(destinationType==='Goal'&&!(ctx.snapshot.goals||[]).some(goal=>goal.name===destinationName))fail('Goal not found.');
  const movement=validateMovementDate(ctx.payload.date,ctx.snapshot,ctx.nowIso),state=buildPlanningState(ctx.snapshot,movement.date);
  if(!state.spendingAuthorityAvailable||state.availableToSpend===null)fail('Spending authority is unavailable.');
  const safeLimit=destinationType==='EF'?Number(state.transferLimits.emergencyFund)||0:Number(state.transferLimits.goals?.[destinationName])||0;
  if(amount>round2(safeLimit)+0.001)fail(`This transfer is above the current safe limit of ${round2(safeLimit)} THB.`);
  let alex=movement.latest.alex,olga=movement.latest.olga;
  if(source==='Alex'){if(amount>alex+0.001)fail('Transfer amount exceeds Alex KTB balance.');alex=round2(alex-amount)}else{if(amount>olga+0.001)fail('Transfer amount exceeds Olga KTB balance.');olga=round2(olga-amount)}
  return {statements:[ledgerInsert(ctx,1,{date:movement.date,account:destinationName,direction:'Contribution',amount}),balanceInsert(ctx,2,{date:movement.date,alex,olga,oneOffName:destinationType==='EF'?'Transfer to EF':`Transfer to Goal: ${destinationName}`,oneOffAmount:amount,oneOffAccount:source})],response:{destination:destinationName,amount,balances:{alex,olga}}};
}

function occurrenceExists(snapshot,name,dueDate){const start=isoDate(snapshot.salaryCycle?.current_cycle_start),next=isoDate(snapshot.salaryCycle?.next_salary_date);if(!start||!next)return false;if(snapshot.fixedExpenseEnabled)return(snapshot.obligationOccurrences||[]).some(x=>x.cycle_start===start&&x.obligation_name===name&&x.due_date===dueDate);return enumerateObligationOccurrences(snapshot.obligations||[],start,next).some(item=>item.name===name&&isoDate(item.dueDate)===dueDate)}
function planObligationPayment(ctx) {
  const name=String(ctx.payload.obligationName||'').trim(),obligation=(ctx.snapshot.obligations||[]).find(item=>String(item.name||'').trim()===name);if(!obligation)fail('Obligation not found.');
  const amount=positiveAmount(ctx.payload.amount,'Payment amount'),source=normalizeAccount(ctx.payload.sourceAccount);if(!source)fail('Choose Alex KTB or Olga KTB.');
  const movement=validateMovementDate(ctx.payload.date,ctx.snapshot,ctx.nowIso);let dueDate=isoDate(ctx.payload.occurrenceDueDate);
  if(!dueDate){const occurrences=ctx.snapshot.fixedExpenseEnabled?(ctx.snapshot.obligationOccurrences||[]).filter(item=>item.cycle_start===isoDate(ctx.snapshot.salaryCycle?.current_cycle_start)&&item.obligation_name===name).map(item=>({name:item.obligation_name,dueDate:item.due_date})):enumerateObligationOccurrences(ctx.snapshot.obligations||[],ctx.snapshot.salaryCycle?.current_cycle_start,ctx.snapshot.salaryCycle?.next_salary_date).filter(item=>item.name===name);if(occurrences.length===1)dueDate=isoDate(occurrences[0].dueDate)}
  if(!dueDate||!occurrenceExists(ctx.snapshot,name,dueDate))fail('Choose the obligation occurrence being paid.');
  let alex=movement.latest.alex,olga=movement.latest.olga;if(source==='Alex'){if(amount>alex+0.001)fail('Transfer amount exceeds Alex KTB balance.');alex=round2(alex-amount)}else{if(amount>olga+0.001)fail('Transfer amount exceeds Olga KTB balance.');olga=round2(olga-amount)}
  const amountType=String(obligation.amount_type||'').toLowerCase()==='variable'?'Variable':'Fixed',paymentStatus=amountType==='Variable'?(String(ctx.payload.paymentStatus||'Final').trim().toLowerCase()==='partial'?'Partial':'Final'):'Partial',expected=fromSatang(obligation.expected_amount_satang);
  const occurrence=(ctx.snapshot.obligationOccurrences||[]).find(x=>x.cycle_start===isoDate(ctx.snapshot.salaryCycle?.current_cycle_start)&&x.obligation_name===name&&x.due_date===dueDate);
  const insert=ctx.snapshot.fixedExpenseEnabled?statement(`INSERT INTO obligation_payments(payment_id,household_id,obligation_name,period,payment_date,occurrence_due_date,expected_amount_satang,actual_amount_satang,paid_from,balance_adjusted,payment_status,note,occurrence_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,`${ctx.writeToken}:obligation`,ctx.householdId,name,monthPeriod(dueDate),movement.date,dueDate,toSatang(expected),toSatang(amount),source,1,paymentStatus,String(ctx.payload.note||'').trim()||null,occurrence.occurrence_id):statement(`INSERT INTO obligation_payments(payment_id,household_id,obligation_name,period,payment_date,occurrence_due_date,expected_amount_satang,actual_amount_satang,paid_from,balance_adjusted,payment_status,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,`${ctx.writeToken}:obligation`,ctx.householdId,name,monthPeriod(dueDate),movement.date,dueDate,toSatang(expected),toSatang(amount),source,1,paymentStatus,String(ctx.payload.note||'').trim()||null);
  return {statements:[insert,balanceInsert(ctx,1,{date:movement.date,alex,olga,oneOffName:`Fixed obligation: ${name}`,oneOffAmount:amount,oneOffAccount:source})],response:{obligationName:name,occurrenceDueDate:dueDate,amount,paymentStatus,balances:{alex,olga}}};
}

export function buildOneOffPaymentPreview(snapshot,payload,nowIso=new Date().toISOString()) {
  const date=requireIsoDate(payload.date||bangkokBusinessDate(new Date(nowIso)),'A valid payment date is required.'),alexAmount=Math.max(round2(Number(payload.oneOffAlexAmount)||0),0),olgaAmount=Math.max(round2(Number(payload.oneOffOlgaAmount)||0),0),total=round2(alexAmount+olgaAmount);
  if(total<=0)fail('Enter a positive payment amount.');
  const latestNow=latestUsableBalance(snapshot.balanceHistory||[]);if(!latestNow)fail('No account balance is available.');
  const today=bangkokBusinessDate(new Date(nowIso));let recordableNow=true,recordabilityError=null;if(date>today){recordableNow=false;recordabilityError='Transaction date cannot be in the future.'}else if(date<latestNow.date){recordableNow=false;recordabilityError='Transaction date cannot be earlier than the latest saved balance.'}
  const previewRow=date<latestNow.date?recordAtOrBefore(snapshot.balanceHistory||[],date):latestNow.row,previewBalance=balanceView(previewRow);if(!previewBalance)fail('No account balance is available on or before the entered payment date.');
  const state=buildPlanningState(snapshot,date,{balanceRecord:previewBalance,obligationPaymentsAsOf:date});
  if(!state.spendingAuthorityAvailable||state.availableToSpend===null)return{ok:true,paymentSafetyAvailable:false,error:'Spending authority is unavailable.',planningState:state.planningState,paymentAmount:total,date,recordableNow,recordabilityError};
  const available=round2(Number(state.availableToSpend)||0),fundingNeeded=round2(Math.max(total-available,0)),safePortion=round2(Math.max(total-fundingNeeded,0));
  const alex=previewBalance.alex,olga=previewBalance.olga,alexShort=Math.max(alexAmount-alex,0),olgaShort=Math.max(olgaAmount-olga,0),combined=alex+olga,efBalance=Number(state.emergencyFund.currentBalance)||0,impossible=fundingNeeded>efBalance+0.001;
  let efToAlex=0,efToOlga=0,efLeft=fundingNeeded;if(efLeft>0){const fillAlex=Math.min(alexShort,efLeft);efToAlex+=fillAlex;efLeft-=fillAlex;const fillOlga=Math.min(olgaShort,efLeft);efToOlga+=fillOlga;efLeft-=fillOlga;if(efLeft>0){if(alexAmount>=olgaAmount&&alexAmount>0)efToAlex+=efLeft;else efToOlga+=efLeft}}
  efToAlex=round2(efToAlex);efToOlga=round2(efToOlga);let alexAfterEF=alex+efToAlex,olgaAfterEF=olga+efToOlga;const alexResidualShort=Math.max(alexAmount-alexAfterEF,0),olgaResidualShort=Math.max(olgaAmount-olgaAfterEF,0);let transfer=null;
  if(alexResidualShort>0&&olgaAfterEF-olgaAmount>=alexResidualShort){transfer={from:'Olga',to:'Alex',amount:round2(alexResidualShort)};alexAfterEF+=alexResidualShort;olgaAfterEF-=alexResidualShort}else if(olgaResidualShort>0&&alexAfterEF-alexAmount>=olgaResidualShort){transfer={from:'Alex',to:'Olga',amount:round2(olgaResidualShort)};olgaAfterEF+=olgaResidualShort;alexAfterEF-=olgaResidualShort}
  const fundingPossible=!impossible&&alexAfterEF+0.001>=alexAmount&&olgaAfterEF+0.001>=olgaAmount;
  return {ok:true,paymentSafetyAvailable:true,planningState:state.planningState,date,paymentAmount:total,paymentName:String(payload.oneOffName||'').trim(),recordableNow,recordabilityError,availableToSpend:available,safeKTBPortion:safePortion,efRequired:fundingNeeded,fundingNeeded,combinedKTB:round2(combined),physicalCombinedShortfall:round2(Math.max(total-combined,0)),accountFunding:{alexRequested:round2(alexAmount),olgaRequested:round2(olgaAmount),alexBalance:round2(alex),olgaBalance:round2(olga),alexShortfall:round2(alexShort),olgaShortfall:round2(olgaShort),recommendedTransfer:transfer},efFunding:{required:fundingNeeded,suggestedAlex:efToAlex,suggestedOlga:efToOlga},expectedBalancesIfFunded:fundingPossible?{alex:round2(alexAfterEF-alexAmount),olga:round2(olgaAfterEF-olgaAmount)}:null,efBalance:round2(efBalance),impossibleSafely:!fundingPossible,protection:{totalOutstanding:state.commitments.totalOutstanding,remainingFixedObligations:state.commitments.requiredOutstanding,nextSalaryDate:state.salaryCycle.nextSalaryDate},reconciliationFreshness:manualReconciliationFreshness(snapshot.balanceHistory||[],today)};
}

function planOneOffPayment(ctx) {
  if(ctx.snapshot.typedPaymentEnabled&&!ctx.typedPaymentValidated)fail('Validate the typed payment before recording it.');
  const alexAmount=nonNegativeAmount(ctx.payload.oneOffAlexAmount||0,'Amounts'),olgaAmount=nonNegativeAmount(ctx.payload.oneOffOlgaAmount||0,'Amounts'),total=round2(alexAmount+olgaAmount);if(total<=0)fail('At least one account amount must be greater than zero.');
  const name=String(ctx.payload.oneOffName||'').trim();if(!name)fail('Payment name is required.');
  const movement=validateMovementDate(ctx.payload.date,ctx.snapshot,ctx.nowIso),state=buildPlanningState(ctx.snapshot,movement.date);if(!state.spendingAuthorityAvailable||state.availableToSpend===null)fail('Spending authority is unavailable.');
  const available=round2(Number(state.availableToSpend)||0),fundingNeeded=round2(Math.max(total-available,0)),safePortion=round2(Math.max(total-fundingNeeded,0));
  if(fundingNeeded>0.001)fail('Record the required EF withdrawal to KTB first, then record the payment.',{requiresEFWithdrawal:true,split:{paymentAmount:total,guidanceAvailable:true,availableToSpend:available,safePortion,efPortion:fundingNeeded,fundingNeeded}});
  if(alexAmount>movement.latest.alex+0.001||olgaAmount>movement.latest.olga+0.001)fail('The selected KTB account does not currently hold enough cash. Record the suggested KTB transfer first or change the payment allocation.',{requiresKTBTransfer:true,preview:buildOneOffPaymentPreview(ctx.snapshot,ctx.payload,ctx.nowIso)});
  let alex=movement.latest.alex,olga=movement.latest.olga,seq=1;const statements=[];if(alexAmount>0){alex=round2(alex-alexAmount);statements.push(balanceInsert(ctx,seq++,{date:movement.date,alex,olga,oneOffName:name,oneOffAmount:alexAmount,oneOffAccount:'Alex'}))}if(olgaAmount>0){olga=round2(olga-olgaAmount);statements.push(balanceInsert(ctx,seq++,{date:movement.date,alex,olga,oneOffName:name,oneOffAmount:olgaAmount,oneOffAccount:'Olga'}))}
  return {statements,response:{split:{paymentAmount:total,guidanceAvailable:true,availableToSpend:available,safePortion,efPortion:fundingNeeded,fundingNeeded},balances:{alex,olga}}};
}

export async function planFinancialWrite(ctx) {
  switch(ctx.action){
    case'balanceCheck':return planBalanceCheck(ctx);
    case'incomeReceipt':return planIncomeReceipt(ctx);
    case'setNextSalaryDate':return planSetNextSalaryDate(ctx);
    case'setVariablesTarget':return planSetVariablesTarget(ctx);
    case'setEFCommitment':return planSetEFCommitment(ctx);
    case'setGoalCommitment':return planSetGoalCommitment(ctx);
    case'efWithdrawal':return planEFWithdrawal(ctx);
    case'goalWithdrawal':return planGoalWithdrawal(ctx);
    case'ktbTransfer':return planKTBTransfer(ctx);
    case'addGoal':return planAddGoal(ctx);
    case'dedicatedTransfer':return planDedicatedTransfer(ctx);
    case'obligationPayment':return planObligationPayment(ctx);
    case'oneOffPayment':return planOneOffPayment(ctx);
    case'correctRecord':return planCorrection(ctx);
    default:fail(`Unsupported financial write action: ${ctx.action}`);
  }
}
