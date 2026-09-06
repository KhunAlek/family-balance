import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createSeededSqliteD1,SqliteD1Adapter} from '../../slice-c/test/sqlite-d1.mjs';
import {previewSalaryReportingCorrection,executeReportingCorrection} from '../../slice-c/src/reporting-correction.mjs';
import {executeRevisionClaimWrite} from '../../slice-c/src/write-protocol.mjs';
import {planFinancialWrite} from '../../slice-c/src/write-actions.mjs';
import {planCorrection} from '../../slice-c/src/correction.mjs';
import {loadFinancialSnapshot} from '../../slice-b/src/d1-repository.mjs';
import {getOneOffReport} from '../../slice-b/src/reporting.mjs';
import {buildPortableBackup,verifyPortableBackup} from '../src/backup.mjs';
import {buildRestoreSql} from '../tools/portable-restore.mjs';
import {handleFetch} from '../src/index.js';
import {signSession} from '../src/auth.mjs';

const nowIso='2026-09-05T12:00:00.000Z';
const query=(raw,table)=>raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const preserved=['balance_history','income_receipts','obligation_payments','ledger_movements','weekly_snapshots','one_off_payments','one_off_payment_allocations'];
const factual=raw=>Object.fromEntries(preserved.map(t=>[t,query(raw,t)]));
function fixture(t,previous=true){
  const f=createSeededSqliteD1();t.after(()=>f.raw.close());
  for(const file of ['0006_new_functionality.sql','0007_reporting_cycles.sql'])f.raw.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  // These are explicitly synthetic dates and payments, never historical seeds.
  if(previous)f.raw.prepare("INSERT INTO reporting_salary_cycles VALUES('family','2026-06-30')").run();
  return f;
}
function payment(raw,id,date,amount=10000,split=false){
  raw.prepare("INSERT INTO one_off_payments(one_off_payment_id,household_id,business_date,description,amount_satang,paid_from_account,created_at,request_id,legacy_origin) VALUES(?,'family',?,'Synthetic purchase',?,?,?,?,?)").run(id,date,amount,split?null:'Alex',nowIso,id,split?'synthetic-test-split':null);
  if(split){
    raw.prepare('INSERT INTO one_off_payment_allocations VALUES(?,?,?)').run(id,'Alex',44500);
    raw.prepare('INSERT INTO one_off_payment_allocations VALUES(?,?,?)').run(id,'Olga',500000);
  }else raw.prepare('INSERT INTO one_off_payment_allocations VALUES(?,?,?)').run(id,'Alex',amount);
}
function payload(start,requestId='correction') {return {entityType:'salaryCycle',entityId:'family',correctedValues:{currentCycleStart:start,nextSalaryDate:'2026-08-31'},reason:'Synthetic boundary evidence',requestId};}
async function prepared(db,start,requestId){const p=payload(start,requestId);const preview=await previewSalaryReportingCorrection(db,p,{nowIso});return {...p,previewRevision:preview.previewRevision};}
const save=(db,p,extra={})=>executeReportingCorrection(db,{action:'correctRecord',payload:p,nowIso,actorEmail:'test@example.invalid',...extra});

test('reporting schema seeds only the recorded current start and leaves Accounting unchanged',t=>{
  const {raw}=createSeededSqliteD1();t.after(()=>raw.close());
  const names=preserved.filter(t=>!t.startsWith('one_off_'));const before=Object.fromEntries(names.map(t=>[t,query(raw,t)]));
  for(const file of ['0006_new_functionality.sql','0007_reporting_cycles.sql'])raw.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  assert.deepEqual(query(raw,'reporting_salary_cycles').map(r=>r.cycle_start),['2026-07-31']);
  assert.equal(query(raw,'one_off_payments').length,0);
  assert.deepEqual(Object.fromEntries(names.map(t=>[t,query(raw,t)])),before);
  assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('later correction previews only payments that change cycles and preserves every factual row',async t=>{
  const {db,raw}=fixture(t);payment(raw,'before','2026-07-30');payment(raw,'boundary','2026-07-31',20000);payment(raw,'after','2026-08-01',30000);
  const facts=factual(raw),changes=raw.prepare('SELECT total_changes() n').get().n;
  const p=payload('2026-08-01');const preview=await previewSalaryReportingCorrection(db,p,{nowIso});
  assert.equal(raw.prepare('SELECT total_changes() n').get().n,changes);
  assert.deepEqual(preview.reportingImpact.movedPayments.map(p=>p.paymentId),['boundary']);
  assert.deepEqual(preview.reportingImpact.beforeTotals.map(t=>t.amountSatang),[10000,50000]);
  assert.deepEqual(preview.reportingImpact.afterTotals.map(t=>t.amountSatang),[30000,30000]);
  const saved=await save(db,{...p,previewRevision:preview.previewRevision});
  assert.deepEqual(saved.reportingImpact,preview.reportingImpact);
  assert.deepEqual(factual(raw),facts);
  assert.deepEqual(query(raw,'reporting_salary_cycles').map(r=>r.cycle_start),['2026-08-01','2026-06-30']);
  const audit=query(raw,'correction_audit').at(-1);
  assert.equal(JSON.parse(audit.before_json).reportingCycleStart,'2026-07-31');
  assert.equal(JSON.parse(audit.after_json).reportingCycleStart,'2026-08-01');
  assert.deepEqual(JSON.parse(audit.after_json).reportingImpact,preview.reportingImpact);
  const report=await getOneOffReport(db,{cycleStarts:['2026-06-30','2026-08-01']},'family','2026-09-05');
  assert.deepEqual(report.totals.map(t=>t.amountSatang),[30000,30000]);
});

test('earlier correction and re-correction use the current boundary, with no payment rewriting',async t=>{
  const {db,raw}=fixture(t);payment(raw,'early','2026-07-30');payment(raw,'late','2026-08-02',20000);
  const facts=factual(raw);
  const first=await save(db,await prepared(db,'2026-07-30','first'));
  assert.equal(first.reportingImpact.movedPayments[0].paymentId,'early');
  const second=await save(db,await prepared(db,'2026-08-01','second'));
  assert.equal(second.reportingImpact.oldStart,'2026-07-30');
  assert.equal(second.reportingImpact.movedPayments[0].paymentId,'early');
  assert.deepEqual(factual(raw),facts);
  assert.equal(query(raw,'correction_audit').length,2);
});

for(const start of ['2026-06-30','2026-06-29','2026-09-06','2026-02-30','invalid']){
  test(`invalid/colliding correction ${start} makes zero writes`,async t=>{
    const {db,raw}=fixture(t);const before=raw.prepare('SELECT total_changes() n').get().n;
    await assert.rejects(previewSalaryReportingCorrection(db,payload(start),{nowIso}),e=>e.validation===true);
    assert.equal(raw.prepare('SELECT total_changes() n').get().n,before);
    assert.equal(query(raw,'financial_write_claims').length,0);
  });
}

test('correction cannot orphan a payment when earlier factual cycle evidence is absent',async t=>{
  const {db,raw}=fixture(t,false);payment(raw,'orphan','2026-07-31');
  await assert.rejects(previewSalaryReportingCorrection(db,payload('2026-08-01'),{nowIso}),/Earlier cycle evidence/);
  assert.equal(query(raw,'financial_write_claims').length,0);
});

test('split purchase is one logical report payment and retains both allocations through correction',async t=>{
  const {db,raw}=fixture(t);payment(raw,'split','2026-07-31',544500,true);
  const facts=factual(raw);const result=await save(db,await prepared(db,'2026-08-01'));
  assert.equal(result.reportingImpact.movedPayments.length,1);
  assert.equal(result.reportingImpact.afterTotals[0].amountSatang,544500);
  assert.equal(result.reportingImpact.afterTotals[0].paymentCount,1);
  assert.deepEqual(factual(raw),facts);
});

test('stale or missing preview fails before claim; direct legacy correction cannot bypass Reports',async t=>{
  const {db,raw}=fixture(t);const p=await prepared(db,'2026-08-01');
  await executeRevisionClaimWrite(db,{action:'setVariablesTarget',payload:{amount:20000},planWrite:planFinancialWrite,nowIso});
  await assert.rejects(save(db,p),e=>e.staleWriter===true);
  await assert.rejects(save(db,payload('2026-08-01','no-preview')),e=>e.staleWriter===true);
  await assert.rejects(executeRevisionClaimWrite(db,{action:'correctRecord',payload:p,planWrite:planCorrection,nowIso}),/preview first/);
  assert.equal(query(raw,'correction_audit').length,0);
  assert.equal(query(raw,'financial_write_claims').length,1);
});

test('forced batch failure rolls back reporting boundary, salary state, source membership, audit and receipt',async t=>{
  const {db,raw}=fixture(t);payment(raw,'edge','2026-07-31');
  const before=factual(raw),cycles=query(raw,'reporting_salary_cycles'),salary=query(raw,'salary_cycle_state'),sources=query(raw,'salary_cycle_sources');
  await assert.rejects(save(db,await prepared(db,'2026-08-01'),{testOnlyForcedFailure:true}),/__slice_c_forced_failure__/);
  assert.deepEqual(factual(raw),before);assert.deepEqual(query(raw,'reporting_salary_cycles'),cycles);
  assert.deepEqual(query(raw,'salary_cycle_state'),salary);assert.deepEqual(query(raw,'salary_cycle_sources'),sources);
  for(const name of ['correction_audit','financial_write_claims','new_function_request_receipts'])assert.equal(query(raw,name).length,0);
  assert.equal(query(raw,'household_revisions')[0].current_revision,0);
});

test('lost-response retry returns original result even after a later correction',async t=>{
  const {db,raw}=fixture(t);const p=await prepared(db,'2026-08-01','first');const first=await save(db,p);
  await save(db,await prepared(db,'2026-07-30','second'));
  const before=raw.prepare('SELECT total_changes() n').get().n;
  assert.deepEqual(await save(db,p),first);
  assert.equal(raw.prepare('SELECT total_changes() n').get().n,before);
  await assert.rejects(save(db,{...p,reason:'Different reason'}),/different details/);
});

test('racing corrections cannot both consume the same preview',async t=>{
  const {db,raw}=fixture(t);const p=await prepared(db,'2026-08-01','one'),q=await prepared(db,'2026-07-30','two');
  let arrivals=0,release;const gate=new Promise(r=>release=r);const testOnlyBeforeBatch=async()=>{if(++arrivals===2)release();await gate;};
  const results=await Promise.allSettled([save(db,p,{testOnlyBeforeBatch}),save(db,q,{testOnlyBeforeBatch})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.staleWriter,true);
  assert.equal(query(raw,'correction_audit').length,1);
});

test('same-request racing corrections return one committed result',async t=>{
  const {db,raw}=fixture(t);const p=await prepared(db,'2026-08-01','same');
  let arrivals=0,release;const gate=new Promise(r=>release=r);const testOnlyBeforeBatch=async()=>{if(++arrivals===2)release();await gate;};
  const results=await Promise.all([save(db,p,{testOnlyBeforeBatch}),save(db,p,{testOnlyBeforeBatch})]);
  assert.deepEqual(results[0],results[1]);assert.equal(query(raw,'correction_audit').length,1);
});

test('portable restore preserves correction audit, factual rows, cycle totals and replay identity',async t=>{
  const {db,raw}=fixture(t);payment(raw,'edge','2026-07-31',544500,true);
  const p=await prepared(db,'2026-08-01');const saved=await save(db,p);
  const report=await getOneOffReport(db,{cycleStarts:['2026-06-30','2026-08-01']},'family','2026-09-05');
  const {backup}=await buildPortableBackup(db,{environment:'isolated',createdAt:nowIso});assert.equal(await verifyPortableBackup(backup),true);
  const restored=new DatabaseSync(':memory:');t.after(()=>restored.close());restored.exec('PRAGMA foreign_keys=ON;');restored.exec(await buildRestoreSql(backup,{includeSchema:true}));
  const restoredDb=new SqliteD1Adapter(restored);
  assert.deepEqual(await getOneOffReport(restoredDb,{cycleStarts:['2026-06-30','2026-08-01']},'family','2026-09-05'),report);
  assert.deepEqual(factual(restored),factual(raw));assert.deepEqual(query(restored,'correction_audit'),query(raw,'correction_audit'));
  assert.deepEqual(await save(restoredDb,p),saved);
  assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('salary advance adds exactly one passive reporting start and retains reset/second-source behavior',async t=>{
  const {db,raw}=fixture(t);
  const write=incomeSource=>executeRevisionClaimWrite(db,{action:'incomeReceipt',payload:{date:'2026-08-31',incomeSource,incomeAlexAmount:1000,incomeOlgaAmount:0},planWrite:planFinancialWrite,nowIso});
  assert.equal((await write('Alex Salary')).salaryCycleAdvanced,true);
  assert.equal((await write('Olga Salary')).salaryCycleAdvanced,false);
  assert.deepEqual(query(raw,'reporting_salary_cycles').map(c=>c.cycle_start).sort(),['2026-06-30','2026-07-31','2026-08-31']);
  const snapshot=await loadFinancialSnapshot(db);
  assert.equal(snapshot.salaryCycle.next_salary_date,null);assert.equal(snapshot.salaryCycle.variables_target_satang,null);
  const frozen = snapshot.weeklySnapshots.filter(w=>['2026-07-31','2026-08-10','2026-08-17','2026-08-24'].includes(w.week_start));
  assert.deepEqual(frozen.map(w=>[w.week_start,w.week_end]),[['2026-07-31','2026-08-02'],['2026-08-10','2026-08-16'],['2026-08-17','2026-08-23'],['2026-08-24','2026-08-30']]);
  assert.ok(frozen.every(w=>w.planned_variables_satang===null && ['closed','no data'].includes(w.status)));
});

test('Worker preview and correction routes enforce auth, return report impact, and commit it',async t=>{
  const {db,raw}=fixture(t);payment(raw,'edge','2026-07-31');
  const origin='https://isolated.example';const env={DB:db,APPROVED_GOOGLE_EMAILS:'test@example.invalid',SESSION_SIGNING_KEY:'test-only-secret-with-more-than-thirty-two-characters'};
  const token=await signSession({sub:'test',email:'test@example.invalid'},env);
  const api=(apiAction,p,cookie=`fcf_session=${token}`)=>handleFetch(new Request(origin+'/api/action',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({apiAction,payload:p})}),env);
  assert.equal((await api('previewSalaryCycleCorrection',payload('2026-08-01'),'')).status,401);
  const preview=await (await api('previewSalaryCycleCorrection',payload('2026-08-01'))).json();assert.equal(preview.ok,true);
  const result=await (await api('write',{...payload('2026-08-01'),action:'correctRecord',previewRevision:preview.previewRevision})).json();
  assert.equal(result.ok,true);assert.equal(result.reportingImpact.movedPayments.length,1);
  assert.deepEqual(factual(raw).one_off_payments.map(p=>p.business_date),['2026-07-31']);
});
