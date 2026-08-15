import { FinancialWriteValidationError, statement } from './write-protocol.mjs';
import { compareDates, isoDate } from '../../slice-b/src/dates.mjs';

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const toSatang = value => Math.round((Number(value) + Number.EPSILON) * 100);
const thb = value => Number(value || 0) / 100;

function fail(message) { throw new FinancialWriteValidationError(message); }
function date(value, label = 'Date') { const d = isoDate(value); if (!d) fail(`${label} must be a valid date.`); return d; }
function positive(value, label) { const n = round2(Number(value)); if (!Number.isFinite(n) || n <= 0) fail(`${label} must be greater than zero.`); return n; }
function nonNegative(value, label) { const n = round2(Number(value)); if (!Number.isFinite(n) || n < 0) fail(`${label} must be zero or positive.`); return n; }
function own(o, key) { return Object.prototype.hasOwnProperty.call(o || {}, key); }
function asPlain(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }

function correctionIdentity(ctx, sequence) {
  return { sheetOrder: 1_000_000_000 + ctx.nextRevision * 100 + sequence, sourceRow: ctx.nextRevision * 100 + sequence };
}

function findRecord(snapshot, entityType, entityId) {
  const id = String(entityId ?? '');
  if (entityType === 'balance') return (snapshot.balanceHistory || []).find(row => String(row.balance_row_id) === id) || null;
  if (entityType === 'obligationPayment') return (snapshot.obligationPayments || []).find(row => String(row.payment_id) === id) || null;
  if (entityType === 'ledgerMovement') return (snapshot.ledger || []).find(row => String(row.ledger_id) === id) || null;
  if (entityType === 'goal') return (snapshot.goals || []).find(row => String(row.name) === id) || null;
  if (entityType === 'salaryCycle') return id === 'family' || !id ? snapshot.salaryCycle || null : null;
  fail(`Unsupported correction entity type: ${entityType}`);
}

export function previewCorrection(snapshot, payload = {}) {
  const entityType = String(payload.entityType || '').trim();
  const entityId = String(payload.entityId ?? '').trim();
  if (!entityType) fail('Correction entity type is required.');
  if (!entityId && entityType !== 'salaryCycle') fail('Correction entity ID is required.');
  const record = findRecord(snapshot, entityType, entityId || 'family');
  if (!record) fail('The record to correct was not found.');
  const allowedFields = {
    balance: ['businessDate','alexBalance','olgaBalance'],
    obligationPayment: ['paymentDate','actualAmount','paidFrom','paymentStatus','note'],
    ledgerMovement: ['businessDate','account','direction','amount'],
    goal: ['targetAmount','priorityRank','status','targetDate'],
    salaryCycle: ['currentCycleStart','nextSalaryDate']
  }[entityType];
  return { ok: true, entityType, entityId: entityId || 'family', current: asPlain(record), allowedFields };
}

function auditStatement(ctx, entityType, entityId, before, after, reason) {
  return statement(
    `INSERT INTO correction_audit(correction_id,household_id,entity_type,entity_id,before_json,after_json,reason,actor_email,corrected_at,base_revision,write_token)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    `${ctx.writeToken}:correction`, ctx.householdId, entityType, String(entityId), JSON.stringify(before), JSON.stringify(after),
    reason, ctx.actorEmail || 'unknown', ctx.nowIso, ctx.baseRevision, ctx.writeToken
  );
}

function planBalanceCorrection(ctx, before, values, reason) {
  const businessDate = own(values,'businessDate') ? date(values.businessDate,'Business date') : before.business_date;
  const correctedBalanceValue = (field, label, beforeSatang) => {
    if (!own(values, field)) return beforeSatang === null || beforeSatang === undefined ? null : thb(beforeSatang);
    const submitted = values[field];
    return submitted === '' || submitted === null || submitted === undefined ? null : nonNegative(submitted, label);
  };
  const alex = correctedBalanceValue('alexBalance','Alex balance',before.alex_balance_satang);
  const olga = correctedBalanceValue('olgaBalance','Olga balance',before.olga_balance_satang);
  const id = correctionIdentity(ctx,1);
  const after = {
    replacementForBalanceRowId: before.balance_row_id,
    business_date: businessDate,
    alex_balance_satang: alex === null ? null : toSatang(alex),
    olga_balance_satang: olga === null ? null : toSatang(olga),
    one_off_payment_name: before.one_off_payment_name ?? null,
    one_off_payment_amount_satang: before.one_off_payment_amount_satang ?? null,
    one_off_payment_account: before.one_off_payment_account ?? null,
    income_receipt_source: before.income_receipt_source ?? null,
    income_receipt_amount_satang: before.income_receipt_amount_satang ?? null,
    source_sheet: 'Correction',
    source_row: id.sourceRow
  };
  const replacement = statement(
    `INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,
      one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,income_receipt_source,income_receipt_amount_satang,source_sheet,source_row)
     VALUES(?,?,?,?,?,?,?,?,?,?,'Correction',?)`,
    ctx.householdId,businessDate,id.sheetOrder,alex === null ? null : toSatang(alex),olga === null ? null : toSatang(olga),before.one_off_payment_name ?? null,
    before.one_off_payment_amount_satang ?? null,before.one_off_payment_account ?? null,before.income_receipt_source ?? null,
    before.income_receipt_amount_satang ?? null,id.sourceRow
  );
  return { statements:[replacement,auditStatement(ctx,'balance_history',before.balance_row_id,asPlain(before),after,reason)], response:{ correction:{entityType:'balance',entityId:String(before.balance_row_id),before:asPlain(before),after} } };
}

function planPaymentCorrection(ctx, before, values, reason) {
  const paymentDate = own(values,'paymentDate') ? date(values.paymentDate,'Payment date') : before.payment_date;
  const actual = own(values,'actualAmount') ? positive(values.actualAmount,'Actual amount') : thb(before.actual_amount_satang);
  const paidFrom = own(values,'paidFrom') ? String(values.paidFrom || '').trim() : before.paid_from;
  if (!['Alex','Olga'].includes(paidFrom)) fail('Paid from must be Alex or Olga.');
  const paymentStatus = own(values,'paymentStatus') ? String(values.paymentStatus || '').trim() || null : before.payment_status;
  const note = own(values,'note') ? String(values.note || '').trim() || null : before.note;
  const after={...asPlain(before),payment_date:paymentDate,actual_amount_satang:toSatang(actual),paid_from:paidFrom,payment_status:paymentStatus,note};
  return {
    statements:[
      statement('UPDATE obligation_payments SET payment_date=?,actual_amount_satang=?,paid_from=?,payment_status=?,note=? WHERE household_id=? AND payment_id=?',paymentDate,toSatang(actual),paidFrom,paymentStatus,note,ctx.householdId,before.payment_id),
      auditStatement(ctx,'obligation_payment',before.payment_id,asPlain(before),after,reason)
    ],
    response:{correction:{entityType:'obligationPayment',entityId:before.payment_id,before:asPlain(before),after}}
  };
}

function opposite(direction) { return direction === 'Contribution' ? 'Withdrawal' : direction === 'Withdrawal' ? 'Contribution' : null; }
function planLedgerCorrection(ctx,before,values,reason) {
  const businessDate=own(values,'businessDate')?date(values.businessDate,'Business date'):before.business_date;
  const account=own(values,'account')?String(values.account||'').trim():before.account;
  const direction=own(values,'direction')?String(values.direction||'').trim():before.direction;
  const amount=own(values,'amount')?positive(values.amount,'Amount'):thb(before.amount_satang);
  if(!account)fail('Ledger account is required.');
  if(!['Contribution','Withdrawal'].includes(direction))fail('Ledger direction must be Contribution or Withdrawal.');
  const reverseDirection=opposite(before.direction);if(!reverseDirection)fail('Existing ledger direction cannot be reversed safely.');
  const rev=correctionIdentity(ctx,1), rep=correctionIdentity(ctx,2);
  const insert=(identity,d,a,dir,amt)=>statement(`INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES(?,?,?,?,?,?,'Correction',?)`,ctx.householdId,d,identity.sheetOrder,a,dir,toSatang(amt),identity.sourceRow);
  const after={replacementForLedgerId:before.ledger_id,business_date:businessDate,account,direction,amount_satang:toSatang(amount),source_sheet:'Correction',source_row:rep.sourceRow};
  return {
    statements:[
      insert(rev,before.business_date,before.account,reverseDirection,thb(before.amount_satang)),
      insert(rep,businessDate,account,direction,amount),
      auditStatement(ctx,'ledger_movement',before.ledger_id,asPlain(before),after,reason)
    ],
    response:{correction:{entityType:'ledgerMovement',entityId:String(before.ledger_id),before:asPlain(before),after}}
  };
}

function planGoalCorrection(ctx,before,values,reason) {
  const target=own(values,'targetAmount')?positive(values.targetAmount,'Target amount'):thb(before.target_amount_satang);
  const rank=own(values,'priorityRank')?Number(values.priorityRank):Number(before.priority_rank);
  if(!Number.isInteger(rank)||rank<=0)fail('Priority rank must be a positive whole number.');
  const status=own(values,'status')?String(values.status||'').trim():before.status;if(!status)fail('Goal status is required.');
  const targetDate=own(values,'targetDate')?(values.targetDate?date(values.targetDate,'Target date'):null):before.target_date;
  const after={...asPlain(before),target_amount_satang:toSatang(target),priority_rank:rank,status,target_date:targetDate};
  return {statements:[
    statement('UPDATE goals SET target_amount_satang=?,priority_rank=?,status=?,target_date=? WHERE household_id=? AND name=?',toSatang(target),rank,status,targetDate,ctx.householdId,before.name),
    auditStatement(ctx,'goal',before.name,asPlain(before),after,reason)
  ],response:{correction:{entityType:'goal',entityId:before.name,before:asPlain(before),after}}};
}

function planSalaryCycleCorrection(ctx,before,values,reason) {
  const start=own(values,'currentCycleStart')?date(values.currentCycleStart,'Current cycle start'):before.current_cycle_start;
  const next=own(values,'nextSalaryDate')?(values.nextSalaryDate?date(values.nextSalaryDate,'Next salary date'):null):before.next_salary_date;
  if(next&&compareDates(next,start)<=0)fail('Next salary date must be after current cycle start.');
  const after={...asPlain(before),current_cycle_start:start,next_salary_date:next};
  const statements=[statement('UPDATE salary_cycle_state SET current_cycle_start=?,next_salary_date=? WHERE household_id=?',start,next,ctx.householdId)];
  if(start!==before.current_cycle_start){
    const activeSources=(ctx.snapshot.salaryCycleSources||[]).filter(item=>item.cycle_start===before.current_cycle_start).map(item=>item.source);
    statements.push(statement('DELETE FROM salary_cycle_sources WHERE household_id=? AND cycle_start=?',ctx.householdId,before.current_cycle_start));
    for(const source of activeSources) statements.push(statement('INSERT OR IGNORE INTO salary_cycle_sources(household_id,cycle_start,source) VALUES(?,?,?)',ctx.householdId,start,source));
  }
  statements.push(auditStatement(ctx,'salary_cycle',ctx.householdId,asPlain(before),after,reason));
  return {statements,response:{correction:{entityType:'salaryCycle',entityId:ctx.householdId,before:asPlain(before),after}}};
}

export async function planCorrection(ctx) {
  const entityType=String(ctx.payload.entityType||'').trim();
  const entityId=String(ctx.payload.entityId??'').trim();
  const reason=String(ctx.payload.reason||'').trim();
  const values=ctx.payload.correctedValues||{};
  if(!reason)fail('Correction reason is required.');
  const before=findRecord(ctx.snapshot,entityType,entityId||'family');
  if(!before)fail('The record to correct was not found.');
  if(entityType==='balance')return planBalanceCorrection(ctx,before,values,reason);
  if(entityType==='obligationPayment')return planPaymentCorrection(ctx,before,values,reason);
  if(entityType==='ledgerMovement')return planLedgerCorrection(ctx,before,values,reason);
  if(entityType==='goal')return planGoalCorrection(ctx,before,values,reason);
  if(entityType==='salaryCycle')return planSalaryCycleCorrection(ctx,before,values,reason);
  fail(`Unsupported correction entity type: ${entityType}`);
}
