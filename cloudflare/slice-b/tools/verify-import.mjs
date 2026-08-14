import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2];
const sourceReportPath = process.argv[3];
if (!dbPath || !sourceReportPath) throw new Error('Usage: node verify-import.mjs DB SOURCE_REPORT [OUTPUT]');
const outputPath = process.argv[4];
const db = new DatabaseSync(dbPath, { readOnly: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here,'../source');
const read = name => JSON.parse(fs.readFileSync(path.join(sourceDir,name),'utf8'));
const sourceReport = JSON.parse(fs.readFileSync(sourceReportPath,'utf8'));
const metadata = read('metadata.json');
const weeklySource = read('weekly-snapshot.json');
const cutoverPeriod = metadata.scriptProperties.OBLIGATION_PAYMENTS_CUTOVER_PERIOD;
const satang = value => typeof value === 'number' ? Math.round((value + Number.EPSILON) * 100) : null;
const thb = value => value === null || value === undefined ? null : Math.round(value) / 100;
const one = (sql,...params) => db.prepare(sql).get(...params);
const all = (sql,...params) => db.prepare(sql).all(...params);

const tableNames = ['households','configuration','balance_history','income_definitions','income_receipts','salary_cycle_state','obligations','obligation_occurrences','obligation_payments','goals','ledger_movements','weekly_snapshots','financial_write_claims','correction_audit'];
const destinationRowCounts = Object.fromEntries(tableNames.map(t=>[t,Number(one(`SELECT COUNT(*) AS n FROM ${t}`).n)]));
const expectedCounts = {
  households:1, configuration:10, balance_history:69, income_definitions:4, income_receipts:2,
  salary_cycle_state:1, obligations:8, obligation_occurrences:8, obligation_payments:8,
  goals:1, ledger_movements:3, weekly_snapshots:8, financial_write_claims:0, correction_audit:0
};

const failures = [];
for (const [table,expected] of Object.entries(expectedCounts)) if (destinationRowCounts[table] !== expected) failures.push(`row count ${table}: expected ${expected}, got ${destinationRowCounts[table]}`);
if (sourceReport.rejectedRows.length) failures.push(`rejected source rows: ${JSON.stringify(sourceReport.rejectedRows)}`);

const current = one(`SELECT business_date,source_row,alex_balance_satang,olga_balance_satang FROM balance_history WHERE alex_balance_satang IS NOT NULL AND olga_balance_satang IS NOT NULL ORDER BY business_date DESC,sheet_order DESC LIMIT 1`);
if (Number(current.alex_balance_satang)!==228500 || Number(current.olga_balance_satang)!==1145500 || current.business_date!=='2026-08-12') failures.push(`current balances mismatch: ${JSON.stringify(current)}`);

const ef = one(`SELECT COALESCE(SUM(CASE WHEN direction='Contribution' THEN amount_satang WHEN direction='Withdrawal' THEN -amount_satang ELSE 0 END),0) AS balance FROM ledger_movements WHERE household_id='family' AND account='EF'`);
if (Number(ef.balance)!==13723100) failures.push(`EF balance mismatch: ${ef.balance}`);

const goalBalances = all(`SELECT g.name,g.target_amount_satang,g.priority_rank,g.status,COALESCE(SUM(CASE WHEN l.direction='Contribution' THEN l.amount_satang WHEN l.direction='Withdrawal' THEN -l.amount_satang ELSE 0 END),0) AS saved_satang FROM goals g LEFT JOIN ledger_movements l ON l.household_id=g.household_id AND l.account=g.name WHERE g.household_id='family' GROUP BY g.name,g.target_amount_satang,g.priority_rank,g.status ORDER BY g.priority_rank`);
if (goalBalances.length!==1 || Number(goalBalances[0].saved_satang)!==0) failures.push(`goal balance mismatch: ${JSON.stringify(goalBalances)}`);

const salaryCycle = one(`SELECT current_cycle_start,next_salary_date,salary_receipt_cutover_date FROM salary_cycle_state WHERE household_id='family'`);
if (salaryCycle.current_cycle_start!=='2026-07-31' || salaryCycle.next_salary_date!=='2026-08-31' || salaryCycle.salary_receipt_cutover_date!=='2026-08-13') failures.push(`salary cycle mismatch: ${JSON.stringify(salaryCycle)}`);

const obligationRows = all(`SELECT o.name,o.expected_amount_satang,o.amount_type,o.legacy_paid_this_month,oc.due_date,COALESCE(SUM(p.actual_amount_satang),0) AS paid_satang,MAX(CASE WHEN p.payment_status='Final' THEN 1 ELSE 0 END) AS has_final FROM obligations o JOIN obligation_occurrences oc ON oc.household_id=o.household_id AND oc.obligation_name=o.name LEFT JOIN obligation_payments p ON p.household_id=o.household_id AND p.obligation_name=o.name AND p.occurrence_due_date=oc.due_date WHERE o.household_id='family' AND substr(oc.due_date,1,7)=? GROUP BY o.name,o.expected_amount_satang,o.amount_type,o.legacy_paid_this_month,oc.due_date ORDER BY oc.due_date,o.name`,cutoverPeriod);
const remainingObligations = obligationRows.map(row=>{
  let remaining;
  if (row.amount_type==='Variable' && Number(row.has_final)===1) remaining=0;
  else if (Number(row.paid_satang)===0 && Number(row.legacy_paid_this_month)===1) remaining=0;
  else remaining=Math.max(Number(row.expected_amount_satang)-Number(row.paid_satang),0);
  return {name:row.name,dueDate:row.due_date,expectedSatang:Number(row.expected_amount_satang),paidSatang:Number(row.paid_satang),remainingSatang:remaining,amountType:row.amount_type,hasFinal:Number(row.has_final)===1};
});
const remainingObligationTotalSatang = remainingObligations.reduce((sum,r)=>sum+r.remainingSatang,0);
if (remainingObligationTotalSatang!==1400) failures.push(`remaining obligations mismatch: ${remainingObligationTotalSatang}`);

const weeklyDb = all(`SELECT week_start,week_end,planned_variables_satang,spent_variables_satang,spent_variables_status,difference_satang,opening_balance_satang,opening_balance_status,closing_balance_satang,status FROM weekly_snapshots WHERE household_id='family' ORDER BY week_start`);
const weeklyExpected = [...weeklySource].sort((a,b)=>a['Week start'].localeCompare(b['Week start']));
const weeklyMismatches=[];
if (weeklyDb.length!==weeklyExpected.length) weeklyMismatches.push({reason:'row count',expected:weeklyExpected.length,actual:weeklyDb.length});
for (let i=0;i<Math.min(weeklyDb.length,weeklyExpected.length);i++) {
  const d=weeklyDb[i], s=weeklyExpected[i];
  const expected={week_start:s['Week start'],week_end:s['Week end'],planned_variables_satang:satang(s['Planned variables']),spent_variables_satang:satang(s['Spent variables']),spent_variables_status:typeof s['Spent variables']==='number'?null:s['Spent variables'],difference_satang:satang(s.Difference),opening_balance_satang:satang(s['Opening balance']),opening_balance_status:typeof s['Opening balance']==='number'?null:s['Opening balance'],closing_balance_satang:satang(s['Closing balance']),status:s.Status};
  const actual=Object.fromEntries(Object.entries(d).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v]));
  if (JSON.stringify(actual)!==JSON.stringify(expected)) weeklyMismatches.push({sourceRow:s.sourceRow,expected,actual});
}
if (weeklyMismatches.length) failures.push(`WeeklySnapshot mismatches: ${weeklyMismatches.length}`);

const exactDuplicateGroups = sourceReport.exactDuplicateGroups;
const expectedDuplicateRows = [[13,14],[32,33],[39,40],[58,59]];
const balanceDuplicates = exactDuplicateGroups.filter(g=>g.sheet==='Balance Check').map(g=>g.sourceRows);
if (JSON.stringify(balanceDuplicates)!==JSON.stringify(expectedDuplicateRows)) failures.push(`exact duplicate report mismatch: ${JSON.stringify(balanceDuplicates)}`);

const report={
  source:sourceReport.source,
  sourceSheetRowCounts:sourceReport.sourceSheetRowCounts,
  sourceTotalRows:sourceReport.sourceTotalRows,
  destinationRowCounts,
  rejectedRows:sourceReport.rejectedRows,
  exactDuplicateGroups,
  currentBalances:{asOf:current.business_date,sourceRow:Number(current.source_row),alexSatang:Number(current.alex_balance_satang),olgaSatang:Number(current.olga_balance_satang),alexTHB:thb(Number(current.alex_balance_satang)),olgaTHB:thb(Number(current.olga_balance_satang)),combinedTHB:thb(Number(current.alex_balance_satang)+Number(current.olga_balance_satang))},
  ef:{balanceSatang:Number(ef.balance),balanceTHB:thb(Number(ef.balance))},
  goals:goalBalances.map(g=>({name:g.name,targetSatang:Number(g.target_amount_satang),savedSatang:Number(g.saved_satang),targetTHB:thb(Number(g.target_amount_satang)),savedTHB:thb(Number(g.saved_satang)),priorityRank:Number(g.priority_rank),status:g.status})),
  remainingObligations,
  remainingObligationTotalSatang,
  remainingObligationTotalTHB:thb(remainingObligationTotalSatang),
  salaryCycle,
  weeklySnapshot:{sourceRows:weeklyExpected.length,destinationRows:weeklyDb.length,mismatches:weeklyMismatches},
  status:failures.length?'FAIL':'PASS',
  failures
};
const text=JSON.stringify(report,null,2)+'\n';
if (outputPath) fs.writeFileSync(outputPath,text); else process.stdout.write(text);
if (failures.length) process.exitCode=1;
