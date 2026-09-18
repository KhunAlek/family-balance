import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededSqliteD1 } from './sqlite-d1.mjs';
import { executeRevisionClaimWrite, FinancialWriteValidationError } from '../src/write-protocol.mjs';
import { previewCorrection, planCorrection, LEGACY_CORRECTION_ENTITY_TYPES } from '../src/correction.mjs';
import { planFinancialWrite } from '../src/write-actions.mjs';
import { buildCorrectionCatalog } from '../src/correction-catalog.mjs';
import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';

const NOW='2026-08-14T12:00:00.000Z';
const ACTOR='abystrov66@gmail.com';
const protectedTables=['financial_write_claims','correction_audit','balance_history','obligation_payments','ledger_movements','household_revisions'];

async function correct(db,payload,writeToken='correction-test',planWrite=planCorrection) {
  return executeRevisionClaimWrite(db,{
    householdId:'family',actorEmail:ACTOR,action:'correctRecord',payload,
    planWrite,nowIso:NOW,writeToken
  });
}

function state(raw){
  return Object.fromEntries(protectedTables.map(table=>[
    table,
    raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  ]));
}

const disabledCases = snapshot => [
  ['balance',String(snapshot.balanceHistory.at(-1).balance_row_id),{alexBalance:2300},/immutable.*new balance observation/i],
  ['obligationPayment',snapshot.obligationPayments[0].payment_id,{actualAmount:750},/payment and its cash effect/i],
  ['ledgerMovement',String(snapshot.ledger[0].ledger_id),{amount:109000},/fund and KTB effects/i],
  ['goal',snapshot.goals[0].name,{targetAmount:26000},/Goal configuration is unavailable/i]
];

test('legacy correction allowlist and catalog expose salary cycle only',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());
  const snapshot=await loadFinancialSnapshot(db,'family');
  assert.deepEqual([...LEGACY_CORRECTION_ENTITY_TYPES],['salaryCycle']);
  assert.deepEqual(buildCorrectionCatalog(snapshot),{
    ok:true,
    entityTypes:[{value:'salaryCycle',label:'Salary cycle'}],
    records:{salaryCycle:[{
      entityId:'family',
      label:`${snapshot.salaryCycle.current_cycle_start} → ${snapshot.salaryCycle.next_salary_date}`,
      source:'Salary cycle'
    }]}
  });
});

test('disabled correction previews fail closed and perform zero writes',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());
  const snapshot=await loadFinancialSnapshot(db,'family');
  for(const [entityType,entityId,,message] of disabledCases(snapshot)){
    const before=state(raw);
    assert.throws(
      ()=>previewCorrection(snapshot,{entityType,entityId}),
      error=>error instanceof FinancialWriteValidationError&&message.test(error.message)
    );
    assert.deepEqual(state(raw),before,`${entityType} preview must write nothing`);
  }
});

test('disabled direct commits fail before claim through both correction planners and perform zero writes',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());
  const snapshot=await loadFinancialSnapshot(db,'family');
  for(const [entityType,entityId,correctedValues,message] of disabledCases(snapshot)){
    for(const planWrite of [planCorrection,planFinancialWrite]){
      const before=state(raw);
      await assert.rejects(
        correct(db,{entityType,entityId,correctedValues,reason:'Synthetic correction evidence'},`${entityType}-${planWrite.name}`,planWrite),
        error=>error instanceof FinancialWriteValidationError&&message.test(error.message)
      );
      assert.deepEqual(state(raw),before,`${entityType} via ${planWrite.name} must write nothing`);
    }
  }
});

test('salary-cycle ordinary preview remains read-only',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());
  const snapshot=await loadFinancialSnapshot(db,'family');
  const before=state(raw);
  const preview=previewCorrection(snapshot,{entityType:'salaryCycle',entityId:'family'});
  assert.equal(preview.ok,true);
  assert.deepEqual(preview.allowedFields,['currentCycleStart','nextSalaryDate']);
  assert.deepEqual(state(raw),before);
});
