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
  const data=await loadOtherIncome(primary(db),ctx.householdId),date=reportingDate(ctx.payload.date||bangkokBusinessDate(new Date(ctx.nowIso)));
  const source=id?data.sources.find(s=>s.other_income_source_id===id):data.sources.find(s=>s.name===ctx.payload.incomeSource);
  if(!source||!otherIncomeActive(source,data.versions,date))fail('Other-income source is not active on the receipt date.');
  if(ctx.payload.incomeSource&&ctx.payload.incomeSource!==source.name)fail('Other-income source name and identity do not match.');
  const plan=await planFinancialWrite({...ctx,otherIncomeSource:source,payload:{...ctx.payload,incomeSource:source.name}});
  plan.statements.push(statement('UPDATE income_receipts SET other_income_source_id=? WHERE household_id=? AND receipt_id IN (?,?)',source.other_income_source_id,ctx.householdId,ctx.writeToken+':income:alex',ctx.writeToken+':income:olga'));
  return plan;
 };
 if(options.payload?.otherIncomeSourceId && options.payload?.requestId){
  const {requestId,...values}=options.payload;
  return executeRequestReceiptWrite(db,options,values,planWrite);
 }
 return executeRevisionClaimWrite(db,{...options,planWrite});
}
