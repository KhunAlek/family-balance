export async function loadFinancialSnapshot(db, householdId = 'family') {
  if (!db || typeof db.prepare !== 'function') throw new Error('D1 binding is unavailable.');
  const statements = [
    db.prepare('SELECT config_key,value_text,value_integer,value_satang FROM configuration WHERE household_id=? ORDER BY config_key').bind(householdId),
    db.prepare('SELECT current_cycle_start,next_salary_date,salary_receipt_cutover_date FROM salary_cycle_state WHERE household_id=?').bind(householdId),
    db.prepare('SELECT balance_row_id,business_date,sheet_order,alex_balance_satang,olga_balance_satang,one_off_payment_name,one_off_payment_amount_satang,one_off_payment_account,income_receipt_source,income_receipt_amount_satang,source_sheet,source_row FROM balance_history WHERE household_id=? ORDER BY business_date,sheet_order').bind(householdId),
    db.prepare('SELECT source,expected_amount_satang,pay_day,lands_in FROM income_definitions WHERE household_id=? ORDER BY source').bind(householdId),
    db.prepare('SELECT receipt_id,source,business_date,amount_satang,lands_in,source_balance_row_id FROM income_receipts WHERE household_id=? ORDER BY business_date,receipt_id').bind(householdId),
    db.prepare('SELECT name,expected_amount_satang,due_type,due_day,category,amount_type,legacy_paid_this_month FROM obligations WHERE household_id=? ORDER BY name').bind(householdId),
    db.prepare('SELECT payment_id,obligation_name,period,payment_date,occurrence_due_date,expected_amount_satang,actual_amount_satang,paid_from,balance_adjusted,payment_status,note FROM obligation_payments WHERE household_id=? ORDER BY payment_date,payment_id').bind(householdId),
    db.prepare('SELECT name,target_amount_satang,priority_rank,status,target_date FROM goals WHERE household_id=? ORDER BY priority_rank,name').bind(householdId),
    db.prepare('SELECT ledger_id,business_date,sheet_order,account,direction,amount_satang,source_sheet,source_row FROM ledger_movements WHERE household_id=? ORDER BY business_date,sheet_order').bind(householdId),
    db.prepare('SELECT week_start,week_end,planned_variables_satang,spent_variables_satang,spent_variables_status,difference_satang,opening_balance_satang,opening_balance_status,closing_balance_satang,status FROM weekly_snapshots WHERE household_id=? ORDER BY week_start').bind(householdId)
  ];
  const results = await db.batch(statements);
  const rows = index => results[index]?.results || [];
  const config = {};
  for (const item of rows(0)) {
    if (item.value_satang !== null && item.value_satang !== undefined) config[`${item.config_key}_satang`] = Number(item.value_satang);
    if (item.value_integer !== null && item.value_integer !== undefined) config[item.config_key] = Number(item.value_integer);
    if (item.value_text !== null && item.value_text !== undefined) config[item.config_key] = item.value_text;
  }
  const salaryCycle = rows(1)[0] || {};
  return {
    householdId,
    config,
    salaryCycle,
    balanceHistory: rows(2),
    incomeDefinitions: rows(3),
    incomeReceipts: rows(4),
    obligations: rows(5),
    obligationPayments: rows(6),
    goals: rows(7),
    ledger: rows(8),
    weeklySnapshots: rows(9)
  };
}
