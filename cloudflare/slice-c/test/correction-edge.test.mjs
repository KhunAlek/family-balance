import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededSqliteD1 } from './sqlite-d1.mjs';
import { executeRevisionClaimWrite } from '../src/write-protocol.mjs';
import { planCorrection } from '../src/correction.mjs';

async function correct(db,payload,writeToken){
  return executeRevisionClaimWrite(db,{
    householdId:'family',actorEmail:'abystrov66@gmail.com',action:'correctRecord',payload,
    planWrite:planCorrection,nowIso:'2026-08-14T12:00:00.000Z',writeToken
  });
}

test('historical partial balance correction is refused without changing the partial observation',async()=>{
  const {db,raw}=createSeededSqliteD1();
  raw.prepare(`INSERT INTO balance_history(
    household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,source_sheet,source_row
  ) VALUES('family','2026-07-15',999999,NULL,1234500,'Synthetic Test',1)`).run();
  const partial=raw.prepare("SELECT balance_row_id,business_date,alex_balance_satang,olga_balance_satang FROM balance_history WHERE source_sheet='Synthetic Test'").get();
  assert.ok(partial);
  const before=raw.prepare('SELECT total_changes() n').get().n;
  await assert.rejects(correct(db,{entityType:'balance',entityId:String(partial.balance_row_id),correctedValues:{olgaBalance:12345},reason:'Preserve partial-row semantics'},'partial-correction'),/immutable/i);
  assert.equal(raw.prepare('SELECT total_changes() n').get().n,before);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM balance_history WHERE source_sheet='Correction'").get().n,0);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM financial_write_claims').get().n,0);
});

test('salary-cycle start correction moves active salary-source membership atomically',async()=>{
  const {db,raw}=createSeededSqliteD1();
  await correct(db,{entityType:'salaryCycle',entityId:'family',correctedValues:{currentCycleStart:'2026-08-01',nextSalaryDate:'2026-08-31'},reason:'Correct cycle start evidence'},'cycle-correction');
  const cycle=raw.prepare("SELECT current_cycle_start,next_salary_date FROM salary_cycle_state WHERE household_id='family'").get();
  assert.deepEqual({...cycle},{current_cycle_start:'2026-08-01',next_salary_date:'2026-08-31'});
  const oldCount=raw.prepare("SELECT COUNT(*) AS n FROM salary_cycle_sources WHERE cycle_start='2026-07-31'").get().n;
  const newSources=raw.prepare("SELECT source FROM salary_cycle_sources WHERE cycle_start='2026-08-01' ORDER BY source").all().map(row=>row.source);
  assert.equal(oldCount,0);
  assert.deepEqual(newSources,['Alex Salary','Olga Salary']);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM correction_audit').get().n,1);
  assert.equal(raw.prepare('SELECT current_revision AS n FROM household_revisions').get().n,1);
});
