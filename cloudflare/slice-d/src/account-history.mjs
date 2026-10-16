import {BACKUP_TABLES} from './backup.mjs';
import {buildTerminalTransactionReadModel,recordedTransactionVersions} from './terminal-transaction-read-model.mjs';
import {buildTransactionHistory} from './transaction-history.mjs';
import {historyRowOrder} from '../../slice-b/src/balances.mjs';

const names=['alex','olga'],text=x=>String(x??''),account=x=>text(x).replace(/ KTB$/,'').toLowerCase();
export class AccountHistoryError extends Error{constructor(code){super(code);this.code=code;this.restartRequired=code==='INVALID_CURSOR'||code==='STALE_ACCOUNT_HISTORY_QUERY';}}
const fail=code=>{throw new AccountHistoryError(code);};
const sha=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))),b=>b.toString(16).padStart(2,'0')).join('');
const order=row=>[row.business_date,historyRowOrder(row),Number(row.balance_row_id)];
const compare=(a,b)=>text(a[0]).localeCompare(text(b[0]))||a[1]-b[1]||a[2]-b[2];
const empty=()=>({alex:null,olga:null,combined:null});
function combined(b){return {...b,combined:b.alex==null||b.olga==null?null:b.alex+b.olga};}
function title(tx){
 if(tx.kind==='ktb_transfer')return `Transfer: ${tx.source} → ${tx.payee}`;
 if(tx.fund)return `${tx.fund.goalName||'Emergency fund'} · ${tx.fund.direction}`;
 return tx.description||tx.payee||tx.source||tx.category?.name||'Payment';
}
function changes(tx){
 const result={alex:0,olga:0};
 for(const allocation of tx.allocations||[]){const key=account(allocation.account);if(names.includes(key))result[key]+=tx.direction==='money_out'?-Number(allocation.amountSatang):Number(allocation.amountSatang);}
 return result;
}
function encode(value){return btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decode(value){try{const normalized=value.replaceAll('-','+').replaceAll('_','/');return JSON.parse(atob(normalized+'='.repeat((4-normalized.length%4)%4)));}catch{fail('INVALID_CURSOR');}}

export async function buildAccountHistory(tables,payload={},householdId='family'){
 const selected=payload.account||'Both';if(!['Alex','Olga','Both'].includes(selected))fail('INVALID_ACCOUNT_FILTER');
 const pageSize=payload.pageSize===undefined?50:Number(payload.pageSize);if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail('INVALID_PAGE_SIZE');
 const periodQuery={period:payload.period||'all',...(payload.period==='custom'?{customFrom:payload.customFrom,customThrough:payload.customThrough}:{}),pageSize:1};
 const {period}=await buildTransactionHistory(tables,periodQuery,householdId);
 const query={account:selected,period:periodQuery.period,customFrom:payload.customFrom??null,customThrough:payload.customThrough??null,text:text(payload.text).trim().toLowerCase(),pageSize};
 const queryHash=await sha(JSON.stringify(query));const revision=Number(tables.household_revisions.find(x=>x.household_id===householdId)?.current_revision);
 const canonical=buildTerminalTransactionReadModel(tables);
 const belongs=tx=>tx.identitySource==='persisted'?tables.logical_transactions.some(row=>row.logical_transaction_id===tx.logicalTransactionId&&row.household_id===householdId):tx.components.some(c=>c.kind==='one_off_payment'?tables.one_off_payments.some(row=>text(row.one_off_payment_id)===text(c.id)&&row.household_id===householdId):c.kind==='income_receipt'&&tables.income_receipts.some(row=>text(row.receipt_id)===text(c.id)&&row.household_id===householdId));
 const transactions=[...canonical.activeTransactions,...canonical.deletedTransactions].filter(belongs);
 const versions=recordedTransactionVersions(tables,householdId),owners=new Map(),claimedTransactions=new Set();
 for(const tx of [...versions,...transactions.filter(x=>x.identitySource==='historical_adapter')]){
  const key=tx.versionId||'legacy:'+tx.logicalTransactionId;
  for(const c of tx.components.filter(x=>x.kind==='balance_effect')){
   const id=text(c.id);if(owners.has(id)&&owners.get(id).key!==key)fail('AMBIGUOUS_EFFECT_OWNER');
   owners.set(id,{key,tx});claimedTransactions.add(tx.logicalTransactionId);
  }
 }
 // Durable income receipt links also exist for historical receipts without an
 // explicit balance-effect component. Never infer a relation from amount/date.
 for(const tx of transactions.filter(x=>x.identitySource==='historical_adapter'))for(const c of tx.components.filter(x=>x.kind==='income_receipt')){
  const receipt=tables.income_receipts.find(x=>text(x.receipt_id)===text(c.id));if(receipt?.source_balance_row_id==null)continue;
  const id=text(receipt.source_balance_row_id),key='legacy:'+tx.logicalTransactionId;
  if(owners.has(id)&&owners.get(id).key!==key)fail('AMBIGUOUS_EFFECT_OWNER');owners.set(id,{key,tx});claimedTransactions.add(tx.logicalTransactionId);
 }
 const postingOrder=row=>{
  const tx=owners.get(text(row.balance_row_id))?.tx;
  if(tx?.operationType&&tx.operationType!=='created'&&tx.recordedAtUtc)return [new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(tx.recordedAtUtc)),1_000_000_000+Number(tx.committedRevision)*100+Number(row.balance_row_id)%100,Number(row.balance_row_id)];
  return order(row);
 };
 const rows=tables.balance_history.filter(x=>x.household_id===householdId).sort((a,b)=>compare(postingOrder(a),postingOrder(b)));
 const events=[],running={alex:null,olga:null};let last=null;
 for(const row of rows){
  const owner=owners.get(text(row.balance_row_id)),tx=owner?.tx,previous=combined(running);
  const recorded=Object.fromEntries(names.map(name=>[name,row[name+'_balance_satang']!=null]));
  for(const name of names)if(recorded[name]){const value=Number(row[name+'_balance_satang']);if(!Number.isSafeInteger(value))fail('INVALID_RECORDED_BALANCE');running[name]=value;}
  const after=combined(running),same=owner&&last?.ownerKey===owner.key;
  let event;
  if(same)event=last;
  else{
   const operation=tx?.operationType||'created';const prefix=operation==='created'?'':({corrected:'Correction',deleted:'Deletion',restored:'Restoration',undone:'Undo'}[operation]||'Change')+' — ';
   const manual=!tx&&!row.one_off_payment_name&&!row.income_receipt_source;
   event={id:'balance:'+row.balance_row_id,ownerKey:owner?.key||null,entryType:tx?'transaction':manual?'balance_update':'unlinked_balance',title:tx?prefix+title(tx):manual?'Balance update':text(row.one_off_payment_name||row.income_receipt_source)||'Balance record',postingDate:postingOrder(row)[0],businessDate:tx?.businessDate||row.business_date,recordedAtUtc:tx?.recordedAtUtc||null,operationType:tx?operation:null,logicalTransactionId:tx?.logicalTransactionId||null,changesSatang:tx?{alex:0,olga:0}:null,affectedAccounts:tx?[...new Set(tx.allocations.map(x=>account(x.account)).concat(names.filter(name=>Number(tx.cashChangeSatang?.[name+'Satang']||0)!==0)))]:[],balancesBeforeSatang:previous,balancesAfterSatang:after,recordedAccounts:{alex:false,olga:false},discrepancySatang:{alex:null,olga:null},orderingKey:postingOrder(row),balanceRowIds:[],balanceAvailable:true};
   events.push(event);
  }
  event.balanceRowIds.push(Number(row.balance_row_id));event.orderingKey=postingOrder(row);event.postingDate=postingOrder(row)[0];event.balancesAfterSatang=after;
  for(const name of names)event.recordedAccounts[name] ||= recorded[name];
  if(tx){
   const delta=tx.cashChangeSatang?{alex:Number(tx.cashChangeSatang.alexSatang||0),olga:Number(tx.cashChangeSatang.olgaSatang||0)}:changes(tx);
   const receipts=tables.income_receipts.filter(r=>text(r.source_balance_row_id)===text(row.balance_row_id));
   for(const name of names){if(tx.cashChangeSatang&&same)continue;
    if(!tx.cashChangeSatang&&receipts.length&&!receipts.some(r=>account(r.lands_in)===name))continue;
    // An atomic split receipt can have one row per destination; a shared
    // effect row carries the complete per-account movement only once.
    if(!Number.isSafeInteger(delta[name]))fail('INVALID_CASH_CHANGE');
    if(same&&!receipts.length)continue;event.changesSatang[name]+=delta[name];
   }
  }else for(const name of names)if(recorded[name]&&previous[name]!=null)event.discrepancySatang[name]=after[name]-previous[name];
  last=event;
 }
 // Records without an authoritative posting balance stay visible, with no
 // manufactured running value or within-day position.
 for(const tx of transactions.filter(x=>!claimedTransactions.has(x.logicalTransactionId)))events.push({id:'transaction:'+tx.logicalTransactionId,entryType:'transaction',title:title(tx),postingDate:tx.businessDate,businessDate:tx.businessDate,recordedAtUtc:null,logicalTransactionId:tx.logicalTransactionId,operationType:'created',changesSatang:tx.lifecycle==='deleted'?null:changes(tx),affectedAccounts:tx.allocations.map(x=>account(x.account)),balancesAfterSatang:empty(),balancesBeforeSatang:empty(),recordedAccounts:{alex:false,olga:false},discrepancySatang:{alex:null,olga:null},orderingKey:[tx.businessDate,-1,0],balanceRowIds:[],balanceAvailable:false});
 const visible=events.filter(event=>{
  if(period.from&&event.postingDate<period.from||period.throughExclusive&&event.postingDate>=period.throughExclusive||period.throughInclusive&&event.postingDate>period.throughInclusive)return false;
  const name=selected.toLowerCase();if(selected!=='Both'&&!(event.entryType==='transaction'?event.affectedAccounts.includes(name):event.recordedAccounts[name]))return false;
  if(query.text&&!text([event.title,event.businessDate,event.postingDate,event.changesSatang?.alex?'Alex':'',event.changesSatang?.olga?'Olga':''].join(' ')).toLowerCase().includes(query.text))return false;
  return true;
 }).sort((a,b)=>compare(b.orderingKey,a.orderingKey)||a.id.localeCompare(b.id));
 let offset=0;
 if(payload.cursor){const cursor=decode(payload.cursor);if(!cursor||!Number.isSafeInteger(cursor.revision)||!/^([a-f0-9]{64})$/.test(cursor.queryHash)||typeof cursor.id!=='string')fail('INVALID_CURSOR');if(cursor.revision!==revision)fail('STALE_ACCOUNT_HISTORY_QUERY');if(cursor.queryHash!==queryHash)fail('INVALID_CURSOR');const index=visible.findIndex(x=>x.id===cursor.id);if(index<0)fail('INVALID_CURSOR');offset=index+1;}
 const entries=visible.slice(offset,offset+pageSize),hasMore=offset+entries.length<visible.length;
 return {ok:true,format:'family-cash-flow-account-history-v1',householdRevision:revision,account:selected,period,entries,pagination:{resultCount:visible.length,pageSize,hasMore,nextCursor:hasMore?encode({revision,queryHash,id:entries.at(-1).id}):null},ordering:'recorded_balance_order_desc',balanceMeaning:'Recorded balances after each posting; previous recorded counterpart carried forward when only one account was updated.'};
}
export async function runAccountHistory(db,payload={},householdId='family'){
 const target=typeof db.withSession==='function'?db.withSession('first-primary'):db;
 const results=await target.batch(BACKUP_TABLES.map(name=>target.prepare('SELECT * FROM "'+name+'" ORDER BY rowid')));
 if(results.length!==BACKUP_TABLES.length)fail('INCOMPLETE_INVENTORY');
 const tables=Object.fromEntries(BACKUP_TABLES.map((name,index)=>[name,results[index].results||[]]));return buildAccountHistory(tables,payload,householdId);
}
