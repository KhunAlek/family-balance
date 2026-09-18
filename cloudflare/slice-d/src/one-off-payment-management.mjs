import { statement } from '../../slice-c/src/write-protocol.mjs';
import { historyRowOrder } from '../../slice-b/src/balances.mjs';
import { bangkokBusinessDate, isoDate } from '../../slice-b/src/dates.mjs';

const ACCOUNTS=new Set(['Alex','Olga']);
const text=value=>String(value??'').trim();
const refusal=(code,message)=>({eligible:false,refusalCodes:[code],message});
const error=(code,message)=>{const value=new Error(message);value.code=code;throw value;};
const mapRows=(rows,key)=>new Map(rows.map(row=>[text(row[key]),row]));

function versionMeaning(tables,versionId,householdId='family') {
  const version=tables.logical_transaction_versions.find(row=>text(row.version_id)===versionId);
  if(!version||version.kind!=='one_off_payment') error('INVALID_PRIOR_VERSION','The required one-off version is unavailable.');
  const components=tables.logical_transaction_components.filter(row=>text(row.version_id)===versionId);
  const primary=components.filter(row=>row.component_kind==='one_off_payment'&&row.component_role==='primary');
  const allocationComponents=components.filter(row=>row.component_kind==='one_off_payment_allocation'&&row.component_role==='allocation');
  const effects=components.filter(row=>row.component_kind==='balance_effect'&&row.component_role==='cash_effect');
  if(primary.length!==1||!allocationComponents.length||effects.length>1||components.length!==1+allocationComponents.length+effects.length) error('INCOMPLETE_TYPED_COMPONENTS','The one-off transaction is not complete.');
  const payment=mapRows(tables.one_off_payments,'one_off_payment_id').get(text(primary[0].component_id));
  const allocationsById=new Map(tables.one_off_payment_allocations.map(row=>[`${row.one_off_payment_id}:${row.account}`,row]));
  const allocations=allocationComponents.map(component=>allocationsById.get(text(component.component_id)));
  if(!payment||text(payment.household_id)!==householdId||allocations.some(row=>!row||text(row.one_off_payment_id)!==text(payment.one_off_payment_id))) error('MISSING_TYPED_FACT','The one-off transaction facts are unavailable.');
  if(!Number.isSafeInteger(Number(payment.amount_satang))||Number(payment.amount_satang)<=0||new Set(allocations.map(row=>row.account)).size!==allocations.length||allocations.some(row=>!ACCOUNTS.has(row.account)||!Number.isSafeInteger(Number(row.amount_satang))||Number(row.amount_satang)<=0)||allocations.reduce((sum,row)=>sum+Number(row.amount_satang),0)!==Number(payment.amount_satang)) error('INCOMPLETE_TYPED_COMPONENTS','The one-off allocations are invalid.');
  return {version,payment,allocations:allocations.map(row=>({account:row.account,amountSatang:Number(row.amount_satang)})).sort((a,b)=>a.account.localeCompare(b.account))};
}

function priorVersion(tables,transaction) {
  const number=Number(transaction.terminalVersion.number)-1;
  if(number<1) error('PRIOR_VERSION_UNAVAILABLE','There is no prior accepted version.');
  const row=tables.logical_transaction_versions.find(value=>text(value.logical_transaction_id)===transaction.logicalTransactionId&&Number(value.version_number)===number);
  if(!row) error('PRIOR_VERSION_UNAVAILABLE','The prior accepted version is unavailable.');
  return row;
}

function latestBalances(tables,householdId='family') {
  const rows=tables.balance_history.filter(row=>text(row.household_id)===householdId&&row.alex_balance_satang!==null&&row.olga_balance_satang!==null).sort((a,b)=>text(b.business_date).localeCompare(text(a.business_date))||historyRowOrder(b)-historyRowOrder(a)||Number(b.balance_row_id)-Number(a.balance_row_id));
  if(!rows.length) error('BALANCE_AUTHORITY_UNAVAILABLE','Current account balances are unavailable.');
  return {alex:Number(rows[0].alex_balance_satang),olga:Number(rows[0].olga_balance_satang)};
}

function validateCorrection(payload,current,tables,householdId,nowIso) {
  const semantic=payload.semanticPayload||{}, allowed=new Set(['businessDate','categoryId','description','allocations','reasonCode','reasonExplanation']);
  for(const key of Object.keys(semantic)) if(!allowed.has(key)) error('UNEXPECTED_ONE_OFF_FIELD',`Unexpected one-off field: ${key}`);
  const businessDate=isoDate(semantic.businessDate); if(!businessDate) error('INVALID_BUSINESS_DATE','A valid Bangkok business date is required.');
  const today=bangkokBusinessDate(new Date(nowIso||new Date().toISOString())); if(businessDate>today) error('INVALID_BUSINESS_DATE','The payment date cannot be in the future.');
  if(!Array.isArray(semantic.allocations)||!semantic.allocations.length) error('INVALID_ALLOCATIONS','At least one allocation is required.');
  const allocations=semantic.allocations.map(row=>({account:text(row?.account),amountSatang:Number(row?.amountSatang)}));
  if(allocations.some(row=>!ACCOUNTS.has(row.account)||!Number.isSafeInteger(row.amountSatang)||row.amountSatang<=0)||new Set(allocations.map(row=>row.account)).size!==allocations.length) error('INVALID_ALLOCATIONS','Allocations must use each supported account at most once and contain positive integer satang.');
  allocations.sort((a,b)=>a.account.localeCompare(b.account));
  const categoryId=semantic.categoryId===null||semantic.categoryId===undefined||semantic.categoryId===''?null:text(semantic.categoryId);
  if(categoryId){const category=tables.one_off_categories.find(row=>text(row.household_id)===householdId&&text(row.category_id)===categoryId);if(!category||(Number(category.active)!==1&&categoryId!==text(current.payment.category_id)))error('CATEGORY_NOT_ELIGIBLE','The selected category is not active for this correction.');}
  const description=semantic.description===null||semantic.description===undefined?'':text(semantic.description);if(description.length>500||(!categoryId&&!description))error('INVALID_DESCRIPTION','An uncategorized payment needs a description of at most 500 characters.');
  return {businessDate,categoryId,description:description||null,allocations,totalSatang:allocations.reduce((sum,row)=>sum+row.amountSatang,0)};
}

function latestAudit(tables,transaction) { return tables.transaction_management_audit.find(row=>text(row.resulting_version_id)===transaction.terminalVersion.id)||null; }

function validateReason(payload) {
  const semantic=payload.semanticPayload||{}, reason=text(semantic.reasonCode);
  if(!reason) error('INVALID_REASON','A management reason is required.');
  if(payload.operation==='deleted') {
    const allowed=new Set(['entered_by_mistake','duplicate_entry','wrong_household','test_entry','other']);
    if(!allowed.has(reason)) error('INVALID_REASON','Choose a supported deletion reason.');
    if(reason==='other'&&!text(semantic.reasonExplanation)) error('REASON_EXPLANATION_REQUIRED','An explanation is required for Other.');
  }
}

export function oneOffEligibility({transaction,payload,tables,householdId='family',nowIso}) {
  if(transaction.kind!=='one_off_payment') return refusal('MANAGEMENT_NOT_ENABLED_FOR_KIND','Only one-off payment management is enabled.');
  const operation=text(payload.operation);
  if(operation==='replaced') return refusal('REPLACEMENT_NOT_ENABLED','Transaction replacement is not enabled.');
  try { versionMeaning(tables,transaction.terminalVersion.id,householdId); } catch(e) { return refusal(e.code||'INCOMPLETE_TYPED_COMPONENTS',e.message); }
  if(operation==='corrected'||operation==='deleted') return transaction.lifecycle==='active'?{eligible:true,refusalCodes:[]} : refusal('ACTIVE_TRANSACTION_REQUIRED','Only an active payment can be corrected or deleted.');
  if(operation==='restored') { if(transaction.lifecycle!=='deleted')return refusal('DELETED_TRANSACTION_REQUIRED','Only a deleted payment can be restored.'); try{const prior=priorVersion(tables,transaction);versionMeaning(tables,text(prior.version_id));}catch(e){return refusal(e.code||'PRIOR_VERSION_UNAVAILABLE',e.message);} return {eligible:true,refusalCodes:[]}; }
  if(operation==='undone') { const audit=latestAudit(tables,transaction); if(!audit)return refusal('LATEST_MANAGEMENT_OPERATION_REQUIRED','There is no latest management operation to undo.'); const age=new Date(nowIso||new Date().toISOString()).getTime()-new Date(audit.committed_at_utc).getTime(); if(!Number.isFinite(age)||age<0||age>600000)return refusal('UNDO_WINDOW_EXPIRED','Undo is available for 10 minutes.'); const revision=Number(tables.household_revisions.find(row=>text(row.household_id)===householdId)?.current_revision);if(revision!==Number(audit.committed_revision))return refusal('DEPENDENT_ACTIVITY_EXISTS','Later household activity prevents safe undo.'); try{versionMeaning(tables,text(audit.prior_version_id),householdId);}catch(e){return refusal(e.code||'PRIOR_VERSION_UNAVAILABLE',e.message);} return {eligible:true,refusalCodes:[],expiresAt:new Date(new Date(audit.committed_at_utc).getTime()+600000).toISOString()}; }
  return refusal('INVALID_MANAGEMENT_OPERATION','This one-off operation is not supported.');
}

function targetMeaning(transaction,payload,tables,householdId='family',nowIso) {
  validateReason(payload);
  const current=versionMeaning(tables,transaction.terminalVersion.id,householdId);
  if(payload.operation==='corrected') return {...validateCorrection(payload,current,tables,householdId,nowIso),lifecycle:'active'};
  if(payload.operation==='deleted') return {businessDate:text(current.payment.business_date),categoryId:current.payment.category_id??null,description:current.payment.description??null,allocations:current.allocations,totalSatang:Number(current.payment.amount_satang),lifecycle:'deleted'};
  const prior=priorVersion(tables,transaction), meaning=versionMeaning(tables,text(prior.version_id));
  const lifecycle=prior.operation_type==='deleted'?'deleted':'active';
  return {businessDate:text(meaning.payment.business_date),categoryId:meaning.payment.category_id??null,description:meaning.payment.description??null,allocations:meaning.allocations,totalSatang:Number(meaning.payment.amount_satang),lifecycle};
}

function impact(transaction,target,tables) {
  const current=versionMeaning(tables,transaction.terminalVersion.id), before=transaction.lifecycle==='active'?current.allocations:[], after=target.lifecycle==='active'?target.allocations:[];
  const amount=(rows,account)=>rows.find(row=>row.account===account)?.amountSatang||0;
  const perAccount={alexSatang:amount(before,'Alex')-amount(after,'Alex'),olgaSatang:amount(before,'Olga')-amount(after,'Olga')};
  return {before:{lifecycle:transaction.lifecycle,businessDate:current.payment.business_date,totalSatang:Number(current.payment.amount_satang),allocations:current.allocations},after:{lifecycle:target.lifecycle,businessDate:target.businessDate,totalSatang:target.totalSatang,allocations:target.allocations},cashChangeSatang:perAccount,combinedCashChangeSatang:perAccount.alexSatang+perAccount.olgaSatang,reconciliation:{balanceObservationsMutated:false}};
}

export async function buildOneOffPreview({transaction,payload,tables,householdId='family',nowIso}) { const target=targetMeaning(transaction,payload,tables,householdId,nowIso);return impact(transaction,target,tables); }

export async function buildOneOffReplacement({transaction,payload,tables,householdId='family',nowIso}) {
  const target=targetMeaning(transaction,payload,tables,householdId,nowIso), summary=impact(transaction,target,tables), balances=latestBalances(tables,householdId), requestId=text(payload.requestId), paymentId=`managed-one-off:${transaction.logicalTransactionId}:${requestId}`, balanceId=1_000_000_000+(Number(payload.baseRevision)+1)*100+1, effectiveNow=nowIso||new Date().toISOString(), effectDate=bangkokBusinessDate(new Date(effectiveNow));
  const alex=balances.alex+summary.cashChangeSatang.alexSatang,olga=balances.olga+summary.cashChangeSatang.olgaSatang;
  if(alex<0||olga<0)error('INSUFFICIENT_ACCOUNT_BALANCE','The corrected payment would make an account balance negative.');
  const paidFrom=target.allocations.length===1?target.allocations[0].account:null;
  const facts=[statement('INSERT INTO one_off_payments(one_off_payment_id,household_id,business_date,category_id,description,amount_satang,paid_from_account,created_at,request_id,legacy_origin) VALUES(?,?,?,?,?,?,?,?,?,NULL)',paymentId,householdId,target.businessDate,target.categoryId,target.description,target.totalSatang,paidFrom,effectiveNow,requestId),...target.allocations.map(row=>statement('INSERT INTO one_off_payment_allocations VALUES(?,?,?)',paymentId,row.account,row.amountSatang)),statement("INSERT INTO balance_history(balance_row_id,household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,source_sheet,source_row,one_off_payment_id) VALUES(?,?,?,?,?,?,?,?,?,'Cloudflare',?,?)",balanceId,householdId,effectDate,balanceId,alex,olga,target.description,target.totalSatang,paidFrom,balanceId,paymentId)];
  return {kind:'one_off_payment',businessDate:target.businessDate,lifecycle:target.lifecycle,impactSummary:summary,factStatements:facts,components:[{kind:'one_off_payment',id:paymentId,role:'primary'},...target.allocations.map(row=>({kind:'one_off_payment_allocation',id:`${paymentId}:${row.account}`,role:'allocation'})),{kind:'balance_effect',id:String(balanceId),role:'cash_effect'}]};
}
