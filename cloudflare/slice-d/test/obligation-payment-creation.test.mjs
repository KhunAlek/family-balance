import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { executeRevisionClaimWrite } from '../../slice-c/src/write-protocol.mjs';
import { planFinancialWrite } from '../../slice-c/src/write-actions.mjs';
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

test('occurrence status is derived from terminal sums for unpaid, partial, paid, and overpaid amounts',()=>{
  const base={salaryCycle:{current_cycle_start:'2026-09-01',next_salary_date:'2026-10-01'},config:{},fixedExpenseEnabled:true,obligations:[{name:'Rent',expected_amount_satang:10000,amount_type:'Fixed'}],obligationOccurrences:[{occurrence_id:'o',obligation_name:'Rent',due_date:'2026-09-15',expected_amount_satang:10000,amount_type:'Fixed',cycle_start:'2026-09-01'}],logicalTransactions:[],logicalTransactionVersions:[],logicalTransactionComponents:[]};
  const state=amount=>remainingFixedObligations({...base,obligationPayments:amount===0?[]:[{payment_id:'p',obligation_name:'Rent',occurrence_due_date:'2026-09-15',payment_date:'2026-09-10',actual_amount_satang:amount,payment_status:'Final'}]},'2026-09-10').items[0];
  assert.deepEqual([state(0).paidAmount,state(5000).status,state(10000).status,state(12000).status,state(12000).remainingAmount],[0,'Partially paid','Paid','Paid',0]);
});
