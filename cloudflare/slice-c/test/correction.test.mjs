import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededSqliteD1 } from './sqlite-d1.mjs';
import { executeRevisionClaimWrite, FinancialWriteValidationError } from '../src/write-protocol.mjs';
import { previewCorrection, planCorrection } from '../src/correction.mjs';
import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';

const NOW='2026-08-14T12:00:00.000Z';
const ACTOR='abystrov66@gmail.com';

async function correct(db,payload,writeToken='correction-test') {
  return executeRevisionClaimWrite(db,{
    householdId:'family',actorEmail:ACTOR,action:'correctRecord',payload,
    planWrite:planCorrection,nowIso:NOW,writeToken
  });
}

test('correction preview shows current record and performs zero writes', async()=>{
  const {db,raw}=createSeededSqliteD1();
  const snapshot=await loadFinancialSnapshot(db,'family');
  const latest=snapshot.balanceHistory.at(-1);
  const beforeClaims=raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n;
  const preview=previewCorrection(snapshot,{entityType:'balance',entityId:String(latest.balance_row_id)});
  assert.equal(preview.ok,true);
  assert.equal(preview.current.balance_row_id,latest.balance_row_id);
  assert.deepEqual(preview.allowedFields,['businessDate','alexBalance','olgaBalance']);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n,beforeClaims);
});

test('balance correction preserves original row and adds higher-precedence replacement with audit', async()=>{
  const {db,raw}=createSeededSqliteD1();
  const snapshot=await loadFinancialSnapshot(db,'family');
  const original=snapshot.balanceHistory.at(-1);
  const result=await correct(db,{
    entityType:'balance',entityId:String(original.balance_row_id),correctedValues:{alexBalance:2300},reason:'Corrected bank reconciliation'
  },'balance-correction');
  assert.equal(result.ok,true);
  assert.equal(result.revision,1);
  const stillOriginal=raw.prepare('SELECT alex_balance_satang,source_sheet FROM balance_history WHERE balance_row_id=?').get(original.balance_row_id);
  assert.equal(stillOriginal.alex_balance_satang,original.alex_balance_satang);
  const replacement=raw.prepare("SELECT business_date,alex_balance_satang,olga_balance_satang,source_sheet FROM balance_history WHERE source_sheet='Correction' ORDER BY sheet_order DESC LIMIT 1").get();
  assert.equal(replacement.business_date,original.business_date);
  assert.equal(replacement.alex_balance_satang,230000);
  assert.equal(replacement.olga_balance_satang,original.olga_balance_satang);
  const audit=raw.prepare('SELECT entity_type,entity_id,reason,actor_email,before_json,after_json,base_revision,write_token FROM correction_audit').get();
  assert.equal(audit.entity_type,'balance_history');
  assert.equal(audit.entity_id,String(original.balance_row_id));
  assert.equal(audit.reason,'Corrected bank reconciliation');
  assert.equal(audit.actor_email,ACTOR);
  assert.equal(audit.base_revision,0);
  assert.equal(audit.write_token,'balance-correction');
  assert.equal(JSON.parse(audit.before_json).balance_row_id,original.balance_row_id);
  assert.equal(JSON.parse(audit.after_json).alex_balance_satang,230000);
});

test('ledger correction uses reversal plus replacement instead of deleting history', async()=>{
  const {db,raw}=createSeededSqliteD1();
  const snapshot=await loadFinancialSnapshot(db,'family');
  const original=snapshot.ledger[0];
  const originalCount=raw.prepare('SELECT COUNT(*) AS n FROM ledger_movements').get().n;
  await correct(db,{
    entityType:'ledgerMovement',entityId:String(original.ledger_id),correctedValues:{amount:109000},reason:'Correct historical EF opening amount'
  },'ledger-correction');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM ledger_movements').get().n,originalCount+2);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM ledger_movements WHERE ledger_id=?').get(original.ledger_id).n,1);
  const added=raw.prepare("SELECT direction,amount_satang,source_sheet FROM ledger_movements WHERE source_sheet='Correction' ORDER BY sheet_order").all();
  assert.equal(added.length,2);
  assert.equal(added[0].direction,'Withdrawal');
  assert.equal(added[0].amount_satang,original.amount_satang);
  assert.equal(added[1].direction,'Contribution');
  assert.equal(added[1].amount_satang,10900000);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM correction_audit').get().n,1);
});

test('obligation payment correction updates the factual payment but remains auditable', async()=>{
  const {db,raw}=createSeededSqliteD1();
  const snapshot=await loadFinancialSnapshot(db,'family');
  const payment=snapshot.obligationPayments.find(p=>p.obligation_name==='Claude');
  await correct(db,{
    entityType:'obligationPayment',entityId:payment.payment_id,correctedValues:{actualAmount:750,note:'corrected to bank statement'},reason:'Bank statement correction'
  },'payment-correction');
  const corrected=raw.prepare('SELECT actual_amount_satang,note FROM obligation_payments WHERE payment_id=?').get(payment.payment_id);
  assert.equal(corrected.actual_amount_satang,75000);
  assert.equal(corrected.note,'corrected to bank statement');
  const audit=raw.prepare('SELECT before_json,after_json,reason FROM correction_audit').get();
  assert.equal(JSON.parse(audit.before_json).actual_amount_satang,payment.actual_amount_satang);
  assert.equal(JSON.parse(audit.after_json).actual_amount_satang,75000);
  assert.equal(audit.reason,'Bank statement correction');
});

test('correction without reason is rejected before the revision claim', async()=>{
  const {db,raw}=createSeededSqliteD1();
  const snapshot=await loadFinancialSnapshot(db,'family');
  const goal=snapshot.goals[0];
  await assert.rejects(
    correct(db,{entityType:'goal',entityId:goal.name,correctedValues:{targetAmount:26000},reason:''},'missing-reason'),
    error=>error instanceof FinancialWriteValidationError&&/reason is required/i.test(error.message)
  );
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n,0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM correction_audit').get().n,0);
  assert.equal(raw.prepare('SELECT current_revision AS n FROM household_revisions').get().n,0);
});
