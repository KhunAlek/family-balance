import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { executeMovementWrite, getMovementRequestStatus } from '../../slice-c/src/movement-receipts.mjs';
import { handleFetch } from '../src/index.js';
import { signSession } from '../src/auth.mjs';

const migrations=['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql','0014_one_off_management_lifecycle.sql','0015_other_income_receipt_parent.sql','0016_obligation_payment_management.sql','0017_ktb_transfer_management.sql','0018_fund_movement_management.sql','0019_salary_receipt_management.sql'];

function fixture(t, goal=false) {
  const created=createSeededSqliteD1();
  t.after(()=>created.raw.close());
  for(const name of migrations)created.raw.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  if(goal)created.raw.prepare("INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES('family','2026-08-10',999,?,'Contribution',100000,'Test',999)").run("Olga's laptop");
  return created;
}

function counts(raw) {
  const tables=['financial_write_claims','new_function_request_receipts','logical_transactions','ktb_transfers','fund_movements','balance_history','ledger_movements'];
  return { revision:raw.prepare("SELECT current_revision n FROM household_revisions WHERE household_id='family'").get().n, ...Object.fromEntries(tables.map(table=>[table,raw.prepare('SELECT count(*) n FROM '+table).get().n])) };
}

const movements=[
  ['Alex to Olga KTB',{action:'ktbTransfer',date:'2026-08-14',sourceAccount:'Alex',destinationAccount:'Olga',amount:10}],
  ['Olga to Alex KTB',{action:'ktbTransfer',date:'2026-08-14',sourceAccount:'Olga',destinationAccount:'Alex',amount:10}],
  ['EF to Alex',{action:'efWithdrawal',date:'2026-08-14',destinationAccount:'Alex',amount:10}],
  ['EF to Olga',{action:'efWithdrawal',date:'2026-08-14',destinationAccount:'Olga',amount:10}],
  ['Alex to EF',{action:'dedicatedTransfer',date:'2026-08-14',sourceAccount:'Alex',destinationType:'EF',destinationName:'EF',amount:10}],
  ['Olga to EF',{action:'dedicatedTransfer',date:'2026-08-14',sourceAccount:'Olga',destinationType:'EF',destinationName:'EF',amount:10}],
  ['Alex to Goal',{action:'dedicatedTransfer',date:'2026-08-14',sourceAccount:'Alex',destinationType:'Goal',destinationName:"Olga's laptop",amount:10}],
  ['Olga to Goal',{action:'dedicatedTransfer',date:'2026-08-14',sourceAccount:'Olga',destinationType:'Goal',destinationName:"Olga's laptop",amount:10}]
];

for(const [label,movement] of movements)test(label+' validates, writes once, and replays without another effect',async t=>{
  const {db,raw}=fixture(t,movement.destinationType==='Goal');
  const options=(requestId,extra={})=>({householdId:'family',actorEmail:'alex@example.com',action:movement.action,payload:{...movement,...(requestId===undefined?{}:{requestId})},nowIso:'2026-08-14T12:00:00.000Z',...extra});
  const before=counts(raw);
  for(const bad of [undefined,'','invalid.id','x'.repeat(129)]) {
    await assert.rejects(executeMovementWrite(db,options(bad)),/stable request ID/);
    assert.deepEqual(counts(raw),before);
  }
  const requestId='movement-'+label.replaceAll(' ','-').toLowerCase();
  const first=await executeMovementWrite(db,options(requestId));
  const written=counts(raw);
  assert.equal(first.ok,true);
  assert.equal(written.revision,before.revision+1);
  assert.equal(written.new_function_request_receipts,before.new_function_request_receipts+1);
  assert.equal(written.logical_transactions,before.logical_transactions+1);
  assert.equal(written[movement.action==='ktbTransfer'?'ktb_transfers':'fund_movements'],1);
  const status=await getMovementRequestStatus(db,{requestId,movement});
  assert.deepEqual(status,{ok:true,found:true,response:first});
  assert.deepEqual(await executeMovementWrite(db,options(requestId)),first);
  assert.deepEqual(counts(raw),written);
  await assert.rejects(executeMovementWrite(db,{...options(requestId),payload:{...movement,amount:11,requestId}}),/different details/);
  assert.deepEqual(counts(raw),written);
  await assert.rejects(getMovementRequestStatus(db,{requestId,movement:{...movement,amount:11}}),/different details/);
  assert.deepEqual(await getMovementRequestStatus(db,{requestId:'not-created',movement}),{ok:true,found:false,response:null});
  assert.deepEqual(counts(raw),written);
});

test('forced failure rolls back the receipt and financial effects, then the same ID succeeds',async t=>{
  const {db,raw}=fixture(t),movement=movements[0][1],options={householdId:'family',actorEmail:'alex@example.com',action:movement.action,payload:{...movement,requestId:'forced-failure'},nowIso:'2026-08-14T12:00:00.000Z'};
  const before=counts(raw);
  await assert.rejects(executeMovementWrite(db,{...options,testOnlyForcedFailure:true}));
  assert.deepEqual(counts(raw),before);
  assert.equal((await executeMovementWrite(db,options)).ok,true);
  assert.equal(counts(raw).new_function_request_receipts,before.new_function_request_receipts+1);
});

test('authenticated Worker dispatch validates IDs and exposes read-only receipt status',async t=>{
  const {db,raw}=fixture(t),origin='https://family.example',env={DB:db,GOOGLE_CLIENT_ID:'client',APPROVED_GOOGLE_EMAILS:'alex@example.com',SESSION_SIGNING_KEY:'movement-route-key-longer-than-thirty-two-bytes'};
  const token=await signSession({sub:'subject',email:'alex@example.com'},env,{jti:'movement-route'});
  const send=(apiAction,payload,authenticated=true)=>handleFetch(new Request(origin+'/api/action',{method:'POST',headers:{origin,'content-type':'application/json',...(authenticated?{cookie:`fcf_session=${token}`}:{})},body:JSON.stringify({apiAction,payload})}),env);
  const before=counts(raw);
  for(const [,movement] of movements){const response=await send('write',movement);assert.equal(response.status,200);assert.match((await response.json()).error,/stable request ID/);assert.deepEqual(counts(raw),before)}
  const movement={...movements[0][1],date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),requestId:'worker-route-probe'};
  const first=await send('write',movement);
  assert.equal(first.status,200);
  assert.equal((await first.json()).ok,true);
  const replay=await send('write',movement);
  assert.equal((await replay.json()).revision,before.revision+1);
  assert.equal(counts(raw).revision,before.revision+1);
  const {requestId,...semantic}=movement;
  const status=await send('movementRequestStatus',{requestId,movement:semantic});
  assert.equal((await status.json()).found,true);
  assert.equal((await send('movementRequestStatus',{requestId,movement:semantic},false)).status,401);
});
