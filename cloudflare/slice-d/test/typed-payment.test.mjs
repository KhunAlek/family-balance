import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createSeededSqliteD1} from '../../slice-c/test/sqlite-d1.mjs';
import {previewTypedPayment,executeTypedPayment} from '../../slice-c/src/typed-payment.mjs';
import {executeCategoryWrite} from '../../slice-c/src/new-function-categories.mjs';
import {loadFinancialSnapshot} from '../../slice-b/src/d1-repository.mjs';
import {buildPlanningState,computeCycleVariablesSpentToDate} from '../../slice-b/src/planning.mjs';
import {latestUsableBalance} from '../../slice-b/src/balances.mjs';
import {buildPortableBackup} from '../src/backup.mjs';
import {buildRestoreSql} from '../tools/portable-restore.mjs';
const nowIso='2026-08-15T12:00:00.000Z';
const rows=(raw,t)=>raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
function fixture(t){const f=createSeededSqliteD1();t.after(()=>f.raw.close());for(const n of ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql'])f.raw.exec(fs.readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));return f;}
const payload=(extra={})=>({date:'2026-08-14',description:'Synthetic test payment',amount:100,paidFromAccount:'Alex',requestId:'payment',...extra});
const save=(db,p=payload(),extra={})=>executeTypedPayment(db,{action:'oneOffPayment',nowIso,payload:p,...extra});
test('backdated payment preserves balance history and deducts current cash exactly once',async t=>{
 const {db,raw}=fixture(t);const before=rows(raw,'balance_history'),weekly=rows(raw,'weekly_snapshots');const snapshot=await loadFinancialSnapshot(db);const cash=latestUsableBalance(snapshot.balanceHistory);const spent=computeCycleVariablesSpentToDate(snapshot,'2026-07-31','2026-08-15',cash.combinedBalance).spent;
 const changes=raw.prepare('SELECT total_changes() n').get().n;const preview=await previewTypedPayment(db,payload(),{nowIso});assert.equal(raw.prepare('SELECT total_changes() n').get().n,changes);assert.equal(preview.date,'2026-08-14');assert.equal(preview.balanceEffectDate,'2026-08-15');
 const result=await save(db);assert.equal(result.businessDate,'2026-08-14');
 assert.deepEqual(rows(raw,'balance_history').slice(0,before.length),before);assert.deepEqual(rows(raw,'weekly_snapshots'),weekly);
 const payment=rows(raw,'one_off_payments')[0],effect=rows(raw,'balance_history').at(-1);assert.equal(effect.one_off_payment_id,payment.one_off_payment_id);assert.equal(effect.business_date,'2026-08-15');assert.equal(payment.business_date,'2026-08-14');assert.equal(rows(raw,'one_off_payment_allocations').length,1);
 const after=await loadFinancialSnapshot(db),newCash=latestUsableBalance(after.balanceHistory);assert.equal(newCash.combinedBalance,cash.combinedBalance-100);assert.equal(computeCycleVariablesSpentToDate(after,'2026-07-31','2026-08-15',newCash.combinedBalance).spent,spent+100);
 assert.deepEqual(await save(db),result);assert.equal(rows(raw,'balance_history').length,before.length+1);
});
for(const extra of [{date:'2026-08-12'},{date:'2026-08-16'},{date:'2026-02-30'},{date:'invalid'},{amount:0},{amount:-1},{amount:Infinity},{amount:1.001},{amount:'oops'},{amount:true},{paidFromAccount:'Both'},{description:''},{oneOffOlgaAmount:100}])test('invalid typed payment rejects '+JSON.stringify(extra),async t=>{
 const {db,raw}=fixture(t);await assert.rejects(save(db,payload(extra)),e=>e.validation===true);assert.equal(rows(raw,'financial_write_claims').length,0);assert.equal(rows(raw,'one_off_payments').length,0);
});
test('Bangkok rollover and cycle-start clamp control allowed backdates',async t=>{
 const {db,raw}=fixture(t);raw.prepare("UPDATE salary_cycle_state SET current_cycle_start='2026-08-14'").run();
 await assert.rejects(save(db,payload({date:'2026-08-13'})),/current salary cycle/);
 const p=await previewTypedPayment(db,payload({date:'2026-08-15'}),{nowIso:'2026-08-14T17:00:00.000Z'});assert.equal(p.balanceEffectDate,'2026-08-15');assert.equal(p.earliestAllowed,'2026-08-14');
});
test('active category permits blank description but commit revalidates lifecycle',async t=>{
 const {db,raw}=fixture(t);const category=rows(raw,'one_off_categories')[0],p=payload({categoryId:category.category_id,description:''});
 assert.equal((await previewTypedPayment(db,p,{nowIso})).categoryId,category.category_id);
 await executeCategoryWrite(db,{action:'deactivateOneOffCategory',nowIso,payload:{categoryId:category.category_id,requestId:'off'}});
 await assert.rejects(save(db,p),/no longer active/);assert.equal(rows(raw,'one_off_payments').length,0);
});
test('unavailable authority rejects before any cash effect',async t=>{
 const {db,raw}=fixture(t);raw.prepare('UPDATE salary_cycle_state SET next_salary_date=NULL').run();await assert.rejects(save(db),/authority is unavailable/);
});
test('forced failure rolls back typed rows, balance link, request and claim together',async t=>{
 const {db,raw}=fixture(t),before=rows(raw,'balance_history');await assert.rejects(save(db,payload(),{testOnlyForcedFailure:true}));assert.deepEqual(rows(raw,'balance_history'),before);for(const table of ['one_off_payments','one_off_payment_allocations','new_function_request_receipts','financial_write_claims'])assert.equal(rows(raw,table).length,0);
});
test('immutable fields and portable restoration preserve typed and accounting linkage',async t=>{
 const {db,raw}=fixture(t);await save(db);assert.throws(()=>raw.prepare("UPDATE one_off_payments SET description='changed'").run(),/immutable/);assert.throws(()=>raw.prepare('UPDATE one_off_payment_allocations SET amount_satang=1').run(),/immutable/);
 const {backup}=await buildPortableBackup(db,{environment:'test',createdAt:nowIso});const restore=new DatabaseSync(':memory:');t.after(()=>restore.close());restore.exec('PRAGMA foreign_keys=ON');restore.exec(await buildRestoreSql(backup,{includeSchema:true}));for(const table of ['one_off_payments','one_off_payment_allocations','balance_history','new_function_request_receipts'])assert.deepEqual(rows(restore,table),rows(raw,table));assert.equal(restore.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('signed negative Available requires more funding than the purchase itself',async t=>{
 const {db,raw}=fixture(t);raw.prepare('UPDATE salary_cycle_state SET ef_cycle_commitment_satang=99999999').run();
 const p=await previewTypedPayment(db,payload(),{nowIso});assert.ok(p.availableToSpend<0);assert.equal(p.fundingNeeded,Math.round((100-p.availableToSpend)*100)/100);
 await assert.rejects(save(db),e=>e.requiresEFWithdrawal===true);assert.equal(rows(raw,'one_off_payments').length,0);
});
test('a single-account shortage requires an explicit KTB transfer',async t=>{
 const {db,raw}=fixture(t);raw.prepare("UPDATE balance_history SET alex_balance_satang=0 WHERE balance_row_id=(SELECT balance_row_id FROM balance_history ORDER BY business_date DESC,sheet_order DESC LIMIT 1)").run();
 await assert.rejects(save(db),e=>e.requiresKTBTransfer===true);assert.equal(rows(raw,'one_off_payments').length,0);
});
test('same-request race creates one typed payment and returns one original response',async t=>{
 const {db,raw}=fixture(t);let arrived=0,release;const gate=new Promise(resolve=>release=resolve);const pause=async()=>{if(++arrived===2)release();await gate;};
 const results=await Promise.all([save(db,payload(),{testOnlyBeforeBatch:pause}),save(db,payload(),{testOnlyBeforeBatch:pause})]);assert.deepEqual(results[0],results[1]);assert.equal(rows(raw,'one_off_payments').length,1);assert.equal(rows(raw,'one_off_payment_allocations').length,1);
});
test('changed retry payload is rejected rather than replaying another payment',async t=>{
 const {db,raw}=fixture(t);await save(db);await assert.rejects(save(db,payload({amount:200})),/different details/);assert.equal(rows(raw,'one_off_payments')[0].amount_satang,10000);
});
