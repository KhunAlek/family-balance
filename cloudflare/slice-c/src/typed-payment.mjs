import {FinancialWriteValidationError,statement,executeRevisionClaimWrite,loadAuthoritativeFinancialState} from './write-protocol.mjs';
import {executeRequestReceiptWrite} from './request-receipts.mjs';
import {buildOneOffPaymentPreview,planFinancialWrite} from './write-actions.mjs';
import {addDays,bangkokBusinessDate,isoDate} from '../../slice-b/src/dates.mjs';
import {reportingDate} from '../../slice-b/src/reporting.mjs';
const fail=message=>{throw new FinancialWriteValidationError(message);};
function values(payload){
 for(const key of Object.keys(payload))if(!['action','requestId','date','categoryId','description','amount','paidFromAccount'].includes(key))fail('Unexpected payment field: '+key);
 const amount=Number(payload.amount),satang=Math.round(amount*100);
 if(!['number','string'].includes(typeof payload.amount)||!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(satang)||Math.abs(amount*100-satang)>0.000001)fail('Enter a positive amount with at most two decimal places.');
 if(!['Alex','Olga'].includes(payload.paidFromAccount))fail('Choose one paid-from KTB account.');
 const categoryId=payload.categoryId===undefined||payload.categoryId===null||payload.categoryId===''?null:payload.categoryId;
 if(categoryId!==null&&typeof categoryId!=='string')fail('Choose a valid category.');
 if(payload.description!==undefined&&typeof payload.description!=='string')fail('Description must be text.');
 const description=(payload.description||'').trim();if(description.length>500)fail('Description must contain at most 500 characters.');
 if(!categoryId&&!description)fail('A description is required for an Uncategorized payment.');
 return {date:reportingDate(payload.date),categoryId,description:description||null,amountSatang:satang,paidFromAccount:payload.paidFromAccount};
}
async function preparePayment(db,ctx,semantic){
 const today=bangkokBusinessDate(new Date(ctx.nowIso)),start=reportingDate(ctx.snapshot.salaryCycle.current_cycle_start),earliest=[isoDate(addDays(today,-2)),start].sort().at(-1);
 if(semantic.date<earliest||semantic.date>today)fail('Payment date must be within the last two Bangkok days and within the current salary cycle.');
 let category=null;
 if(semantic.categoryId){category=await db.prepare('SELECT category_id,name,active FROM one_off_categories WHERE household_id=? AND category_id=?').bind(ctx.householdId,semantic.categoryId).first();if(!category||category.active!==1)fail('Selected category is no longer active.');}
 const legacy={date:today,oneOffName:semantic.description||category.name,oneOffAlexAmount:semantic.paidFromAccount==='Alex'?semantic.amountSatang/100:0,oneOffOlgaAmount:semantic.paidFromAccount==='Olga'?semantic.amountSatang/100:0};
 return {today,earliest,category,legacy};
}
export async function previewTypedPayment(db,payload,options={}){
 const householdId=options.householdId||'family',nowIso=options.nowIso||new Date().toISOString();
 const {snapshot,target}=await loadAuthoritativeFinancialState(db,householdId);
 if(!snapshot.typedPaymentEnabled)return buildOneOffPaymentPreview(snapshot,payload,nowIso);
 const semantic=values(payload),prepared=await preparePayment(target,{snapshot,householdId,nowIso},semantic);
 return {...buildOneOffPaymentPreview(snapshot,prepared.legacy,nowIso),date:semantic.date,balanceEffectDate:prepared.today,earliestAllowed:prepared.earliest,categoryId:semantic.categoryId,description:semantic.description,paidFromAccount:semantic.paidFromAccount};
}
export async function executeTypedPayment(db,options){
 // Existing unmigrated callers retain their baseline path. Migrated writes
 // always require the typed single-account shape and a stable request receipt.
 const state=await loadAuthoritativeFinancialState(db,options.householdId||'family');
 if(!state.snapshot.typedPaymentEnabled)return executeRevisionClaimWrite(db,{...options,planWrite:planFinancialWrite});
 const semantic=values(options.payload||{});
 return executeRequestReceiptWrite(db,options,semantic,async ctx=>{
  const prepared=await preparePayment(state.target,ctx,semantic);
  const plan=await planFinancialWrite({...ctx,typedPaymentValidated:true,payload:prepared.legacy});
  const id=ctx.writeToken+':one-off';
  const typed=[statement('INSERT INTO one_off_payments(one_off_payment_id,household_id,business_date,category_id,description,amount_satang,paid_from_account,created_at,request_id) VALUES(?,?,?,?,?,?,?,?,?)',id,ctx.householdId,semantic.date,semantic.categoryId,semantic.description,semantic.amountSatang,semantic.paidFromAccount,ctx.nowIso,ctx.payload.requestId),statement('INSERT INTO one_off_payment_allocations VALUES(?,?,?)',id,semantic.paidFromAccount,semantic.amountSatang)];
  // Single-account write has exactly one append-only balance effect.
  plan.statements=[...typed,...plan.statements,statement("UPDATE balance_history SET one_off_payment_id=? WHERE household_id=? AND source_sheet='Cloudflare' AND source_row=?",id,ctx.householdId,ctx.nextRevision*100+1)];
  plan.response={...plan.response,paymentId:id,businessDate:semantic.date,balanceEffectDate:prepared.today};
  return plan;
 });
}
