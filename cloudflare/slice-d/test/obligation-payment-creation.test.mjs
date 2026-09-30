import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { executeRevisionClaimWrite } from '../../slice-c/src/write-protocol.mjs';
import { planFinancialWrite } from '../../slice-c/src/write-actions.mjs';
import { executeObligationPayment } from '../../slice-c/src/obligation-payment.mjs';
import { runTerminalTransactionReadModel } from '../src/terminal-transaction-read-model.mjs';
import { remainingFixedObligations } from '../../slice-b/src/obligations.mjs';

const migrations=['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql','0014_one_off_management_lifecycle.sql','0015_other_income_receipt_parent.sql','0016_obligation_payment_management.sql','0017_ktb_transfer_management.sql','0018_fund_movement_management.sql','0019_salary_receipt_management.sql'];

test('0016 adds only empty durable relationships and does not backfill or alter existing facts',t=>{
  const {raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of migrations.slice(0,-4))raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const payments=raw.prepare('SELECT * FROM obligation_payments ORDER BY payment_id').all(),balances=raw.prepare('SELECT balance_row_id,household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,income_receipt_source,income_receipt_amount_satang,source_sheet,source_row,one_off_payment_id FROM balance_history ORDER BY balance_row_id').all();
  raw.exec(fs.readFileSync(new URL('../migrations/0016_obligation_payment_management.sql',import.meta.url),'utf8'));
  assert.deepEqual(raw.prepare('SELECT * FROM obligation_payments ORDER BY payment_id').all(),payments);assert.deepEqual(raw.prepare('SELECT balance_row_id,household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,income_receipt_source,income_receipt_amount_satang,source_sheet,source_row,one_off_payment_id FROM balance_history ORDER BY balance_row_id').all(),balances);assert.equal(raw.prepare('SELECT count(*) n FROM obligation_payment_allocations').get().n,0);assert.equal(raw.prepare('SELECT count(*) n FROM balance_history WHERE obligation_payment_id IS NOT NULL').get().n,0);
});

test('new split obligation payment atomically creates durable identity, occurrence, allocations, and cash effect',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of migrations)raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  raw.exec("UPDATE salary_cycle_state SET current_cycle_start='2026-08-01',next_salary_date='2026-09-01'; INSERT INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start) VALUES('create-occ','family','Claude','2026-08-20',30000,'Fixed','2026-08-01')");
  const result=await executeRevisionClaimWrite(db,{householdId:'family',actorEmail:'alex@example.com',action:'obligationPayment',writeToken:'create-obligation',nowIso:'2026-08-15T05:00:00.000Z',payload:{requestId:'create-obligation-request',obligationName:'Claude',occurrenceDueDate:'2026-08-20',date:'2026-08-15',allocations:[{account:'Alex',amountSatang:10000},{account:'Olga',amountSatang:5000}],note:'split'},planWrite:planFinancialWrite});
  assert.equal(result.logicalTransactionId,'create-obligation:obligation-transaction');
  assert.equal(raw.prepare('SELECT count(*) n FROM obligation_payment_allocations WHERE payment_id=?').get('create-obligation:obligation').n,2);
  assert.equal(raw.prepare('SELECT obligation_payment_id FROM balance_history WHERE source_row=?').get(101).obligation_payment_id,'create-obligation:obligation');
  const tx=(await runTerminalTransactionReadModel(db)).model.activeTransactions.find(row=>row.logicalTransactionId===result.logicalTransactionId);
  assert.deepEqual(tx.allocations,[{account:'Alex',amountSatang:10000},{account:'Olga',amountSatang:5000}]);
});

test('managed obligation creation requires a stable request and replays it exactly once',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of migrations)raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  raw.exec("UPDATE salary_cycle_state SET current_cycle_start='2026-08-01',next_salary_date='2026-09-01'; INSERT INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start) VALUES('retry-occ','family','Claude','2026-08-20',30000,'Fixed','2026-08-01')");
  const initialPayments=raw.prepare('SELECT count(*) n FROM obligation_payments').get().n,payload={requestId:'obligation-retry',obligationName:'Claude',occurrenceDueDate:'2026-08-20',date:'2026-08-15',sourceAccount:'Alex',amount:100,note:''};
  const save=(value=payload,extra={})=>executeObligationPayment(db,{householdId:'family',actorEmail:'alex@example.com',action:'obligationPayment',nowIso:'2026-08-15T05:00:00.000Z',payload:value,...extra});
  const result=await save(),replay=await save();assert.deepEqual(replay,result);assert.equal(raw.prepare('SELECT count(*) n FROM obligation_payments').get().n,initialPayments+1);assert.equal(raw.prepare('SELECT count(*) n FROM new_function_request_receipts').get().n,1);
  await assert.rejects(save({...payload,amount:200}),/different details/);assert.equal(raw.prepare('SELECT count(*) n FROM obligation_payments').get().n,initialPayments+1);
});

test('missing request ID and forced failure leave managed obligation state unchanged',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of migrations)raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  raw.exec("UPDATE salary_cycle_state SET current_cycle_start='2026-08-01',next_salary_date='2026-09-01'; INSERT INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start) VALUES('failure-occ','family','Claude','2026-08-20',30000,'Fixed','2026-08-01')");
  const initial={payments:raw.prepare('SELECT count(*) n FROM obligation_payments').get().n,transactions:raw.prepare('SELECT count(*) n FROM logical_transactions').get().n},base={obligationName:'Claude',occurrenceDueDate:'2026-08-20',date:'2026-08-15',sourceAccount:'Alex',amount:100,note:''},save=(payload,extra={})=>executeObligationPayment(db,{householdId:'family',actorEmail:'alex@example.com',action:'obligationPayment',nowIso:'2026-08-15T05:00:00.000Z',payload,...extra});
  await assert.rejects(save(base),/stable request ID/);await assert.rejects(save({...base,requestId:'obligation-failure'},{testOnlyForcedFailure:true}));
  assert.equal(raw.prepare('SELECT count(*) n FROM obligation_payments').get().n,initial.payments);assert.equal(raw.prepare('SELECT count(*) n FROM logical_transactions').get().n,initial.transactions);for(const table of ['obligation_payment_allocations','new_function_request_receipts','financial_write_claims'])assert.equal(raw.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
});
test('occurrence status is derived from terminal sums for unpaid, partial, paid, and overpaid amounts',()=>{
  const base={salaryCycle:{current_cycle_start:'2026-09-01',next_salary_date:'2026-10-01'},config:{},fixedExpenseEnabled:true,obligations:[{name:'Rent',expected_amount_satang:10000,amount_type:'Fixed'}],obligationOccurrences:[{occurrence_id:'o',obligation_name:'Rent',due_date:'2026-09-15',expected_amount_satang:10000,amount_type:'Fixed',cycle_start:'2026-09-01'}],logicalTransactions:[],logicalTransactionVersions:[],logicalTransactionComponents:[]};
  const state=amount=>remainingFixedObligations({...base,obligationPayments:amount===0?[]:[{payment_id:'p',obligation_name:'Rent',occurrence_due_date:'2026-09-15',payment_date:'2026-09-10',actual_amount_satang:amount,payment_status:'Partial'}]},'2026-09-10').items[0];
  assert.deepEqual([state(0).paidAmount,state(5000).status,state(10000).status,state(12000).status,state(12000).remainingAmount],[0,'Partially paid','Paid','Paid',0]);
});

test('fixed rent finalization closes only the commitment and preserves the 12000 THB cash payment',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of migrations)raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  raw.exec("UPDATE salary_cycle_state SET current_cycle_start='2026-09-01',next_salary_date='2026-10-01'; UPDATE balance_history SET alex_balance_satang=2000000,olga_balance_satang=2000000 WHERE alex_balance_satang IS NOT NULL AND olga_balance_satang IS NOT NULL; INSERT INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start) VALUES('rent-final','family','Rent','2026-09-15',1500000,'Fixed','2026-09-01')");
  const base={householdId:'family',actorEmail:'alex@example.com',action:'obligationPayment',nowIso:'2026-09-10T05:00:00.000Z'},payload={requestId:'rent-final-request',obligationName:'Rent',occurrenceDueDate:'2026-09-15',date:'2026-09-10',sourceAccount:'Alex',amount:12000,paymentStatus:'Final',note:'September rent'};
  const save=value=>executeObligationPayment(db,{...base,payload:value});
  const result=await save(payload),replay=await save(payload);
  assert.deepEqual(replay,result);
  assert.equal(result.paymentStatus,'Final');
  const payment=raw.prepare('SELECT actual_amount_satang,payment_status FROM obligation_payments WHERE payment_id=?').get(`${result.writeToken}:obligation`);
  assert.equal(payment.actual_amount_satang,1200000);assert.equal(payment.payment_status,'Final');
  const snapshot=await import('../../slice-b/src/d1-repository.mjs').then(m=>m.loadFinancialSnapshot(db));
  const rent=remainingFixedObligations(snapshot,'2026-09-10').items.find(x=>x.occurrenceKey==='Rent|2026-09-15');
  assert.deepEqual({paid:rent.paidAmount,remaining:rent.remainingAmount,final:rent.isFinalPayment},{paid:12000,remaining:0,final:true});
  assert.equal(raw.prepare('SELECT count(*) n FROM obligation_payments WHERE occurrence_id=?').get('rent-final').n,1);
  await assert.rejects(save({...payload,requestId:'rent-again',amount:1}),/already closed/);
  assert.equal(raw.prepare('SELECT count(*) n FROM obligation_payments WHERE occurrence_id=?').get('rent-final').n,1);
});

test('partial rent leaves a 3000 THB commitment; an explicit final 1 THB payment closes it without inventing cash',async t=>{
  const {db,raw}=createSeededSqliteD1();t.after(()=>raw.close());for(const name of migrations)raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  raw.exec("UPDATE salary_cycle_state SET current_cycle_start='2026-09-01',next_salary_date='2026-10-01'; UPDATE balance_history SET alex_balance_satang=2000000,olga_balance_satang=2000000 WHERE alex_balance_satang IS NOT NULL AND olga_balance_satang IS NOT NULL; INSERT INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start) VALUES('rent-partial','family','Rent','2026-09-15',1500000,'Fixed','2026-09-01')");
  const base={householdId:'family',actorEmail:'alex@example.com',action:'obligationPayment',nowIso:'2026-09-10T05:00:00.000Z'},details={obligationName:'Rent',occurrenceDueDate:'2026-09-15',date:'2026-09-10',sourceAccount:'Alex',note:''},save=payload=>executeObligationPayment(db,{...base,payload:{...details,...payload}});
  await save({requestId:'rent-partial-request',amount:12000,paymentStatus:'Partial'});
  let snapshot=await import('../../slice-b/src/d1-repository.mjs').then(m=>m.loadFinancialSnapshot(db));
  assert.equal(remainingFixedObligations(snapshot,'2026-09-10').items.find(x=>x.name==='Rent').remainingAmount,3000);
  await assert.rejects(save({requestId:'rent-bad-status',amount:1,paymentStatus:'Almost Final'}),/Choose Final or Partial/);
  await save({requestId:'rent-last-baht',amount:1,paymentStatus:'Final'});
  snapshot=await import('../../slice-b/src/d1-repository.mjs').then(m=>m.loadFinancialSnapshot(db));
  const rent=remainingFixedObligations(snapshot,'2026-09-10').items.find(x=>x.name==='Rent');
  assert.deepEqual({paid:rent.paidAmount,remaining:rent.remainingAmount},{paid:12001,remaining:0});
  assert.deepEqual(raw.prepare("SELECT actual_amount_satang,payment_status FROM obligation_payments WHERE occurrence_id='rent-partial' ORDER BY actual_amount_satang DESC").all().map(x=>[x.actual_amount_satang,x.payment_status]),[[1200000,'Partial'],[100,'Final']]);
});

test('a later final payment closes the obligation only as of its payment date',()=>{
  const base={salaryCycle:{current_cycle_start:'2026-09-01',next_salary_date:'2026-10-01'},config:{},fixedExpenseEnabled:true,obligations:[{name:'Rent',expected_amount_satang:1500000,amount_type:'Fixed'}],obligationOccurrences:[{occurrence_id:'rent',obligation_name:'Rent',due_date:'2026-09-15',expected_amount_satang:1500000,amount_type:'Fixed',cycle_start:'2026-09-01'}],logicalTransactions:[],logicalTransactionVersions:[],logicalTransactionComponents:[],obligationPayments:[{payment_id:'partial',obligation_name:'Rent',occurrence_id:'rent',occurrence_due_date:'2026-09-15',payment_date:'2026-09-10',actual_amount_satang:1200000,payment_status:'Partial'},{payment_id:'final',obligation_name:'Rent',occurrence_id:'rent',occurrence_due_date:'2026-09-15',payment_date:'2026-09-11',actual_amount_satang:100,payment_status:'Final'}]};
  assert.equal(remainingFixedObligations(base,'2026-09-10').items[0].remainingAmount,3000);
  assert.equal(remainingFixedObligations(base,'2026-09-11').items[0].remainingAmount,0);
});
