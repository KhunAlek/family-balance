import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLockedSourceSnapshot } from '../../slice-b/test/source-snapshot.mjs';
import { planSalaryReceiptTransition } from '../src/salary-cycle.mjs';
import { buildMissingClosedWeeklySnapshots } from '../src/weekly-freeze.mjs';
import { planFinancialWrite } from '../src/write-actions.mjs';

const clone = value => structuredClone(value);

function ctx(snapshot, payload, nowIso) {
  return {
    snapshot,
    householdId:'family',
    baseRevision:0,
    nextRevision:1,
    actorEmail:'abystrov66@gmail.com',
    action:'incomeReceipt',
    payload,
    nowIso,
    writeToken:'salary-test'
  };
}

test('imported active cycle is seeded with both configured salary sources', () => {
  const snapshot=loadLockedSourceSnapshot();
  assert.deepEqual(snapshot.salaryCycleSources,[
    {cycle_start:'2026-07-31',source:'Alex Salary'},
    {cycle_start:'2026-07-31',source:'Olga Salary'}
  ]);
});

test('early repeat salary opens a new cycle and freezes every missing closed card through the previous day', () => {
  const snapshot=loadLockedSourceSnapshot();
  const transition=planSalaryReceiptTransition(snapshot,'2026-08-29','Alex Salary','family');
  assert.equal(transition.advanced,true);
  assert.equal(transition.newCycleStart,'2026-08-29');
  assert.deepEqual(transition.frozenWeeklySnapshots.map(row=>[row.week_start,row.week_end]),[
    ['2026-08-10','2026-08-16'],
    ['2026-08-17','2026-08-23'],
    ['2026-08-24','2026-08-28']
  ]);
  assert.equal(transition.statements.filter(item=>/INSERT INTO weekly_snapshots/.test(item.sql)).length,3);
  assert.match(transition.statements.at(-2).sql,/UPDATE salary_cycle_state/);
  assert.match(transition.statements.at(-1).sql,/salary_cycle_sources/);
});

test('expected boundary salary also freezes the final 24-30 Aug card', () => {
  const snapshot=loadLockedSourceSnapshot();
  const rows=buildMissingClosedWeeklySnapshots(snapshot,'2026-07-31','2026-08-31','2026-08-30');
  assert.deepEqual(rows.map(row=>[row.week_start,row.week_end]),[
    ['2026-08-10','2026-08-16'],
    ['2026-08-17','2026-08-23'],
    ['2026-08-24','2026-08-30']
  ]);
});

test('second household salary after a newly opened cycle joins that cycle rather than opening another one', () => {
  const snapshot=clone(loadLockedSourceSnapshot());
  snapshot.salaryCycle={current_cycle_start:'2026-08-31',next_salary_date:'2026-09-29',salary_receipt_cutover_date:'2026-08-13'};
  snapshot.salaryCycleSources=[{cycle_start:'2026-08-31',source:'Alex Salary'}];
  const transition=planSalaryReceiptTransition(snapshot,'2026-09-01','Olga Salary','family');
  assert.equal(transition.advanced,false);
  assert.equal(transition.cycleStart,'2026-08-31');
  assert.equal(transition.statements.length,1);
  assert.match(transition.statements[0].sql,/salary_cycle_sources/);
  assert.equal(transition.statements[0].params[1],'2026-08-31');
  assert.equal(transition.statements[0].params[2],'Olga Salary');
});

test('income receipt write includes old-cycle card freezes and the new-cycle salary membership in the same business plan', async () => {
  const snapshot=loadLockedSourceSnapshot();
  const plan=await planFinancialWrite(ctx(snapshot,{
    date:'2026-08-29',incomeSource:'Alex Salary',incomeAlexAmount:33775,incomeOlgaAmount:0
  },'2026-08-29T12:00:00.000Z'));
  assert.equal(plan.response.salaryCycleAdvanced,true);
  assert.equal(plan.response.nextSalaryDateRequired,true);
  assert.equal(plan.statements.filter(item=>/INSERT INTO weekly_snapshots/.test(item.sql)).length,3);
  assert.ok(plan.statements.some(item=>/UPDATE salary_cycle_state/.test(item.sql)));
  assert.ok(plan.statements.some(item=>/salary_cycle_sources/.test(item.sql)));
});
