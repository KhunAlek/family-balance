const thb = value => value === null || value === undefined ? null : Number(value) / 100;
const recent = (rows, limit = 20) => [...(rows || [])].slice(-limit).reverse();

export function buildCorrectionCatalog(snapshot) {
  return {
    ok: true,
    entityTypes: [
      { value: 'balance', label: 'Balance / recorded movement' },
      { value: 'obligationPayment', label: 'Obligation payment' },
      { value: 'ledgerMovement', label: 'EF / Goal ledger movement' },
      { value: 'goal', label: 'Savings goal' },
      { value: 'salaryCycle', label: 'Salary cycle' }
    ],
    records: {
      balance: recent(snapshot.balanceHistory, 30).map(row => ({
        entityId: String(row.balance_row_id),
        label: `${row.business_date} · Alex ${thb(row.alex_balance_satang)} · Olga ${thb(row.olga_balance_satang)}${row.one_off_payment_name ? ` · ${row.one_off_payment_name}` : row.income_receipt_source ? ` · ${row.income_receipt_source}` : ''}`,
        date: row.business_date,
        source: row.source_sheet || 'Balance Check'
      })),
      obligationPayment: recent(snapshot.obligationPayments, 30).map(row => ({
        entityId: String(row.payment_id),
        label: `${row.payment_date} · ${row.obligation_name} · ${thb(row.actual_amount_satang)} THB`,
        date: row.payment_date,
        source: 'Obligation Payments'
      })),
      ledgerMovement: recent(snapshot.ledger, 30).map(row => ({
        entityId: String(row.ledger_id),
        label: `${row.business_date} · ${row.account} · ${row.direction} ${thb(row.amount_satang)} THB`,
        date: row.business_date,
        source: row.source_sheet || 'Ledger'
      })),
      goal: (snapshot.goals || []).map(row => ({
        entityId: String(row.name),
        label: `${row.name} · target ${thb(row.target_amount_satang)} THB · rank ${row.priority_rank} · ${row.status}`,
        source: 'Goals'
      })),
      salaryCycle: [{
        entityId: 'family',
        label: `${snapshot.salaryCycle?.current_cycle_start || 'Not set'} → ${snapshot.salaryCycle?.next_salary_date || 'Next salary not set'}`,
        source: 'Salary cycle'
      }]
    }
  };
}
