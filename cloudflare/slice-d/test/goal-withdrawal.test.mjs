import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { executeGoalWithdrawal } from '../../slice-c/src/goal-withdrawal.mjs';
import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';
import { buildDashboardReadModel } from '../../slice-b/src/read-model.mjs';
import { buildPlanningState } from '../../slice-b/src/planning.mjs';
import { buildPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

const nowIso='2026-08-14T12:00:00.000Z';
function fixture(t,{funded=true,commitment=0}={}){
  const f=createSeededSqliteD1();t.after(()=>f.raw.close());
  f.raw.exec(fs.readFileSync(new URL('../migrations/0006_new_functionality.sql',import.meta.url),'utf8'));
  f.raw.prepare("UPDATE goals SET target_amount_satang=2500000,status='active',cycle_commitment_satang=? WHERE household_id='family' AND name=?").run(commitment*100,"Olga's laptop");
  f.raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-10',100,?,'Contribution',?,'Cloudflare',100)").run("Olga's laptop",funded?2500000:2000000);
  return f;
}
const payload=(extra={})=>({action:'goalWithdrawal',requestId:'goal-withdrawal-test',date:'2026-08-14',goalName:"Olga's laptop",destinationAccount:'Alex',amount:1000,purpose:'useForGoal',...extra});
const save=(db,p,overrides={})=>executeGoalWithdrawal(db,{action:'goalWithdrawal',nowIso,payload:p,...overrides});
const rows=(raw,table)=>raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

test('Use for this goal atomically credits KTB, records withdrawal, and completes only a fully funded Goal',async t=>{
  const{db,raw}=fixture(t),before={balances:rows(raw,'balance_history'),ledger:rows(raw,'ledger_movements'),target:raw.prepare("SELECT target_amount_satang FROM goals WHERE name=?").get("Olga's laptop").target_amount_satang};
  const result=await save(db,payload());
  assert.equal(result.status,'done');assert.equal(result.purpose,'useForGoal');assert.equal(result.goalBalance,24000);
  assert.equal(raw.prepare("SELECT status FROM goals WHERE name=?").get("Olga's laptop").status,'done');
  assert.equal(raw.prepare("SELECT target_amount_satang FROM goals WHERE name=?").get("Olga's laptop").target_amount_satang,before.target);
  assert.equal(rows(raw,'ledger_movements').length,before.ledger.length+1);assert.equal(rows(raw,'balance_history').length,before.balances.length+1);
  const movement=raw.prepare("SELECT * FROM ledger_movements ORDER BY ledger_id DESC LIMIT 1").get();assert.equal(movement.direction,'Withdrawal');assert.equal(movement.amount_satang,100000);
  const balance=raw.prepare("SELECT * FROM balance_history ORDER BY balance_row_id DESC LIMIT 1").get();assert.equal(balance.alex_balance_satang,328500);assert.equal(balance.olga_balance_satang,1145500);assert.match(balance.one_off_payment_name,/Use Goal funds/);
});

test('Withdraw for another reason keeps a fully funded Goal active and does not recreate its completed cycle commitment',async t=>{
  const{db,raw}=fixture(t,{commitment:1000}),before=await loadFinancialSnapshot(db),beforePlan=buildPlanningState(before,'2026-08-14');
  assert.equal(beforePlan.commitments.goals[0].outstanding,0);
  const result=await save(db,payload({purpose:'anotherReason',destinationAccount:'Olga'}));
  assert.equal(result.status,'active');assert.equal(raw.prepare("SELECT status FROM goals WHERE name=?").get("Olga's laptop").status,'active');
  const after=await loadFinancialSnapshot(db),afterPlan=buildPlanningState(after,'2026-08-14');
  assert.equal(afterPlan.commitments.goals[0].outstanding,0);assert.equal(afterPlan.availableToSpend,beforePlan.availableToSpend+1000);
  assert.equal(raw.prepare("SELECT cycle_commitment_satang FROM goals WHERE name=?").get("Olga's laptop").cycle_commitment_satang,100000);
  assert.match(raw.prepare("SELECT one_off_payment_name FROM balance_history ORDER BY balance_row_id DESC LIMIT 1").get().one_off_payment_name,/another reason/);
});

test('partially funded Goal withdrawal stays active for either purpose',async t=>{
  const{db,raw}=fixture(t,{funded:false});
  const result=await save(db,payload({amount:500,purpose:'useForGoal'}));
  assert.equal(result.status,'active');assert.equal(raw.prepare("SELECT status FROM goals WHERE name=?").get("Olga's laptop").status,'active');
});

test('invalid amount, overdraft, missing destination, missing purpose, and invalid business date make no writes',async t=>{
  const{db,raw}=fixture(t),before={balance:rows(raw,'balance_history'),ledger:rows(raw,'ledger_movements'),goal:rows(raw,'goals'),revision:rows(raw,'household_revisions')};
  for(const [change,pattern] of [[{amount:0},/greater than zero/],[{amount:25000.01},/exceeds the Goal balance/],[{destinationAccount:''},/Choose Alex KTB or Olga KTB/],[{purpose:''},/withdrawal purpose/],[{date:'2026-08-15'},/future/]])await assert.rejects(save(db,payload({...change,requestId:'invalid-'+Object.keys(change)[0]})),pattern);
  assert.deepEqual(rows(raw,'balance_history'),before.balance);assert.deepEqual(rows(raw,'ledger_movements'),before.ledger);assert.deepEqual(rows(raw,'goals'),before.goal);assert.deepEqual(rows(raw,'household_revisions'),before.revision);
});

test('stable retry replays once; changed retry details are rejected',async t=>{
  const{db,raw}=fixture(t),p=payload({requestId:'stable-retry'}),first=await save(db,p),balanceCount=rows(raw,'balance_history').length,ledgerCount=rows(raw,'ledger_movements').length;
  assert.deepEqual(await save(db,p),first);assert.equal(rows(raw,'balance_history').length,balanceCount);assert.equal(rows(raw,'ledger_movements').length,ledgerCount);
  await assert.rejects(save(db,{...p,amount:900}),/different details/);
});

test('stale concurrent writer loses and forced failure rolls back every factual effect',async t=>{
  const{db,raw}=fixture(t),before={balance:rows(raw,'balance_history').length,ledger:rows(raw,'ledger_movements').length};let arrivals=0,release;const gate=new Promise(resolve=>release=resolve);const pause=async()=>{arrivals+=1;if(arrivals===2)release();await gate};
  const results=await Promise.allSettled([save(db,payload({requestId:'race-a',amount:100}),{testOnlyBeforeBatch:pause}),save(db,payload({requestId:'race-b',amount:200}),{testOnlyBeforeBatch:pause})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason?.staleWriter).length,1);assert.equal(rows(raw,'balance_history').length,before.balance+1);assert.equal(rows(raw,'ledger_movements').length,before.ledger+1);
  const state={balance:rows(raw,'balance_history'),ledger:rows(raw,'ledger_movements'),goals:rows(raw,'goals'),receipts:rows(raw,'new_function_request_receipts')};
  await assert.rejects(save(db,payload({requestId:'rollback',amount:50}),{testOnlyForcedFailure:true}),/__slice_c_forced_failure__/);
  assert.deepEqual(rows(raw,'balance_history'),state.balance);assert.deepEqual(rows(raw,'ledger_movements'),state.ledger);assert.deepEqual(rows(raw,'goals'),state.goals);assert.deepEqual(rows(raw,'new_function_request_receipts'),state.receipts);
});

test('dashboard refresh moves completed Goal out of active state and portable restore preserves every fact and retry receipt',async t=>{
  const{db,raw}=fixture(t),result=await save(db,payload({requestId:'restore'})),model=buildDashboardReadModel(await loadFinancialSnapshot(db));
  assert.equal(model.goals.some(g=>g.name==="Olga's laptop"),false);assert.equal(model.completedGoals.find(g=>g.name==="Olga's laptop").status,'done');
  const{backup}=await buildPortableBackup(db,{environment:'test',createdAt:nowIso}),restored=new DatabaseSync(':memory:');t.after(()=>restored.close());restored.exec('PRAGMA foreign_keys=ON');restored.exec(await buildRestoreSql(backup,{includeSchema:true}));
  for(const table of ['goals','ledger_movements','balance_history','new_function_request_receipts'])assert.deepEqual(rows(restored,table),rows(raw,table));
  assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(JSON.parse(restored.prepare("SELECT response_json FROM new_function_request_receipts WHERE request_id='restore'").get().response_json).writeToken,result.writeToken);
});

test('Savings UI exposes active and completed lists plus preview-confirm workflow',()=>{
  const root=new URL('../../../',import.meta.url),html=fs.readFileSync(new URL('index.html',root),'utf8'),render=fs.readFileSync(new URL('assets/v24/v24_1_app1.js',root),'utf8'),ui=fs.readFileSync(new URL('assets/v24/v24_1_goal_withdrawal.js',root),'utf8'),handler=fs.readFileSync(new URL('cloudflare/slice-d/src/index.js',root),'utf8');
  for(const marker of ['Factual Goal balance available','Use for this goal','Withdraw for another reason','goalWithdrawalPreview','completedGoalsList'])assert.match(html,new RegExp(marker));
  assert.match(render,/Withdraw from goal/);assert.match(render,/data\.completedGoals/);assert.match(ui,/requestId:goalWithdrawalRequestId/);assert.match(ui,/Preview does not move money/);assert.match(ui,/await refreshLiveData\(\)/);assert.match(handler,/action === 'goalWithdrawal' \? executeGoalWithdrawal/);
});
