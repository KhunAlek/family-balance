import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BACKUP_TABLES } from '../src/backup.mjs';
import { buildTerminalTransactionReadModel } from '../src/terminal-transaction-read-model.mjs';
import { otherIncomeEligibility } from '../src/other-income-management.mjs';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';

const names=['0006_new_functionality.sql','0007_reporting_cycles.sql','0008_other_income.sql','0009_typed_payment_effect.sql','0010_historical_one_offs.sql','0011_fixed_expenses.sql','0012_fixed_expense_weekly.sql','0013_transaction_identity.sql','0014_one_off_management_lifecycle.sql','0015_other_income_receipt_parent.sql','0016_obligation_payment_management.sql','0017_ktb_transfer_management.sql','0018_fund_movement_management.sql','0019_salary_receipt_management.sql','0020_historical_one_off_management.sql'];
const migration=fs.readFileSync(new URL('../migrations/0021_historical_other_income_management.sql',import.meta.url),'utf8');
const rows=(raw,table)=>raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
const snapshot=raw=>Object.fromEntries(BACKUP_TABLES.map(table=>[table,rows(raw,table)]));

test('0021 promotes provable variable-income receipts without changing amounts or balance rows',t=>{
  const f=createSeededSqliteD1();t.after(()=>f.raw.close());for(const name of names)f.raw.exec(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const beforeBalances=rows(f.raw,'balance_history'),beforeAmounts=rows(f.raw,'income_receipts').map(r=>[r.receipt_id,r.amount_satang,r.business_date,r.lands_in,r.source_balance_row_id]);
  f.raw.exec(migration);
  assert.deepEqual(rows(f.raw,'balance_history'),beforeBalances);
  assert.deepEqual(rows(f.raw,'income_receipts').map(r=>[r.receipt_id,r.amount_satang,r.business_date,r.lands_in,r.source_balance_row_id]),beforeAmounts);
  const model=buildTerminalTransactionReadModel(snapshot(f.raw));
  const promoted=model.activeTransactions.filter(x=>x.logicalTransactionId.startsWith('managed-history:other-income:'));
  assert.ok(promoted.length>0);
  assert.equal(promoted.every(x=>x.identitySource==='persisted'&&x.permittedActions.correct&&otherIncomeEligibility({transaction:x,payload:{operation:'corrected'},tables:snapshot(f.raw)}).eligible),true);
  assert.deepEqual(f.raw.prepare('PRAGMA foreign_key_check').all(),[]);
});
