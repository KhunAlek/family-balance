import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { fixedOccurrenceDates, executeFixedExpenseWrite, previewFixedExpense } from '../../slice-c/src/fixed-expenses.mjs';

const migrations = ['0006_new_functionality.sql','0007_reporting_cycles.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql'];
function fixture(t) {
  const f = createSeededSqliteD1();
  t.after(() => f.raw.close());
  for (const name of migrations) f.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  return f;
}
const base = { name:'Insurance', amount:1200, recurrenceType:'monthly', dueDay:20, dueWeekday:null, amountType:'Fixed', effectiveDate:'2026-08-01' };
const save = (db, action, payload, nowIso='2026-08-20T05:00:00.000Z', extra={}) => executeFixedExpenseWrite(db, { action, nowIso, ...extra, payload:{...payload, action, requestId:payload.requestId || action} });
const rows = (raw, name='Insurance') => raw.prepare('SELECT * FROM obligation_occurrences WHERE obligation_name=? ORDER BY cycle_start,due_date,occurrence_id').all(name);
const pay = (raw, occurrence, amount=120000) => raw.prepare("INSERT INTO obligation_payments(payment_id,household_id,obligation_name,payment_date,occurrence_due_date,expected_amount_satang,actual_amount_satang,occurrence_id) VALUES(?,?,?,?,?,?,?,?)").run(`pay-${occurrence.occurrence_id}`,'family',occurrence.obligation_name,'2026-08-20',occurrence.due_date,occurrence.expected_amount_satang,amount,occurrence.occurrence_id);

test('monthly/yearly preserve short-month and leap-day clamping; weekly spans month, year and exclusive salary boundary', () => {
  assert.deepEqual(fixedOccurrenceDates({active:1,recurrence_type:'monthly',due_day:31},'2026-01-30','2026-03-02'),['2026-01-31','2026-02-28']);
  assert.deepEqual(fixedOccurrenceDates({active:1,recurrence_type:'yearly',due_month:2,due_day:29},'2024-01-01','2027-01-01'),['2024-02-29','2025-02-28','2026-02-28']);
  assert.deepEqual(fixedOccurrenceDates({active:1,recurrence_type:'weekly',due_weekday:1,start_date:'2026-12-28'},'2026-12-20','2027-01-12'),['2026-12-28','2027-01-04','2027-01-11']);
  assert.deepEqual(fixedOccurrenceDates({active:1,recurrence_type:'weekly',due_weekday:2},'2027-01-01','2027-01-12'),['2027-01-05']);
});

test('valid add and overdue unpaid edit atomically replace rather than duplicate, including due-date and weekday changes', async t => {
  const {db,raw}=fixture(t);
  raw.prepare("UPDATE salary_cycle_state SET current_cycle_start='2026-07-31',next_salary_date='2026-09-30'").run();
  await save(db,'addFixedExpense',{...base,dueDay:5});
  assert.deepEqual(rows(raw).map(x=>x.due_date),['2026-08-05','2026-09-05']);
  const result=await save(db,'editFixedExpense',{...base,recurrenceType:'weekly',dueDay:null,dueWeekday:3,amount:1500,requestId:'weekly-edit'});
  const after=rows(raw);
  assert.deepEqual(after.map(x=>x.due_date),['2026-08-05','2026-08-12','2026-08-19','2026-08-26','2026-09-02','2026-09-09','2026-09-16','2026-09-23']);
  assert.ok(after.every(x=>x.expected_amount_satang===150000));
  assert.equal(new Set(after.map(x=>x.due_date)).size,after.length);
  assert.equal(result.replaced.length,2);
});

test('paid and partially paid current-cycle occurrences reject an altering edit', async t => {
  for (const amount of [120000,10000]) {
    const {db,raw}=fixture(t);
    await save(db,'addFixedExpense',base);
    pay(raw,rows(raw)[0],amount);
    await assert.rejects(save(db,'editFixedExpense',{...base,amount:1300,requestId:`blocked-${amount}`}),/paid or partially paid/);
  }
});

test('prior-cycle occurrence is retained and preview exactly reports retained, replaced and created rows', async t => {
  const {db,raw}=fixture(t);
  await save(db,'addFixedExpense',base);
  raw.prepare("INSERT INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start) VALUES('prior','family','Insurance','2026-07-20',120000,'Fixed','2026-06-30')").run();
  const preview=await previewFixedExpense(db,{...base,action:'editFixedExpense',amount:1300},'family','2026-08-20T05:00:00.000Z');
  assert.deepEqual(preview.retained.map(x=>x.occurrence_id),['prior']);
  assert.deepEqual(preview.replaced.map(x=>x.due_date),['2026-08-20']);
  assert.deepEqual(preview.created.map(x=>x.due_date),['2026-08-20']);
  await save(db,'editFixedExpense',{...base,amount:1300,requestId:'preserve'});
  assert.equal(raw.prepare("SELECT expected_amount_satang FROM obligation_occurrences WHERE occurrence_id='prior'").get().expected_amount_satang,120000);
});

test('retry is idempotent, changed-payload retry is rejected, and forced failure rolls back definition, occurrences, receipt and revision', async t => {
  const {db,raw}=fixture(t),payload={...base,requestId:'fixed-replay'};
  const first=await save(db,'addFixedExpense',payload);
  assert.deepEqual(await save(db,'addFixedExpense',payload),first);
  assert.equal(rows(raw).length,1);
  await assert.rejects(save(db,'addFixedExpense',{...payload,amount:1300}),/different details/);
  const beforeDef=raw.prepare('SELECT * FROM obligations ORDER BY name').all(),beforeOccurrences=raw.prepare('SELECT * FROM obligation_occurrences ORDER BY occurrence_id').all(),revision=raw.prepare('SELECT current_revision FROM household_revisions').get().current_revision;
  await assert.rejects(save(db,'editFixedExpense',{...base,amount:1500,requestId:'rollback'},undefined,{testOnlyForcedFailure:true}),/__slice_c_forced_failure__/);
  assert.deepEqual(raw.prepare('SELECT * FROM obligations ORDER BY name').all(),beforeDef);
  assert.deepEqual(raw.prepare('SELECT * FROM obligation_occurrences ORDER BY occurrence_id').all(),beforeOccurrences);
  assert.equal(raw.prepare("SELECT count(*) n FROM new_function_request_receipts WHERE request_id='rollback'").get().n,0);
  assert.equal(raw.prepare('SELECT current_revision FROM household_revisions').get().current_revision,revision);
});

test('expired boundary preserves old-cycle rows; missing boundary saves definition without impact claim', async t => {
  const {db,raw}=fixture(t);
  await save(db,'addFixedExpense',base);
  const before=rows(raw);
  const expired=await save(db,'editFixedExpense',{...base,amount:1300,requestId:'expired'},'2026-09-06T05:00:00.000Z');
  assert.equal(expired.commitmentImpactKnown,false);
  assert.deepEqual(rows(raw),before);
  raw.prepare('UPDATE salary_cycle_state SET next_salary_date=NULL').run();
  const missing=await save(db,'addFixedExpense',{...base,name:'No boundary',requestId:'missing'});
  assert.equal(missing.commitmentImpactKnown,false);
  assert.equal(rows(raw,'No boundary').length,0);
});

test('deactivation preserves linked paid rows and removes only unpaid current-cycle rows', async t => {
  const {db,raw}=fixture(t);
  raw.prepare("UPDATE salary_cycle_state SET current_cycle_start='2026-07-31',next_salary_date='2026-10-01'").run();
  await save(db,'addFixedExpense',base);
  const before=rows(raw); pay(raw,before[0]);
  await save(db,'deactivateFixedExpense',{name:'Insurance',effectiveDate:'2026-08-20',requestId:'off'});
  assert.deepEqual(rows(raw).map(x=>x.occurrence_id),[before[0].occurrence_id]);
});
