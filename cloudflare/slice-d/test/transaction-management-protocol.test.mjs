import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1, SqliteD1Adapter } from '../../slice-c/test/sqlite-d1.mjs';
import { statement, StaleFinancialWriterError } from '../../slice-c/src/write-protocol.mjs';
import { previewTransactionManagement, executeTransactionManagementCommit, TransactionManagementProtocolError, MANAGEMENT_DISABLED_CODE } from '../src/transaction-management-protocol.mjs';
import { runPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';
import { signSession } from '../src/auth.mjs';
import { handleFetch } from '../src/index.js';

const migrations=['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql'];
function fixture(t) {
  const value=createSeededSqliteD1(); t.after(()=>value.raw.close());
  for(const name of migrations)value.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  value.raw.exec(`BEGIN;
    INSERT INTO one_off_payments VALUES('managed-payment-v1','family','2026-09-10',NULL,'Original',10000,'Alex','2026-09-11T00:00:00.000Z','create-managed',NULL);
    INSERT INTO one_off_payment_allocations VALUES('managed-payment-v1','Alex',10000);
    INSERT INTO logical_transactions(logical_transaction_id,household_id,lifecycle_status,created_actor_email,created_at_utc,creation_request_id,creation_write_token,creation_committed_revision) VALUES('managed-tx','family','active','alex@example.com','2026-09-11T00:00:00.000Z','create-managed','create-write',1);
    INSERT INTO logical_transaction_versions VALUES('managed-v1','managed-tx',1,'one_off_payment','2026-09-10',1,'created',NULL);
    INSERT INTO logical_transaction_components VALUES('managed-v1','one_off_payment','managed-payment-v1','primary');
    INSERT INTO logical_transaction_components VALUES('managed-v1','one_off_payment_allocation','managed-payment-v1:Alex','allocation');
    UPDATE logical_transactions SET terminal_version_id='managed-v1' WHERE logical_transaction_id='managed-tx';
    UPDATE household_revisions SET current_revision=1,last_write_token='create-write',updated_at='2026-09-11T00:00:00.000Z' WHERE household_id='family';
    COMMIT;`);
  return value;
}
function state(raw){return Object.fromEntries(['financial_write_claims','household_revisions','one_off_payments','one_off_payment_allocations','logical_transactions','logical_transaction_versions','logical_transaction_components','transaction_management_audit','new_function_request_receipts'].map(table=>[table,raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
function payload(requestId='manage-1'){return{requestId,logicalTransactionId:'managed-tx',operation:'corrected',baseRevision:1,terminalVersionId:'managed-v1',semanticPayload:{reasonCode:'owner_correction',description:'Corrected',amountSatang:12000,account:'Olga',businessDate:'2026-09-09'}};}
function internalOptions(extra={}) { return {householdId:'family',actorEmail:'olga@example.com',nowIso:'2026-09-11T12:00:00.000Z',writeToken:'management-write-1',testOnlyEligibility:()=>({eligible:true}),testOnlyBuildReplacement:({payload:value})=>{
  const id=`payment:${value.requestId}`;
  return {kind:'one_off_payment',businessDate:value.semanticPayload.businessDate,impactSummary:{amountDeltaSatang:2000},factStatements:[
    statement('INSERT INTO one_off_payments VALUES(?,?,?,?,?,?,?,?,?,?)',id,'family',value.semanticPayload.businessDate,null,value.semanticPayload.description,value.semanticPayload.amountSatang,value.semanticPayload.account,'2026-09-11T12:00:00.000Z',value.requestId,null),
    statement('INSERT INTO one_off_payment_allocations VALUES(?,?,?)',id,value.semanticPayload.account,value.semanticPayload.amountSatang),
  ],components:[{kind:'one_off_payment',id,role:'primary'},{kind:'one_off_payment_allocation',id:`${id}:${value.semanticPayload.account}`,role:'allocation'}]};
},...extra}; }
function barrier(){let count=0,release;const gate=new Promise(resolve=>{release=resolve;});return async()=>{if(++count===2)release();await gate;};}

test('authoritative preview is deterministic with supplied correlation ID and writes nothing on success or failure',async t=>{
  const {db,raw}=fixture(t),before=state(raw);
  const preview=await previewTransactionManagement(db,{logicalTransactionId:'managed-tx',operation:'corrected',correlationId:'preview-1'});
  assert.equal(preview.baseRevision,1); assert.equal(preview.terminalVersionId,'managed-v1'); assert.equal(preview.eligibility.eligible,false); assert.deepEqual(preview.eligibility.refusalCodes,[MANAGEMENT_DISABLED_CODE]);
  assert.deepEqual(state(raw),before);
  await assert.rejects(previewTransactionManagement(db,{logicalTransactionId:'missing',operation:'corrected',correlationId:'preview-2'}),error=>error.code==='TRANSACTION_NOT_FOUND');
  assert.deepEqual(state(raw),before);
});

test('public commit gate rejects every kind before any claim or receipt',async t=>{
  const {db,raw}=fixture(t),before=state(raw);
  await assert.rejects(executeTransactionManagementCommit(db,payload(),{householdId:'family',actorEmail:'alex@example.com'}),error=>error.code===MANAGEMENT_DISABLED_CODE);
  assert.deepEqual(state(raw),before);
  for(const kind of ['one_off_payment','other_income_receipt','salary_receipt','obligation_payment','ktb_transfer','ef_movement','goal_movement']) assert.equal(MANAGEMENT_DISABLED_CODE,'MANAGEMENT_NOT_ENABLED_STEP_7',kind);
});

test('stale revision and terminal version fail before financial writes',async t=>{
  const {db,raw}=fixture(t),before=state(raw);
  await assert.rejects(executeTransactionManagementCommit(db,{...payload(),baseRevision:0},internalOptions()),error=>error.code==='STALE_MANAGEMENT_REVISION');
  await assert.rejects(executeTransactionManagementCommit(db,{...payload(),terminalVersionId:'old-v0'},internalOptions()),error=>error.code==='STALE_TERMINAL_VERSION');
  assert.deepEqual(state(raw),before);
});

test('synthetic internal assembly commits atomically, replays exactly, and rejects changed semantics',async t=>{
  const {db,raw}=fixture(t),request=payload();
  const first=await executeTransactionManagementCommit(db,request,internalOptions());
  const afterFirst=state(raw),second=await executeTransactionManagementCommit(db,request,internalOptions({writeToken:'different-unused-token'}));
  assert.deepEqual(second,first); assert.deepEqual(state(raw),afterFirst); assert.equal(first.revision,2);
  assert.equal(raw.prepare("SELECT terminal_version_id id FROM logical_transactions WHERE logical_transaction_id='managed-tx'").get().id,first.terminalVersionId);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM transaction_management_audit').get().n,1);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM new_function_request_receipts').get().n,1);
  await assert.rejects(executeTransactionManagementCommit(db,{...request,semanticPayload:{...request.semanticPayload,amountSatang:13000}},internalOptions()),error=>error.code==='REQUEST_ID_CONFLICT');
  assert.deepEqual(state(raw),afterFirst);
});

test('expired family eligibility fails before any claim or financial write',async t=>{
  const {db,raw}=fixture(t),before=state(raw);
  await assert.rejects(executeTransactionManagementCommit(db,payload(),internalOptions({testOnlyEligibility:()=>({eligible:false,refusalCodes:['ELIGIBILITY_EXPIRED']})})),error=>error.code==='ELIGIBILITY_EXPIRED');
  assert.deepEqual(state(raw),before);
});

test('two distinct writers from one revision cannot both commit',async t=>{
  const {db,raw}=fixture(t),gate=barrier();
  const results=await Promise.allSettled([
    executeTransactionManagementCommit(db,payload('race-a'),internalOptions({writeToken:'race-write-a',testOnlyBeforeBatch:gate})),
    executeTransactionManagementCommit(db,payload('race-b'),internalOptions({writeToken:'race-write-b',testOnlyBeforeBatch:gate})),
  ]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(results.filter(item=>item.status==='rejected'&&item.reason instanceof StaleFinancialWriterError).length,1);
  assert.equal(raw.prepare('SELECT current_revision n FROM household_revisions').get().n,2);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM transaction_management_audit').get().n,1);
});

test('forced failure rolls back claim, facts, version, components, audit, receipt, pointer, and revision',async t=>{
  const {db,raw}=fixture(t),before=state(raw);
  await assert.rejects(executeTransactionManagementCommit(db,payload(),internalOptions({testOnlyForcedFailure:true})),/__slice_c_forced_failure__|no such table/i);
  assert.deepEqual(state(raw),before);
});

test('portable restore reconstructs identical protocol preview and receipt replay',async t=>{
  const {db,raw}=fixture(t),request=payload(),committed=await executeTransactionManagementCommit(db,request,internalOptions());
  const bucket={value:null,async put(key,value){this.value=value;},async list(){return{objects:[],truncated:false};},async delete(){}};
  await runPortableBackup(db,bucket,{environment:'test',createdAt:'2026-09-11T13:00:00.000Z',retentionDays:1});
  const backup=JSON.parse(bucket.value),restored=new DatabaseSync(':memory:'); restored.exec('PRAGMA foreign_keys=ON;'); restored.exec(await buildRestoreSql(backup,{includeSchema:true})); t.after(()=>restored.close());
  const restoredDb=new SqliteD1Adapter(restored);
  assert.deepEqual(await executeTransactionManagementCommit(restoredDb,request,internalOptions()),committed);
  const originalPreview=await previewTransactionManagement(db,{logicalTransactionId:'managed-tx',operation:'corrected',correlationId:'restore-check'});
  const restoredPreview=await previewTransactionManagement(restoredDb,{logicalTransactionId:'managed-tx',operation:'corrected',correlationId:'restore-check'});
  assert.deepEqual(restoredPreview,originalPreview);
});

test('Worker routes preview through auth/origin and rejects direct or old-client commits with zero writes',async t=>{
  const {db,raw}=fixture(t),before=state(raw),origin='https://family.example';
  const env={DB:db,GOOGLE_CLIENT_ID:'client',APPROVED_GOOGLE_EMAILS:'alex@example.com',SESSION_SIGNING_KEY:'management-protocol-test-key-long-enough'};
  const token=await signSession({sub:'subject',email:'alex@example.com'},env,{jti:'management-route'});
  const request=(body,auth=true,requestOrigin=origin)=>new Request(`${origin}/api/action`,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json',...(auth?{cookie:`fcf_session=${token}`}:{})},body:JSON.stringify(body)});
  const preview=await handleFetch(request({apiAction:'transactionManagementPreview',payload:{logicalTransactionId:'managed-tx',operation:'corrected',correlationId:'route-preview'}}),env);
  assert.equal(preview.status,200); assert.equal((await preview.json()).eligibility.eligible,false);
  const commit=await handleFetch(request({apiAction:'transactionManagementCommit',payload:payload()}),env);
  assert.equal(commit.status,409); assert.equal((await commit.json()).code,MANAGEMENT_DISABLED_CODE);
  const oldClient=await handleFetch(request({apiAction:'write',payload:{action:'correctRecord',entityType:'balance',entityId:'1',correctedValues:{}}}),env);
  assert.equal(oldClient.status,200); assert.equal((await oldClient.json()).ok,false);
  assert.equal((await handleFetch(request({apiAction:'transactionManagementPreview'},false),env)).status,401);
  assert.equal((await handleFetch(request({apiAction:'transactionManagementPreview'},true,'https://evil.example'),env)).status,403);
  assert.deepEqual(state(raw),before);
});
