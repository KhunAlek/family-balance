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

test('early repeat salary freezes every missing old-cycle card before v3 current-state reset', () => {
  const snapshot=loadLockedSourceSnapshot();
  const transition=planSalaryReceiptTransition(snapshot,'2026-08-29','Alex Salary','family');
  assert.equal(transition.advanced,true);
  assert.equal(transition.variablesTargetRequired,true);
  assert.equal(transition.newCycleStart,'2026-08-29');
  assert.deepEqual(transition.frozenWeeklySnapshots.map(row=>[row.week_start,row.week_end]),[
    ['2026-07-31','2026-08-02'],
    ['2026-08-10','2026-08-16'],
    ['2026-08-17','2026-08-23'],
    ['2026-08-24','2026-08-28']
  ]);
  assert.equal(transition.statements.filter(item=>/INSERT INTO weekly_snapshots/.test(item.sql)).length,4);
  const cycleResetIndex=transition.statements.findIndex(item=>/UPDATE salary_cycle_state SET current_cycle_start/.test(item.sql));
  const goalResetIndex=transition.statements.findIndex(item=>/UPDATE goals SET cycle_commitment_satang=0/.test(item.sql));
  const sourceIndex=transition.statements.findIndex(item=>/salary_cycle_sources/.test(item.sql));
  assert.ok(cycleResetIndex>=4);
  assert.ok(goalResetIndex>cycleResetIndex);
  assert.ok(sourceIndex>goalResetIndex);
  assert.deepEqual(transition.statements[cycleResetIndex].params.slice(0,2),['2026-08-29',1500000]);
});

test('expected boundary salary also freezes the final 24-30 Aug card', () => {
  const snapshot=loadLockedSourceSnapshot();
  const rows=buildMissingClosedWeeklySnapshots(snapshot,'2026-07-31','2026-08-31','2026-08-30');
  assert.deepEqual(rows.map(row=>[row.week_start,row.week_end]),[
    ['2026-07-31','2026-08-02'],
    ['2026-08-10','2026-08-16'],
    ['2026-08-17','2026-08-23'],
    ['2026-08-24','2026-08-30']
  ]);
  assert.ok(rows.every(row=>row.planned_variables_satang===null));
});

test('weekly freeze fills leading, interior, multiple, and trailing gaps without rewriting existing cards', () => {
  const snapshot=loadLockedSourceSnapshot();
  snapshot.salaryCycle.variables_target_satang=2200000;
  snapshot.weeklySnapshots=[
    {week_start:'2026-08-03',week_end:'2026-08-09',planned_variables_satang:777777},
    {week_start:'2026-08-17',week_end:'2026-08-23',planned_variables_satang:888888}
  ];
  const rows=buildMissingClosedWeeklySnapshots(snapshot,'2026-07-31','2026-08-31','2026-08-30');
  assert.deepEqual(rows.map(row=>[row.week_start,row.week_end]),[
    ['2026-07-31','2026-08-02'],
    ['2026-08-10','2026-08-16'],
    ['2026-08-24','2026-08-30']
  ]);
  assert.ok(rows.every(row=>row.planned_variables_satang!==null));
  assert.equal(snapshot.weeklySnapshots[0].planned_variables_satang,777777);
  assert.equal(snapshot.weeklySnapshots[1].planned_variables_satang,888888);
  snapshot.weeklySnapshots.push(...rows);
  assert.deepEqual(buildMissingClosedWeeklySnapshots(snapshot,'2026-07-31','2026-08-31','2026-08-30'),[]);
});

test('weekly freeze preserves NULL target across every missing gap', () => {
  const snapshot=loadLockedSourceSnapshot();
  snapshot.salaryCycle.variables_target_satang=null;
  snapshot.weeklySnapshots=[{week_start:'2026-08-10',week_end:'2026-08-16',planned_variables_satang:123456}];
  const rows=buildMissingClosedWeeklySnapshots(snapshot,'2026-07-31','2026-08-31','2026-08-30');
  assert.ok(rows.length>1);
  assert.ok(rows.every(row=>row.planned_variables_satang===null));
  assert.equal(snapshot.weeklySnapshots[0].planned_variables_satang,123456);
});

test('salary advance freezes every missing old-cycle card when next salary date is NULL', () => {
  for (const target of [2200000,null]) {
    const snapshot=clone(loadLockedSourceSnapshot());
    snapshot.salaryCycle.next_salary_date=null;
    snapshot.salaryCycle.variables_target_satang=target;
    snapshot.weeklySnapshots=[
      {week_start:'2026-08-03',week_end:'2026-08-09',planned_variables_satang:777777},
      {week_start:'2026-08-17',week_end:'2026-08-23',planned_variables_satang:888888}
    ];
    const transition=planSalaryReceiptTransition(snapshot,'2026-08-29','Alex Salary','family');
    assert.equal(transition.advanced,true);
    assert.deepEqual(transition.frozenWeeklySnapshots.map(row=>[row.week_start,row.week_end]),[
      ['2026-07-31','2026-08-02'],
      ['2026-08-10','2026-08-16'],
      ['2026-08-24','2026-08-28']
    ]);
    assert.ok(transition.frozenWeeklySnapshots.every(row=>target===null ? row.planned_variables_satang===null : row.planned_variables_satang!==null));
    const firstReset=transition.statements.findIndex(item=>/UPDATE salary_cycle_state SET current_cycle_start/.test(item.sql));
    const lastFreeze=Math.max(...transition.statements.map((item,index)=>/INSERT INTO weekly_snapshots/.test(item.sql)?index:-1));
    assert.ok(lastFreeze<firstReset);
    snapshot.weeklySnapshots.push(...transition.frozenWeeklySnapshots);
    assert.deepEqual(planSalaryReceiptTransition(snapshot,'2026-08-29','Alex Salary','family').frozenWeeklySnapshots,[]);
  }
});

test('second household salary after a newly opened cycle joins that cycle rather than opening another one', () => {
  const snapshot=clone(loadLockedSourceSnapshot());
  snapshot.salaryCycle={current_cycle_start:'2026-08-31',next_salary_date:'2026-09-29',salary_receipt_cutover_date:'2026-08-13',variables_target_satang:null,ef_cycle_commitment_satang:1500000};
  snapshot.salaryCycleSources=[{cycle_start:'2026-08-31',source:'Alex Salary'}];
  const transition=planSalaryReceiptTransition(snapshot,'2026-09-01','Olga Salary','family');
  assert.equal(transition.advanced,false);
  assert.equal(transition.cycleStart,'2026-08-31');
  assert.equal(transition.statements.length,1);
  assert.match(transition.statements[0].sql,/salary_cycle_sources/);
  assert.equal(transition.statements[0].params[1],'2026-08-31');
  assert.equal(transition.statements[0].params[2],'Olga Salary');
});

test('income receipt write includes freezes, planning reset, and new-cycle salary membership in one business plan', async () => {
  const snapshot=loadLockedSourceSnapshot();
  const plan=await planFinancialWrite(ctx(snapshot,{
    date:'2026-08-29',incomeSource:'Alex Salary',incomeAlexAmount:33775,incomeOlgaAmount:0
  },'2026-08-29T12:00:00.000Z'));
  assert.equal(plan.response.salaryCycleAdvanced,true);
  assert.equal(plan.response.nextSalaryDateRequired,true);
  assert.equal(plan.response.variablesTargetRequired,true);
  assert.equal(plan.statements.filter(item=>/INSERT INTO weekly_snapshots/.test(item.sql)).length,4);
  assert.ok(plan.statements.some(item=>/UPDATE salary_cycle_state SET current_cycle_start/.test(item.sql)));
  assert.ok(plan.statements.some(item=>/UPDATE goals SET cycle_commitment_satang=0/.test(item.sql)));
  assert.ok(plan.statements.some(item=>/salary_cycle_sources/.test(item.sql)));
});
