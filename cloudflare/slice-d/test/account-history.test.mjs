import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {BACKUP_TABLES} from '../src/backup.mjs';import {buildAccountHistory,runAccountHistory} from '../src/account-history.mjs';
import {createSeededSqliteD1} from '../../slice-c/test/sqlite-d1.mjs';import {executeTypedPayment} from '../../slice-c/src/typed-payment.mjs';
import {previewTransactionManagement,executeTransactionManagementCommit} from '../src/transaction-management-protocol.mjs';import {oneOffEligibility,buildOneOffPreview,buildOneOffReplacement} from '../src/one-off-payment-management.mjs';
const base=()=>({...Object.fromEntries(BACKUP_TABLES.map(x=>[x,[]])),households:[{household_id:'family'}],household_revisions:[{household_id:'family',current_revision:5}],salary_cycle_state:[{household_id:'family',current_cycle_start:'2026-10-01',next_salary_date:'2026-11-01'}]});
function row(t,id,alex,olga,extra={}){const value={balance_row_id:id,household_id:'family',business_date:'2026-10-16',sheet_order:id,source_sheet:'Balance Check',source_row:id,alex_balance_satang:alex,olga_balance_satang:olga,one_off_payment_id:null,obligation_payment_id:null,one_off_payment_name:null,income_receipt_source:null,...extra};t.balance_history.push(value);return value;}
function identity(t,id,kind,components,date='2026-10-16'){
 t.logical_transactions.push({logical_transaction_id:id,household_id:'family',lifecycle_status:'active',terminal_version_id:id+'-v1'});
 t.logical_transaction_versions.push({version_id:id+'-v1',logical_transaction_id:id,version_number:1,kind,business_date:date,committed_revision:1,operation_type:'created',management_operation_id:null});
 for(const [kind,id2,role]of components)t.logical_transaction_components.push({version_id:id+'-v1',component_kind:kind,component_id:String(id2),component_role:role});
}
function payment(t,id,rowId,alex,olga){t.one_off_payments.push({one_off_payment_id:id,household_id:'family',business_date:'2026-10-16',amount_satang:alex+olga,description:'Groceries',category_id:null});for(const [name,amount]of [['Alex',alex],['Olga',olga]])if(amount)t.one_off_payment_allocations.push({one_off_payment_id:id,account:name,amount_satang:amount});identity(t,id,'one_off_payment',[['one_off_payment',id,'primary'],...t.one_off_payment_allocations.filter(x=>x.one_off_payment_id===id).map(x=>['one_off_payment_allocation',id+':'+x.account,'allocation']),...(rowId==null?[]:[['balance_effect',rowId,'cash_effect']])]);}

test('partial observations carry only known balances and expose discrepancies without invented cash movements',async()=>{
 const t=base();row(t,1,1000,null);row(t,2,null,500);row(t,3,900,null);
 const original=JSON.stringify(t),x=await buildAccountHistory(t);
 assert.deepEqual(x.entries.map(x=>x.balancesAfterSatang),[{alex:900,olga:500,combined:1400},{alex:1000,olga:500,combined:1500},{alex:1000,olga:null,combined:null}]);
 assert.equal(x.entries[0].changesSatang,null);assert.equal(x.entries[0].discrepancySatang.alex,-100);assert.equal(JSON.stringify(t),original);
});

test('Both shows one split payment with signed allocations and the recorded balance after',async()=>{
 const t=base();row(t,1,1000,1000);row(t,2,940,960,{one_off_payment_id:'split'});payment(t,'split',2,60,40);
 const x=await buildAccountHistory(t);assert.equal(x.entries.length,2);assert.deepEqual(x.entries[0].changesSatang,{alex:-60,olga:-40});assert.deepEqual(x.entries[0].balancesAfterSatang,{alex:940,olga:960,combined:1900});
 const filtered=await buildAccountHistory(t,{account:'Olga'});assert.deepEqual(filtered.entries[0],x.entries[0]);
});

test('internal transfers keep combined cash unchanged and remain a single row',async()=>{
 const t=base();row(t,1,1000,500);row(t,2,900,600);
 t.ktb_transfers.push({transfer_id:'transfer',household_id:'family',business_date:'2026-10-16',source_account:'Alex',destination_account:'Olga',amount_satang:100,balance_effect_id:2});identity(t,'transfer','ktb_transfer',[['balance_effect',2,'cash_effect']]);
 const x=await buildAccountHistory(t);assert.deepEqual(x.entries[0].changesSatang,{alex:-100,olga:100});assert.equal(x.entries[0].balancesAfterSatang.combined,1500);assert.match(x.entries[0].title,/Alex → Olga/);
});

test('two salary receipt effects merge once and only credit each linked destination',async()=>{
 const t=base();row(t,1,100,200);row(t,2,1100,200);row(t,3,1100,700);
 t.income_receipts.push({receipt_id:'salary-a',household_id:'family',source:'Salary',business_date:'2026-10-16',amount_satang:1000,lands_in:'Alex KTB',source_balance_row_id:2},{receipt_id:'salary-o',household_id:'family',source:'Salary',business_date:'2026-10-16',amount_satang:500,lands_in:'Olga KTB',source_balance_row_id:3});
 t.salary_receipt_parents.push({salary_receipt_parent_id:'parent',household_id:'family',source:'Salary',business_date:'2026-10-16',total_satang:1500,alex_receipt_id:'salary-a',olga_receipt_id:'salary-o'});
 identity(t,'salary','salary_receipt',[['income_receipt','salary-a','receipt'],['income_receipt','salary-o','receipt'],['balance_effect',2,'cash_effect'],['balance_effect',3,'cash_effect']]);
 const x=await buildAccountHistory(t);assert.equal(x.entries.length,2);assert.deepEqual(x.entries[0].changesSatang,{alex:1000,olga:500});assert.equal(x.entries[0].balancesAfterSatang.combined,1800);
});

test('filtering, stable pagination and shuffled input preserve balance context and reject stale/invalid cursors',async()=>{
 const t=base();row(t,1,1000,500,{business_date:'2026-10-14'});row(t,2,900,null,{business_date:'2026-10-15'});row(t,3,null,400);row(t,4,800,null);
 const all=await buildAccountHistory(t),first=await buildAccountHistory(t,{pageSize:1}),second=await buildAccountHistory(t,{pageSize:1,cursor:first.pagination.nextCursor});assert.equal(second.entries[0].id,all.entries[1].id);
 const custom=await buildAccountHistory(t,{period:'custom',customFrom:'2026-10-15',customThrough:'2026-10-15'});assert.equal(custom.entries.length,1);assert.deepEqual(custom.entries[0].balancesAfterSatang,{alex:900,olga:500,combined:1400});
 const reversed=Object.fromEntries(Object.entries(t).map(([name,rows])=>[name,[...rows].reverse()]));assert.deepEqual(await buildAccountHistory(reversed),all);
 await assert.rejects(buildAccountHistory(t,{pageSize:1,account:'Alex',cursor:first.pagination.nextCursor}),/INVALID_CURSOR/);
 t.household_revisions[0].current_revision++;await assert.rejects(buildAccountHistory(t,{pageSize:1,cursor:first.pagination.nextCursor}),/STALE_ACCOUNT_HISTORY_QUERY/);
 await assert.rejects(buildAccountHistory(t,{account:'Nobody'}));await assert.rejects(buildAccountHistory(t,{cursor:'garbage'}));
});

test('unlinked balances and transactions without a recorded effect never manufacture a running balance',async()=>{
 const t=base();row(t,1,1000,500,{one_off_payment_name:'Unverified movement'});payment(t,'no-effect',null,100,0);
 const x=await buildAccountHistory(t);const missing=x.entries.find(x=>x.logicalTransactionId==='no-effect');assert.equal(missing.balanceAvailable,false);assert.deepEqual(missing.balancesAfterSatang,{alex:null,olga:null,combined:null});assert.equal(x.entries.find(x=>x.entryType==='unlinked_balance').changesSatang,null);
});

test('actual correction and later creation retain original debit, correction delta and chronological balances; service writes nothing',async t=>{
 const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n>='0006'&&n<'0020').sort())raw.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const nowIso='2026-08-15T12:00:00.000Z',payload={requestId:'timeline-create',date:'2026-08-14',description:'Original debit',amount:100,paidFromAccount:'Alex'},save=extra=>executeTypedPayment(db,{action:'oneOffPayment',actorEmail:'alex@example.com',nowIso,payload,...extra});
 const created=await save(),management={actorEmail:'alex@example.com',nowIso,eligibility:oneOffEligibility,buildPreview:buildOneOffPreview,buildReplacement:buildOneOffReplacement},semanticPayload={businessDate:'2026-08-14',categoryId:null,description:'Corrected debit',allocations:[{account:'Alex',amountSatang:8000}],reasonCode:'owner_correction'};
 const preview=await previewTransactionManagement(db,{logicalTransactionId:created.logicalTransactionId,operation:'corrected',semanticPayload},'family',management);
 await executeTransactionManagementCommit(db,{requestId:'timeline-correct',logicalTransactionId:created.logicalTransactionId,operation:'corrected',semanticPayload,baseRevision:preview.baseRevision,terminalVersionId:preview.terminalVersionId},management);
 const later=await save({payload:{...payload,requestId:'timeline-later',description:'Later debit'}});
 const before=raw.prepare('SELECT total_changes() n').get().n;const x=await runAccountHistory(db,{period:'custom',customFrom:'2026-08-15',customThrough:'2026-08-15'});
 assert.equal(raw.prepare('SELECT total_changes() n').get().n,before);
 const chain=x.entries.filter(x=>[created.logicalTransactionId,later.logicalTransactionId].includes(x.logicalTransactionId));
 assert.deepEqual(chain.map(x=>x.changesSatang.alex),[-10000,2000,-10000]);assert.equal(chain[0].title,'Later debit');assert.match(chain[1].title,/Correction/);assert.equal(chain[2].businessDate,'2026-08-14');assert.equal(chain[2].postingDate,'2026-08-15');assert.equal(chain[0].balancesAfterSatang.alex,chain[1].balancesAfterSatang.alex-10000);
 const {loadFinancialSnapshot}=await import('../../slice-b/src/d1-repository.mjs'),{latestUsableBalance}=await import('../../slice-b/src/balances.mjs');assert.equal(Math.round(latestUsableBalance((await loadFinancialSnapshot(db)).balanceHistory).alex*100),chain[0].balancesAfterSatang.alex);
});

test('authenticated same-origin Account history route is read-only and rejects invalid filters',async t=>{
 const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n>='0006'&&n<'0020').sort())raw.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const {handleFetch}=await import('../src/index.js'),{signSession}=await import('../src/auth.mjs');
 const env={DB:db,GOOGLE_CLIENT_ID:'client',APPROVED_GOOGLE_EMAILS:'alex@example.com',SESSION_SIGNING_KEY:'account-history-signing-key-long-enough'};
 const token=await signSession({sub:'subject',email:'alex@example.com'},env,{jti:'account-history-route'}),origin='https://family.example';
 const request=(payload={},authenticated=true,source=origin)=>new Request(origin+'/api/action',{method:'POST',headers:{origin:source,'content-type':'application/json',...(authenticated?{cookie:'fcf_session='+token}:{})},body:JSON.stringify({apiAction:'accountHistory',payload})});
 const before=raw.prepare('SELECT total_changes() n').get().n;
 const response=await handleFetch(request(),env);assert.equal(response.status,200);assert.equal((await response.json()).format,'family-cash-flow-account-history-v1');
 const invalid=await handleFetch(request({account:'Unknown'}),env);assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'INVALID_ACCOUNT_FILTER');
 assert.equal((await handleFetch(request({},false),env)).status,401);assert.equal((await handleFetch(request({},true,'https://evil.example'),env)).status,403);
 assert.equal(raw.prepare('SELECT total_changes() n').get().n,before);
});

test('account timeline does not expose another household without recorded balance effects',async()=>{
 const t=base();row(t,1,1000,500);payment(t,'foreign-payment',null,100,0);
 t.one_off_payments[0].household_id='other';t.logical_transactions[0].household_id='other';t.households.push({household_id:'other'});
 const x=await buildAccountHistory(t);assert.equal(x.entries.length,1);assert.equal(x.entries[0].logicalTransactionId,null);
});

test('receipt correction that removes an account retains its reversal delta exactly once',async()=>{
 const t=base();row(t,1,100,200);row(t,2,1100,200);row(t,3,1100,700);
 t.income_receipts.push({receipt_id:'salary-a',household_id:'family',source:'Salary',business_date:'2026-10-16',amount_satang:1000,lands_in:'Alex KTB',source_balance_row_id:2},{receipt_id:'salary-o',household_id:'family',source:'Salary',business_date:'2026-10-16',amount_satang:500,lands_in:'Olga KTB',source_balance_row_id:3});
 t.salary_receipt_parents.push({salary_receipt_parent_id:'parent',household_id:'family',source:'Salary',business_date:'2026-10-16',total_satang:1500,alex_receipt_id:'salary-a',olga_receipt_id:'salary-o'});
 identity(t,'salary','salary_receipt',[['income_receipt','salary-a','receipt'],['income_receipt','salary-o','receipt'],['balance_effect',2,'cash_effect'],['balance_effect',3,'cash_effect']]);
 row(t,4,100,1700,{source_sheet:'Cloudflare',source_row:1900000201});
 t.income_receipts.push({receipt_id:'corrected-o',household_id:'family',source:'Salary',business_date:'2026-10-16',amount_satang:1500,lands_in:'Olga KTB',source_balance_row_id:4});
 t.salary_receipt_parents.push({salary_receipt_parent_id:'parent2',household_id:'family',source:'Salary',business_date:'2026-10-16',total_satang:1500,alex_receipt_id:null,olga_receipt_id:'corrected-o'});
 t.logical_transactions[0].terminal_version_id='salary-v2';
 t.logical_transaction_versions.push({version_id:'salary-v2',logical_transaction_id:'salary',version_number:2,kind:'salary_receipt',business_date:'2026-10-16',committed_revision:2,operation_type:'corrected',management_operation_id:'salary-correction'});
 for(const [kind,id,role]of [['income_receipt','corrected-o','receipt'],['balance_effect',4,'cash_effect']])t.logical_transaction_components.push({version_id:'salary-v2',component_kind:kind,component_id:String(id),component_role:role});
 t.transaction_management_audit.push({operation_id:'salary-correction',logical_transaction_id:'salary',operation_type:'corrected',prior_version_id:'salary-v1',resulting_version_id:'salary-v2',committed_revision:2,committed_at_utc:'2026-10-16T12:00:00.000Z',impact_summary_json:JSON.stringify({cashChangeSatang:{alexSatang:-1000,olgaSatang:1000}})});
 const x=await buildAccountHistory(t);assert.deepEqual(x.entries[0].changesSatang,{alex:-1000,olga:1000});assert.equal(x.entries[0].balancesAfterSatang.combined,1800);assert.equal((await buildAccountHistory(t,{account:'Alex'})).entries[0].id,x.entries[0].id);
});
