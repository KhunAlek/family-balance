import fs from 'node:fs';

const sourceUrl = name => new URL(`../source/${name}`, import.meta.url);
const read = name => JSON.parse(fs.readFileSync(sourceUrl(name), 'utf8'));
const toSatang = value => value === null || value === undefined || value === '' ? null : Math.round((Number(value) + Number.EPSILON) * 100);

export function loadLockedSourceSnapshot() {
  const metadata = read('metadata.json');
  const configRow = read('config.json')[0];
  const obligationsSource = read('obligations.json');
  const paymentsSource = read('obligation-payments.json');
  const incomeSource = read('income.json');
  const goalsSource = read('goals.json');
  const ledgerSource = read('ledger.json');
  const weeklySource = read('weekly-snapshot.json');
  const balanceSource = Array.from({ length: 7 }, (_, index) => read(`balance-check-${String(index + 1).padStart(2, '0')}.json`))
    .flat()
    .sort((a, b) => a.sourceRow - b.sourceRow);

  const obligations = obligationsSource.map(row => ({
    name: row.Name,
    expected_amount_satang: toSatang(row['Amount (THB)']),
    due_type: row['Due type'],
    due_day: row['Due day'],
    category: row.Category,
    amount_type: row['Amount type'],
    legacy_paid_this_month: row['Paid this month'] === 'Y' ? 1 : 0
  }));
  const obligationByName = new Map(obligations.map(item => [item.name, item]));
  const obligationPayments = paymentsSource.map(row => {
    const obligation = obligationByName.get(row['Obligation name']);
    const month = String(row.Period || row.Date).slice(0, 7);
    const occurrenceDueDate = row['Occurrence due date'] || (obligation?.due_day ? `${month}-${String(obligation.due_day).padStart(2, '0')}` : null);
    return {
      payment_id: row['Payment ID'],
      obligation_name: row['Obligation name'],
      period: row.Period,
      payment_date: row.Date,
      occurrence_due_date: occurrenceDueDate,
      expected_amount_satang: toSatang(row['Expected amount']),
      actual_amount_satang: toSatang(row['Actual amount']),
      paid_from: row['Paid from'],
      balance_adjusted: row['Balance adjusted'] ? 1 : 0,
      payment_status: row['Payment status'],
      note: row.Note
    };
  });

  const balanceHistory = balanceSource.map(row => ({
    business_date: row.Date,
    sheet_order: row.sourceRow,
    alex_balance_satang: toSatang(row['Alex KTB balance']),
    olga_balance_satang: toSatang(row['Olga KTB balance']),
    one_off_payment_name: row['One-off payment name'],
    one_off_payment_amount_satang: toSatang(row['One-off payment amount']),
    one_off_payment_account: row['One-off payment account'],
    income_receipt_source: row['Income receipt source'],
    income_receipt_amount_satang: toSatang(row['Income receipt amount']),
    source_row: row.sourceRow
  }));

  const incomeDefinitions = incomeSource.map(row => ({
    source: row.Source,
    expected_amount_satang: toSatang(row['Expected amount']),
    pay_day: row['Pay day'],
    lands_in: row['Lands in']
  }));
  const incomeBySource = new Map(incomeDefinitions.map(item => [item.source, item]));
  const incomeReceipts = balanceSource
    .filter(row => row['Income receipt source'])
    .map(row => ({
      source: row['Income receipt source'],
      business_date: row.Date,
      amount_satang: toSatang(row['Income receipt amount']),
      lands_in: incomeBySource.get(row['Income receipt source'])?.lands_in || null
    }));

  const goals = goalsSource.map(row => ({
    name: row.Name,
    target_amount_satang: toSatang(row['Target amount']),
    priority_rank: Number(row['Priority rank']),
    status: row.Status,
    target_date: row['Target date']
  }));
  const ledger = ledgerSource.map(row => ({
    business_date: row.Date,
    sheet_order: row.sourceRow,
    account: row.Account,
    direction: row.Direction,
    amount_satang: toSatang(row.Amount),
    source_row: row.sourceRow
  }));
  const weeklySnapshots = weeklySource.map(row => ({
    week_start: row['Week start'],
    week_end: row['Week end'],
    planned_variables_satang: typeof row['Planned variables'] === 'number' ? toSatang(row['Planned variables']) : null,
    spent_variables_satang: typeof row['Spent variables'] === 'number' ? toSatang(row['Spent variables']) : null,
    spent_variables_status: typeof row['Spent variables'] === 'number' ? null : row['Spent variables'],
    difference_satang: typeof row.Difference === 'number' ? toSatang(row.Difference) : null,
    opening_balance_satang: typeof row['Opening balance'] === 'number' ? toSatang(row['Opening balance']) : null,
    opening_balance_status: typeof row['Opening balance'] === 'number' ? null : row['Opening balance'],
    closing_balance_satang: typeof row['Closing balance'] === 'number' ? toSatang(row['Closing balance']) : null,
    status: row.Status
  }));

  const currentCycleStart = configRow['Current salary cycle start'];
  const salaryCycleSources = incomeDefinitions
    .filter(item => String(item.pay_day || '').trim() !== 'Variable')
    .map(item => ({ cycle_start: currentCycleStart, source: item.source }));

  return {
    householdId: 'family',
    config: {
      emergency_fund_target_satang: toSatang(configRow['Emergency fund target']),
      currency: configRow.Currency,
      planning_variables_min_satang: toSatang(configRow["Olga's monthly variable budget target"]),
      ef_monthly_claim_cap_satang: toSatang(configRow['EF monthly claim cap']),
      notification_emails: configRow['Notification emails'],
      salary_receipt_cutover_date: configRow['Salary receipt cutover date'],
      obligation_payments_cutover_period: metadata.scriptProperties.OBLIGATION_PAYMENTS_CUTOVER_PERIOD,
      source_snapshot_file: metadata.source.file,
      source_snapshot_sha256: metadata.source.sha256,
      source_snapshot_extracted_at: metadata.source.extractedAt
    },
    salaryCycle: {
      current_cycle_start: currentCycleStart,
      next_salary_date: configRow['Next salary date'],
      salary_receipt_cutover_date: configRow['Salary receipt cutover date']
    },
    salaryCycleSources,
    balanceHistory,
    incomeDefinitions,
    incomeReceipts,
    obligations,
    obligationPayments,
    goals,
    ledger,
    weeklySnapshots
  };
}
