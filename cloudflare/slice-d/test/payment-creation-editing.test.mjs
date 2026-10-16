import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createSeededSqliteD1,SqliteD1Adapter} from '../../slice-c/test/sqlite-d1.mjs';
import {executeTypedPayment} from '../../slice-c/src/typed-payment.mjs';
import {BACKUP_TABLES,buildPortableBackup} from '../src/backup.mjs';
import {buildAccountHistory} from '../src/account-history.mjs';
import {buildRestoreSql} from '../tools/portable-restore.mjs';
import {buildTerminalTransactionReadModel} from '../src/terminal-transaction-read-model.mjs';
import {previewTransactionManagement,executeTransactionManagementCommit} from '../src/transaction-management-protocol.mjs';
import {oneOffEligibility,buildOneOffPreview,buildOneOffReplacement} from '../src/one-off-payment-management.mjs';
const nowIso='2026-08-15T12:00:00.000Z';
const snap=raw=>Object.fromEntries(BACKUP_TABLES.map(name=>[name,raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
function fixture(t){const x=createSeededSqliteD1();t.after(()=>x.raw.close());for(const name of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n>='0006'&&n<'0020').sort())x.raw.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));return x;}
const payload={requestId:'editable-create',date:'2026-08-15',description:'Creation test',amount:100,paidFromAccount:'Alex'};
const save=(db,extra={})=>executeTypedPayment(db,{action:'oneOffPayment',actorEmail:'alex@example.com',nowIso,payload,...extra});
const management={actorEmail:'alex@example.com',nowIso,eligibility:oneOffEligibility,buildPreview:buildOneOffPreview,buildReplacement:buildOneOffReplacement};

test('normal creation is immediately editable; correction/delete/restore/undo preserve facts and exact replay',async t=>{
 const {db,raw}=fixture(t),created=await save(db);assert.ok(created.logicalTransactionId);
 assert.deepEqual(await save(db),created);
 const original=snap(raw),find=()=>buildTerminalTransactionReadModel(snap(raw));
 let tx=find().activeTransactions.find(x=>x.logicalTransactionId===created.logicalTransactionId);
 assert.equal(tx.permittedActions.correct,true);assert.equal(tx.creationEvidence.actorEmail,'alex@example.com');
 for(const [index,operation] of ['corrected','deleted','restored','undone'].entries()){
  const semanticPayload=operation==='corrected'?{businessDate:'2026-08-15',description:'Corrected test',categoryId:null,allocations:[{account:'Alex',amountSatang:8000}],reasonCode:'owner_correction'}:{reasonCode:operation==='deleted'?'entered_by_mistake':operation==='restored'?'restore_last_active':'undo'};
  const preview=await previewTransactionManagement(db,{logicalTransactionId:tx.logicalTransactionId,operation,semanticPayload},'family',management);assert.equal(preview.eligibility.eligible,true);
  const request={requestId:'edit-flow-'+index,logicalTransactionId:tx.logicalTransactionId,operation,semanticPayload,baseRevision:preview.baseRevision,terminalVersionId:preview.terminalVersionId};
  const result=await executeTransactionManagementCommit(db,request,management);assert.deepEqual(await executeTransactionManagementCommit(db,request,management),result);
  tx=[...find().activeTransactions,...find().deletedTransactions].find(x=>x.logicalTransactionId===created.logicalTransactionId);
 }
 assert.equal(tx.lifecycle,'deleted');
 assert.deepEqual(raw.prepare('SELECT * FROM one_off_payments WHERE one_off_payment_id=?').get(created.paymentId),original.one_off_payments.find(x=>x.one_off_payment_id===created.paymentId));
 assert.deepEqual(snap(raw).balance_history.slice(0,original.balance_history.length),original.balance_history);
 const bucket={async put(key,value){this.value=value},async list(){return {objects:[],truncated:false}},async delete(){}};
 const {runPortableBackup}=await import('../src/backup.mjs');await runPortableBackup(db,bucket,{environment:'test',createdAt:nowIso,retentionDays:1});
 const restored=new DatabaseSync(':memory:');t.after(()=>restored.close());restored.exec('PRAGMA foreign_keys=ON');restored.exec(await buildRestoreSql(JSON.parse(bucket.value),{includeSchema:true}));assert.deepEqual(buildTerminalTransactionReadModel(snap(restored)),find());assert.deepEqual(await buildAccountHistory(snap(restored)),await buildAccountHistory(snap(raw)));
});

test('creation invalidation, missing actor, retry conflict and forced failure leave no partial identities',async t=>{
 const {db,raw}=fixture(t),before=snap(raw);
 await assert.rejects(save(db,{payload:{...payload,amount:-1}}));
 await assert.rejects(save(db,{actorEmail:null}));
 await assert.rejects(save(db,{testOnlyForcedFailure:true}));
 assert.deepEqual(snap(raw),before);
 await save(db);await assert.rejects(save(db,{payload:{...payload,amount:200}}),/different details/);
 assert.equal(raw.prepare("SELECT count(*) n FROM logical_transactions WHERE creation_request_id='editable-create'").get().n,1);
});
