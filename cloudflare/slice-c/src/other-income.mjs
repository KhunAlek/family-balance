import {executeRevisionClaimWrite,FinancialWriteValidationError,statement} from './write-protocol.mjs';
import {executeRequestReceiptWrite} from './request-receipts.mjs';
import {planFinancialWrite} from './write-actions.mjs';
import {bangkokBusinessDate} from '../../slice-b/src/dates.mjs';
import {reportingDate} from '../../slice-b/src/reporting.mjs';

export const OTHER_INCOME_ACTIONS=new Set(['addOtherIncomeSource','deactivateOtherIncomeSource','reactivateOtherIncomeSource']);
const primary=db=>typeof db.withSession==='function'?db.withSession('first-primary'):db;
function fail(message){throw new FinancialWriteValidationError(message);}
export function otherIncomeActive(source,versions,date){
 const applicable=versions.filter(v=>v.other_income_source_id===source.other_income_source_id&&v.effective_date<=date).sort((a,b)=>a.effective_date.localeCompare(b.effective_date)||a.created_revision-b.created_revision||a.version_id.localeCompare(b.version_id));
 return applicable.at(-1)?.active===1;
}
export async function loadOtherIncome(db,householdId='family'){
 const results=await db.batch([
  db.prepare('SELECT * FROM other_income_sources WHERE household_id=? ORDER BY name_key,other_income_source_id').bind(householdId),
  db.prepare('SELECT v.* FROM other_income_source_versions v JOIN other_income_sources s ON s.other_income_source_id=v.other_income_source_id WHERE s.household_id=? ORDER BY effective_date,created_revision,version_id').bind(householdId),
  db.prepare("SELECT r.receipt_id,COALESCE(r.other_income_source_id,s.other_income_source_id) AS other_income_source_id,r.business_date FROM income_receipts r LEFT JOIN other_income_sources s ON s.household_id=r.household_id AND s.name=r.source AND EXISTS(SELECT 1 FROM income_definitions d WHERE d.household_id=r.household_id AND d.source=r.source AND d.pay_day='Variable') WHERE r.household_id=?").bind(householdId)
 ]);
 return {sources:(results[0].results||[]).map(r=>({...r})),versions:(results[1].results||[]).map(r=>({...r})),receipts:results[2].results||[]};
}
export async function getOtherIncomeSources(db,payload={},householdId='family',today=bangkokBusinessDate()){
 const date=reportingDate(payload.date||today),data=await loadOtherIncome(primary(db),householdId);
 return {ok:true,asOf:date,sources:data.sources.map(s=>({...s,active:otherIncomeActive(s,data.versions,date)?1:0}))};
}
function semantic(action,payload){
 if(!OTHER_INCOME_ACTIONS.has(action))fail('Unsupported other-income action.');
 const fields=action==='addOtherIncomeSource'?['name']:['sourceId','effectiveDate'];
 for(const key of Object.keys(payload))if(![...fields,'action','requestId'].includes(key))fail('Unexpected other-income field: '+key);
 if(action==='addOtherIncomeSource'){
  if(typeof payload.name!=='string')fail('Income-source name is required.');
  const name=payload.name.trim().replace(/\s+/gu,' ');if(!name||name.length>120)fail('Income-source name must contain 1–120 characters.');
  return {name,nameKey:name.toLowerCase()};
 }
 if(typeof payload.sourceId!=='string'||!payload.sourceId)fail('Choose an other-income source.');
 return {sourceId:payload.sourceId,effectiveDate:reportingDate(payload.effectiveDate)};
}
function lifecyclePlan(ctx,data,values){
 if(ctx.action==='addOtherIncomeSource'){
  if(data.sources.some(s=>s.name_key===values.nameKey))fail('An other-income source with this name already exists, including inactive sources.');
  const id=ctx.writeToken+':other-income',date=bangkokBusinessDate(new Date(ctx.nowIso));
  return {statements:[statement('INSERT INTO other_income_sources VALUES(?,?,?,?)',id,ctx.householdId,values.name,values.nameKey),statement('INSERT INTO other_income_source_versions VALUES(?,?,?,?,?)',ctx.writeToken+':version',id,date,1,ctx.nextRevision)],response:{source:{other_income_source_id:id,name:values.name,name_key:values.nameKey,active:1,effectiveDate:date}}};
 }
 const source=data.sources.find(s=>s.other_income_source_id===values.sourceId);if(!source)fail('Other-income source was not found.');
 const active=ctx.action==='reactivateOtherIncomeSource'?1:0;
 if(!active&&data.receipts.some(r=>r.other_income_source_id===values.sourceId&&r.business_date>=values.effectiveDate))fail('A factual receipt exists on or after this deactivation date. Choose a later effective date.');
 return {statements:[statement('INSERT INTO other_income_source_versions VALUES(?,?,?,?,?)',ctx.writeToken+':version',values.sourceId,values.effectiveDate,active,ctx.nextRevision)],response:{source:{...source,active,effectiveDate:values.effectiveDate}}};
}
export async function previewOtherIncome(db,action,payload,options={}){
 const values=semantic(action,payload),householdId=options.householdId||'family',data=await loadOtherIncome(primary(db),householdId);
 const plan=lifecyclePlan({action,householdId,writeToken:'preview',nextRevision:0,nowIso:options.nowIso||new Date().toISOString()},data,values);
 return {ok:true,action,...plan.response};
}
export async function executeOtherIncomeWrite(db,options){
 const values=semantic(options.action,options.payload||{});
 return executeRequestReceiptWrite(db,options,values,async ctx=>lifecyclePlan(ctx,await loadOtherIncome(primary(db),ctx.householdId),values));
}
export async function executeIncomeReceipt(db,options){
 const planWrite=async ctx=>{
  if(!ctx.snapshot.otherIncomeEnabled)return planFinancialWrite(ctx);
  const id=ctx.payload.otherIncomeSourceId;
  const definition=ctx.snapshot.incomeDefinitions.find(d=>d.source===ctx.payload.incomeSource);
  if(!id&&definition&&definition.pay_day!=='Variable')return planFinancialWrite(ctx);
  if(!id)fail('Choose an explicit other-income source.');
  const data=await loadOtherIncome(primary(db),ctx.householdId),date=reportingDate(ctx.payload.date||bangkokBusinessDate(new Date(ctx.nowIso)));
  const source=data.sources.find(s=>s.other_income_source_id===id);
  if(!source||!otherIncomeActive(source,data.versions,date))fail('Other-income source is not active on the receipt date.');
  if(ctx.payload.incomeSource&&ctx.payload.incomeSource!==source.name)fail('Other-income source name and identity do not match.');
  const plan=await planFinancialWrite({...ctx,otherIncomeSource:source,payload:{...ctx.payload,incomeSource:source.name}});
  plan.statements.push(statement('UPDATE income_receipts SET other_income_source_id=? WHERE household_id=? AND receipt_id IN (?,?)',source.other_income_source_id,ctx.householdId,ctx.writeToken+':income:alex',ctx.writeToken+':income:olga'));
  const allocations=[['Alex',ctx.payload.incomeAlexAmount,ctx.writeToken+':income:alex'],['Olga',ctx.payload.incomeOlgaAmount,ctx.writeToken+':income:olga']].filter(([,amount])=>Number(amount)>0).map(([account,amount,receiptId],index)=>({account,amountSatang:Math.round(Number(amount)*100),receiptId,sourceRow:ctx.nextRevision*100+index+1}));
  const parentId=ctx.writeToken+':other-income-receipt',logicalId=ctx.writeToken+':other-income-transaction',versionId=ctx.writeToken+':other-income-version';
  const totalSatang=allocations.reduce((sum,row)=>sum+row.amountSatang,0);
  plan.statements.push(statement('INSERT INTO other_income_receipt_parents(other_income_receipt_id,household_id,other_income_source_id,business_date,total_satang,created_at_utc,request_id) VALUES(?,?,?,?,?,?,?)',parentId,ctx.householdId,source.other_income_source_id,date,totalSatang,ctx.nowIso,ctx.payload.requestId));
  for(const row of allocations) plan.statements.push(statement('INSERT INTO other_income_receipt_allocations(other_income_receipt_id,receipt_id,account,amount_satang) VALUES(?,?,?,?)',parentId,row.receiptId,row.account,row.amountSatang));
  const evidence=ctx.actorEmail?[ctx.actorEmail,ctx.nowIso,ctx.payload.requestId,ctx.writeToken,ctx.nextRevision]:[null,null,null,null,null];
  plan.statements.push(statement('INSERT INTO logical_transactions(logical_transaction_id,household_id,lifecycle_status,created_actor_email,created_at_utc,creation_request_id,creation_write_token,creation_committed_revision) VALUES(?,?,?,?,?,?,?,?)',logicalId,ctx.householdId,'active',...evidence));
  plan.statements.push(statement('INSERT INTO logical_transaction_versions(version_id,logical_transaction_id,version_number,kind,business_date,committed_revision,operation_type,management_operation_id) VALUES(?,?,1,?,?,?,\'created\',NULL)',versionId,logicalId,'other_income_receipt',date,ctx.nextRevision));
  for(const row of allocations){
   plan.statements.push(statement('INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role) VALUES(?,\'income_receipt\',?,\'receipt\')',versionId,row.receiptId));
   plan.statements.push(statement("INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role) SELECT ?,'balance_effect',CAST(balance_row_id AS TEXT),'cash_effect' FROM balance_history WHERE household_id=? AND source_sheet='Cloudflare' AND source_row=?",versionId,ctx.householdId,row.sourceRow));
  }
  plan.statements.push(statement('UPDATE logical_transactions SET terminal_version_id=? WHERE logical_transaction_id=?',versionId,logicalId));
  plan.response.logicalTransactionId=logicalId;
  return plan;
 };
 if(options.payload?.otherIncomeSourceId){
  const {requestId,...values}=options.payload;
  return executeRequestReceiptWrite(db,options,values,planWrite);
 }
 return executeRevisionClaimWrite(db,{...options,planWrite});
}
