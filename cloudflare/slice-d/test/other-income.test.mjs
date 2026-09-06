import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createSeededSqliteD1} from '../../slice-c/test/sqlite-d1.mjs';
import {executeOtherIncomeWrite,previewOtherIncome,getOtherIncomeSources,executeIncomeReceipt} from '../../slice-c/src/other-income.mjs';
import {buildPortableBackup,verifyPortableBackup} from '../src/backup.mjs';
import {buildRestoreSql} from '../tools/portable-restore.mjs';
const nowIso='2026-09-06T12:00:00.000Z';
const rows=(raw,t)=>raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
function fixture(t){const f=createSeededSqliteD1();t.after(()=>f.raw.close());for(const n of ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql'])f.raw.exec(fs.readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));return f;}
const write=(db,action,payload,extra={})=>executeOtherIncomeWrite(db,{action,payload,nowIso,...extra});
const add=(db,name='Tutoring',requestId='add')=>write(db,'addOtherIncomeSource',{name,requestId});
const stable=['salary_cycle_state','salary_cycle_sources','weekly_snapshots','goals','ledger_movements','obligation_payments'];
const preserved=raw=>Object.fromEntries(stable.map(t=>[t,rows(raw,t)]));
test('migration preserves existing definitions and every receipt fact',t=>{
 const {raw}=createSeededSqliteD1();t.after(()=>raw.close());const definitions=rows(raw,'income_definitions'),receipts=rows(raw,'income_receipts'),facts=preserved(raw);
 for(const n of ['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql'])raw.exec(fs.readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 assert.deepEqual(rows(raw,'income_definitions'),definitions);
 assert.deepEqual(rows(raw,'income_receipts').map(({other_income_source_id,...r})=>r),receipts.map(r=>({...r})));
 assert.ok(rows(raw,'income_receipts').every(r=>r.other_income_source_id===null));
 assert.deepEqual(preserved(raw),facts);assert.equal(rows(raw,'other_income_sources').length,2);
 assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('preview is read only; creation stores name only and retries return original response',async t=>{
 const {db,raw}=fixture(t);const count=raw.prepare('SELECT total_changes() n').get().n;
 const p=await previewOtherIncome(db,'addOtherIncomeSource',{name:'  Tutoring   classes '},{nowIso});
 assert.equal(p.source.name,'Tutoring classes');assert.equal(raw.prepare('SELECT total_changes() n').get().n,count);
 const saved=await add(db,'  Tutoring   classes ');assert.deepEqual(await add(db,'Tutoring classes'),saved);
 assert.equal(rows(raw,'other_income_sources').length,3);assert.equal(rows(raw,'new_function_request_receipts').length,1);
 assert.equal(rows(raw,'income_receipts').some(r=>r.source==='Tutoring classes'),false);
 await assert.rejects(add(db,'Another name'),/request/i);
});
test('normalized names remain reserved while inactive; lifecycle is date ordered',async t=>{
 const {db}=fixture(t);const sourceId=(await add(db)).source.other_income_source_id;
 await write(db,'deactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-09-07',requestId:'off'});
 assert.equal((await getOtherIncomeSources(db,{date:'2026-09-06'})).sources.find(s=>s.other_income_source_id===sourceId).active,1);
 assert.equal((await getOtherIncomeSources(db,{date:'2026-09-07'})).sources.find(s=>s.other_income_source_id===sourceId).active,0);
 await assert.rejects(add(db,' TUTORING ','duplicate'),/already exists/);
 await write(db,'reactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-09-07',requestId:'on'});
 assert.equal((await getOtherIncomeSources(db,{date:'2026-09-07'})).sources.find(s=>s.other_income_source_id===sourceId).active,1);
});
test('past reactivation allows the dated receipt without salary transition or planning mutation',async t=>{
 const {db,raw}=fixture(t);const sourceId=(await add(db)).source.other_income_source_id;
 await write(db,'reactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-08-01',requestId:'past'});
 const before=preserved(raw);const result=await executeIncomeReceipt(db,{action:'incomeReceipt',nowIso,payload:{otherIncomeSourceId:sourceId,incomeAlexAmount:125,incomeOlgaAmount:75,date:'2026-09-06'}});
 assert.equal(result.salaryCycleAdvanced,false);assert.equal(result.variablesTargetRequired,false);assert.deepEqual(preserved(raw),before);
 const actual=rows(raw,'income_receipts').filter(r=>r.other_income_source_id===sourceId);assert.equal(actual.length,2);assert.equal(actual.reduce((n,r)=>n+r.amount_satang,0),20000);
 assert.ok(actual.every(r=>r.source==='Tutoring'));
 const versions=rows(raw,'other_income_source_versions');
 await assert.rejects(write(db,'deactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-09-06',requestId:'contradiction'}),/factual receipt/);
 assert.deepEqual(rows(raw,'other_income_source_versions'),versions);
});
test('legacy receipts also prevent contradictory deactivation without being backfilled',async t=>{
 const {db,raw}=fixture(t);const source=rows(raw,'other_income_sources').find(s=>raw.prepare('SELECT 1 FROM income_receipts WHERE source=?').get(s.name));
 assert.ok(source,'fixture must exercise a factual variable receipt');
 const date=raw.prepare('SELECT MAX(business_date) d FROM income_receipts WHERE source=?').get(source.name).d;
 await assert.rejects(write(db,'deactivateOtherIncomeSource',{sourceId:source.other_income_source_id,effectiveDate:date,requestId:'legacy'}),/factual receipt/);
});
test('inactive, missing and mismatched sources reject with no financial writes',async t=>{
 const {db,raw}=fixture(t);const sourceId=(await add(db)).source.other_income_source_id;
 await write(db,'deactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-09-06',requestId:'off'});
 const before=rows(raw,'balance_history'),claims=rows(raw,'financial_write_claims');
 for(const p of [{otherIncomeSourceId:sourceId},{otherIncomeSourceId:'missing'},{otherIncomeSourceId:sourceId,incomeSource:'Salary'}])await assert.rejects(executeIncomeReceipt(db,{action:'incomeReceipt',nowIso,payload:{...p,incomeAlexAmount:100,date:'2026-09-06'}}),e=>e.validation===true);
 assert.deepEqual(rows(raw,'balance_history'),before);assert.deepEqual(rows(raw,'financial_write_claims'),claims);
});
test('failed atomic creation leaves neither identity nor request receipt',async t=>{
 const {db,raw}=fixture(t);await assert.rejects(write(db,'addOtherIncomeSource',{name:'Rollback',requestId:'rollback'},{testOnlyForcedFailure:true}));
 assert.equal(rows(raw,'other_income_sources').length,2);assert.equal(rows(raw,'new_function_request_receipts').length,0);assert.equal(rows(raw,'financial_write_claims').length,0);
});
test('failed income receipt rolls back balance and source link together',async t=>{
 const {db,raw}=fixture(t);const sourceId=(await add(db)).source.other_income_source_id;const before=rows(raw,'balance_history'),receipts=rows(raw,'income_receipts');
 await assert.rejects(executeIncomeReceipt(db,{action:'incomeReceipt',nowIso,testOnlyForcedFailure:true,payload:{otherIncomeSourceId:sourceId,incomeAlexAmount:100,date:'2026-09-06'}}));
 assert.deepEqual(rows(raw,'balance_history'),before);assert.deepEqual(rows(raw,'income_receipts'),receipts);
});
test('portable recovery preserves lifecycle, receipt identities and retry evidence',async t=>{
 const {db,raw}=fixture(t);const sourceId=(await add(db)).source.other_income_source_id;
 await executeIncomeReceipt(db,{action:'incomeReceipt',nowIso,payload:{otherIncomeSourceId:sourceId,incomeAlexAmount:100,date:'2026-09-06'}});
 const {backup}=await buildPortableBackup(db,{environment:'test',createdAt:nowIso});assert.equal(await verifyPortableBackup(backup),true);
 const restored=new DatabaseSync(':memory:');t.after(()=>restored.close());restored.exec('PRAGMA foreign_keys=ON');restored.exec(await buildRestoreSql(backup,{includeSchema:true}));
 for(const table of ['other_income_sources','other_income_source_versions','income_receipts','new_function_request_receipts'])assert.deepEqual(rows(restored,table),rows(raw,table));
 assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('receipt racing deactivation cannot commit against stale lifecycle',async t=>{
 const {db,raw}=fixture(t);const sourceId=(await add(db)).source.other_income_source_id;
 let arrived=0,release;const gate=new Promise(resolve=>release=resolve);const pause=async()=>{if(++arrived===2)release();await gate;};
 const results=await Promise.allSettled([
  write(db,'deactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-09-06',requestId:'race-off'},{testOnlyBeforeBatch:pause}),
  executeIncomeReceipt(db,{action:'incomeReceipt',nowIso,testOnlyBeforeBatch:pause,payload:{otherIncomeSourceId:sourceId,incomeAlexAmount:100,date:'2026-09-06'}})
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.staleWriter,true);
 const active=(await getOtherIncomeSources(db,{date:'2026-09-06'})).sources.find(s=>s.other_income_source_id===sourceId).active;
 assert.equal(rows(raw,'income_receipts').filter(r=>r.other_income_source_id===sourceId).length,active?1:0);
});
test('migrated schema retains qualifying salary reset while same-named explicit other income cannot reset it',async t=>{
 const {db,raw}=fixture(t);const salary=rows(raw,'income_definitions').find(s=>s.pay_day!=='Variable').source;
 const sourceId=(await add(db,salary)).source.other_income_source_id;
 const before=preserved(raw);
 await executeIncomeReceipt(db,{action:'incomeReceipt',nowIso,payload:{otherIncomeSourceId:sourceId,incomeSource:salary,incomeAlexAmount:100,date:'2026-09-06'}});
 assert.deepEqual(preserved(raw),before);
 const result=await executeIncomeReceipt(db,{action:'incomeReceipt',nowIso,payload:{incomeSource:salary,incomeAlexAmount:100,date:'2026-09-06'}});
 assert.equal(result.salaryCycleAdvanced,true);assert.equal(result.variablesTargetRequired,true);
 const state=rows(raw,'salary_cycle_state')[0];assert.equal(state.current_cycle_start,'2026-09-06');assert.equal(state.next_salary_date,null);assert.equal(state.variables_target_satang,null);
 assert.ok(rows(raw,'weekly_snapshots').length>before.weekly_snapshots.length);
});

test('lost-response other-income retry returns the original receipt without crediting cash twice',async t=>{
 const {db,raw}=fixture(t);const sourceId=(await add(db)).source.other_income_source_id;
 const options={action:'incomeReceipt',nowIso,payload:{otherIncomeSourceId:sourceId,requestId:'receipt-retry',incomeAlexAmount:100,date:'2026-09-06'}};
 const first=await executeIncomeReceipt(db,options),before=rows(raw,'balance_history');
 await write(db,'deactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-09-07',requestId:'later-off'});
 assert.deepEqual(await executeIncomeReceipt(db,options),first);assert.deepEqual(rows(raw,'balance_history'),before);
 await assert.rejects(executeIncomeReceipt(db,{...options,payload:{...options.payload,incomeAlexAmount:200}}),/different details/);
});

test('same-named other-income source does not adopt historical salary receipts',async t=>{
 const {db,raw}=fixture(t);const salary=rows(raw,'income_definitions').find(s=>s.pay_day!=='Variable').source;
 const sourceId=(await add(db,salary)).source.other_income_source_id;
 await write(db,'deactivateOtherIncomeSource',{sourceId,effectiveDate:'2026-01-01',requestId:'salary-name-off'});
 assert.equal((await getOtherIncomeSources(db,{date:'2026-09-06'})).sources.find(s=>s.other_income_source_id===sourceId).active,1,'later creation version takes precedence');
});
