import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, '../source');
const read = name => JSON.parse(fs.readFileSync(path.join(sourceDir, name), 'utf8'));
const metadata = read('metadata.json');
const configRows = read('config.json');
const obligations = read('obligations.json');
const payments = read('obligation-payments.json');
const weekly = read('weekly-snapshot.json');
const income = read('income.json');
const goals = read('goals.json');
const ledger = read('ledger.json');
const balance = Array.from({length: 7}, (_, i) => read(`balance-check-${String(i + 1).padStart(2, '0')}.json`)).flat().sort((a,b)=>a.sourceRow-b.sourceRow);

const q = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const n = value => value === null || value === undefined || value === '' ? 'NULL' : String(Math.trunc(Number(value)));
const satangValue = value => value === null || value === undefined || value === '' || typeof value === 'string' ? null : Math.round((Number(value) + Number.EPSILON) * 100);
const s = value => { const v = satangValue(value); return v === null ? 'NULL' : String(v); };
const bool = value => value ? '1' : '0';
const id = 'family';
const sql = [];
const rejected = [];

function requireFields(sheet, row, fields) {
  const missing = fields.filter(f => row[f] === null || row[f] === undefined || row[f] === '');
  if (missing.length) rejected.push({sheet, sourceRow: row.sourceRow, reason:`missing ${missing.join(', ')}`});
  return missing.length === 0;
}

if (balance.length !== metadata.sheetRowCounts['Balance Check']) throw new Error(`Balance Check row count mismatch: ${balance.length}`);
if (configRows.length !== 1) throw new Error('Expected exactly one Config row.');

const cfg = configRows[0];
sql.push(`INSERT INTO households(household_id,name,currency,timezone) VALUES(${q(id)},'Family Cash Flow',${q(cfg.Currency)},${q(metadata.source.timezone)});`);
const configEntries = [
  ['emergency_fund_target', null, null, satangValue(cfg['Emergency fund target'])],
  ['currency', cfg.Currency, null, null],
  ['planning_variables_min', null, null, satangValue(cfg["Olga's monthly variable budget target"])],
  ['ef_monthly_claim_cap', null, null, satangValue(cfg['EF monthly claim cap'])],
  ['notification_emails', cfg['Notification emails'], null, null],
  ['salary_receipt_cutover_date', cfg['Salary receipt cutover date'], null, null],
  ['obligation_payments_cutover_period', metadata.scriptProperties.OBLIGATION_PAYMENTS_CUTOVER_PERIOD, null, null],
  ['source_snapshot_file', metadata.source.file, null, null],
  ['source_snapshot_sha256', metadata.source.sha256, null, null],
  ['source_snapshot_extracted_at', metadata.source.extractedAt, null, null]
];
for (const [key,text,integer,satang] of configEntries) {
  sql.push(`INSERT INTO configuration(household_id,config_key,value_text,value_integer,value_satang) VALUES(${q(id)},${q(key)},${q(text)},${integer===null?'NULL':n(integer)},${satang===null?'NULL':n(satang)});`);
}
sql.push(`INSERT INTO salary_cycle_state(household_id,current_cycle_start,next_salary_date,salary_receipt_cutover_date) VALUES(${q(id)},${q(cfg['Current salary cycle start'])},${q(cfg['Next salary date'])},${q(cfg['Salary receipt cutover date'])});`);

for (const row of income) {
  if (!requireFields('Income', row, ['Source','Expected amount','Pay day','Lands in'])) continue;
  sql.push(`INSERT INTO income_definitions(household_id,source,expected_amount_satang,pay_day,lands_in) VALUES(${q(id)},${q(row.Source)},${s(row['Expected amount'])},${q(row['Pay day'])},${q(row['Lands in'])});`);
}
const incomeBySource = new Map(income.map(r=>[r.Source,r]));

for (const row of balance) {
  if (!requireFields('Balance Check', row, ['Date'])) continue;
  sql.push(`INSERT INTO balance_history(household_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,income_receipt_source,income_receipt_amount_satang,source_sheet,source_row) VALUES(${q(id)},${q(row.Date)},${n(row.sourceRow)},${s(row['Alex KTB balance'])},${s(row['Olga KTB balance'])},${q(row['One-off payment name'])},${s(row['One-off payment amount'])},${q(row['One-off payment account'])},${q(row['Income receipt source'])},${s(row['Income receipt amount'])},'Balance Check',${n(row.sourceRow)});`);
  if (row['Income receipt source']) {
    const def = incomeBySource.get(row['Income receipt source']);
    if (!def || satangValue(row['Income receipt amount']) === null) {
      rejected.push({sheet:'Balance Check',sourceRow:row.sourceRow,reason:'invalid income receipt reference'});
    } else {
      sql.push(`INSERT INTO income_receipts(receipt_id,household_id,source,business_date,amount_satang,lands_in,source_balance_row_id) VALUES(${q(`balance-check:${row.sourceRow}:income`)},${q(id)},${q(row['Income receipt source'])},${q(row.Date)},${s(row['Income receipt amount'])},${q(def['Lands in'])},(SELECT balance_row_id FROM balance_history WHERE household_id=${q(id)} AND source_sheet='Balance Check' AND source_row=${n(row.sourceRow)}));`);
    }
  }
}

const obligationByName = new Map();
for (const row of obligations) {
  if (!requireFields('Obligations', row, ['Name','Amount (THB)','Due type','Amount type'])) continue;
  obligationByName.set(row.Name,row);
  sql.push(`INSERT INTO obligations(household_id,name,expected_amount_satang,due_type,due_day,category,amount_type,legacy_paid_this_month) VALUES(${q(id)},${q(row.Name)},${s(row['Amount (THB)'])},${q(row['Due type'])},${row['Due day']==null?'NULL':n(row['Due day'])},${q(row.Category)},${q(row['Amount type'])},${row['Paid this month']==='Y'?'1':'0'});`);
}

const cutoverPeriod = metadata.scriptProperties.OBLIGATION_PAYMENTS_CUTOVER_PERIOD;
const dueDateFor = (period, obligation) => {
  if (!obligation || !obligation['Due day']) return null;
  const month = String(period || '').slice(0,7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return `${month}-${String(obligation['Due day']).padStart(2,'0')}`;
};
for (const row of obligations) {
  const due = dueDateFor(cutoverPeriod,row);
  if (!due) continue;
  sql.push(`INSERT INTO obligation_occurrences(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type) VALUES(${q(`${cutoverPeriod}:${row.Name}`)},${q(id)},${q(row.Name)},${q(due)},${s(row['Amount (THB)'])},${q(row['Amount type'])});`);
}
for (const row of payments) {
  const obligation = obligationByName.get(row['Obligation name']);
  const occurrenceDue = row['Occurrence due date'] || dueDateFor(row.Period || row.Date, obligation);
  if (!obligation || !requireFields('Obligation Payments', row, ['Payment ID','Obligation name','Date','Expected amount','Actual amount']) || !occurrenceDue) {
    if (!obligation) rejected.push({sheet:'Obligation Payments',sourceRow:row.sourceRow,reason:'unknown obligation'});
    continue;
  }
  sql.push(`INSERT INTO obligation_payments(payment_id,household_id,obligation_name,period,payment_date,occurrence_due_date,expected_amount_satang,actual_amount_satang,paid_from,balance_adjusted,payment_status,note) VALUES(${q(row['Payment ID'])},${q(id)},${q(row['Obligation name'])},${q(row.Period)},${q(row.Date)},${q(occurrenceDue)},${s(row['Expected amount'])},${s(row['Actual amount'])},${q(row['Paid from'])},${bool(row['Balance adjusted'])},${q(row['Payment status'])},${q(row.Note)});`);
}

for (const row of goals) {
  if (!requireFields('Goals',row,['Name','Target amount','Priority rank','Status'])) continue;
  sql.push(`INSERT INTO goals(household_id,name,target_amount_satang,priority_rank,status,target_date) VALUES(${q(id)},${q(row.Name)},${s(row['Target amount'])},${n(row['Priority rank'])},${q(row.Status)},${q(row['Target date'])});`);
}
for (const row of ledger) {
  if (!requireFields('Ledger',row,['Date','Account','Direction','Amount'])) continue;
  sql.push(`INSERT INTO ledger_movements(household_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row) VALUES(${q(id)},${q(row.Date)},${n(row.sourceRow)},${q(row.Account)},${q(row.Direction)},${s(row.Amount)},'Ledger',${n(row.sourceRow)});`);
}
for (const row of weekly) {
  if (!requireFields('WeeklySnapshot',row,['Week start','Week end','Planned variables','Closing balance','Status'])) continue;
  const spent = typeof row['Spent variables'] === 'number' ? s(row['Spent variables']) : 'NULL';
  const spentStatus = typeof row['Spent variables'] === 'number' ? 'NULL' : q(row['Spent variables']);
  const opening = typeof row['Opening balance'] === 'number' ? s(row['Opening balance']) : 'NULL';
  const openingStatus = typeof row['Opening balance'] === 'number' ? 'NULL' : q(row['Opening balance']);
  sql.push(`INSERT INTO weekly_snapshots(household_id,week_start,week_end,planned_variables_satang,spent_variables_satang,spent_variables_status,difference_satang,opening_balance_satang,opening_balance_status,closing_balance_satang,status) VALUES(${q(id)},${q(row['Week start'])},${q(row['Week end'])},${s(row['Planned variables'])},${spent},${spentStatus},${s(row.Difference)},${opening},${openingStatus},${s(row['Closing balance'])},${q(row.Status)});`);
}

const duplicateGroups = [];
for (const [sheet, rows] of [['Balance Check',balance],['Obligations',obligations],['Obligation Payments',payments],['WeeklySnapshot',weekly],['Income',income],['Config',configRows],['Goals',goals],['Ledger',ledger]]) {
  const groups = new Map();
  for (const row of rows) {
    const clone = {...row}; delete clone.sourceRow;
    const key = JSON.stringify(clone,Object.keys(clone).sort());
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row.sourceRow);
  }
  for (const sourceRows of groups.values()) if (sourceRows.length > 1) duplicateGroups.push({sheet,sourceRows});
}

const report = {
  source: metadata.source,
  sourceSheetRowCounts: metadata.sheetRowCounts,
  sourceTotalRows: Object.values(metadata.sheetRowCounts).reduce((a,b)=>a+b,0),
  rejectedRows: rejected,
  exactDuplicateGroups: duplicateGroups,
  importStatements: sql.length
};

const output = process.argv[2];
if (output) fs.writeFileSync(output, sql.join('\n')+'\n');
else process.stdout.write(sql.join('\n')+'\n');
const reportPath = process.argv[3];
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report,null,2)+'\n');
