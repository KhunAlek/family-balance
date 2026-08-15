PRAGMA foreign_keys = ON;

CREATE TABLE households (
  household_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL
);

CREATE TABLE configuration (
  household_id TEXT NOT NULL,
  config_key TEXT NOT NULL,
  value_text TEXT,
  value_integer INTEGER,
  value_satang INTEGER,
  PRIMARY KEY (household_id, config_key),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE balance_history (
  balance_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  sheet_order INTEGER NOT NULL,
  alex_balance_satang INTEGER,
  olga_balance_satang INTEGER,
  one_off_payment_name TEXT,
  one_off_payment_amount_satang INTEGER,
  one_off_payment_account TEXT,
  income_receipt_source TEXT,
  income_receipt_amount_satang INTEGER,
  source_sheet TEXT NOT NULL DEFAULT 'Balance Check',
  source_row INTEGER,
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  UNIQUE (household_id, source_sheet, source_row)
);
CREATE INDEX idx_balance_history_date ON balance_history(household_id, business_date, sheet_order);

CREATE TABLE income_definitions (
  household_id TEXT NOT NULL,
  source TEXT NOT NULL,
  expected_amount_satang INTEGER NOT NULL,
  pay_day TEXT NOT NULL,
  lands_in TEXT NOT NULL,
  PRIMARY KEY (household_id, source),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE income_receipts (
  receipt_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  source TEXT NOT NULL,
  business_date TEXT NOT NULL,
  amount_satang INTEGER NOT NULL,
  lands_in TEXT,
  source_balance_row_id INTEGER,
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  FOREIGN KEY (source_balance_row_id) REFERENCES balance_history(balance_row_id)
);

CREATE TABLE salary_cycle_state (
  household_id TEXT PRIMARY KEY,
  current_cycle_start TEXT,
  next_salary_date TEXT,
  salary_receipt_cutover_date TEXT,
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE obligations (
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  expected_amount_satang INTEGER NOT NULL,
  due_type TEXT NOT NULL,
  due_day INTEGER,
  category TEXT,
  amount_type TEXT NOT NULL,
  legacy_paid_this_month INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, name),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE obligation_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  obligation_name TEXT NOT NULL,
  due_date TEXT NOT NULL,
  expected_amount_satang INTEGER NOT NULL,
  amount_type TEXT NOT NULL,
  FOREIGN KEY (household_id, obligation_name) REFERENCES obligations(household_id, name),
  UNIQUE (household_id, obligation_name, due_date)
);

CREATE TABLE obligation_payments (
  payment_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  obligation_name TEXT NOT NULL,
  period TEXT,
  payment_date TEXT NOT NULL,
  occurrence_due_date TEXT,
  expected_amount_satang INTEGER NOT NULL,
  actual_amount_satang INTEGER NOT NULL,
  paid_from TEXT,
  balance_adjusted INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT,
  note TEXT,
  FOREIGN KEY (household_id, obligation_name) REFERENCES obligations(household_id, name)
);
CREATE INDEX idx_obligation_payments_occurrence ON obligation_payments(household_id, obligation_name, occurrence_due_date, payment_date);

CREATE TABLE goals (
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_amount_satang INTEGER NOT NULL,
  priority_rank INTEGER NOT NULL,
  status TEXT NOT NULL,
  target_date TEXT,
  PRIMARY KEY (household_id, name),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE ledger_movements (
  ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  sheet_order INTEGER NOT NULL,
  account TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_satang INTEGER NOT NULL,
  source_sheet TEXT NOT NULL DEFAULT 'Ledger',
  source_row INTEGER,
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  UNIQUE (household_id, source_sheet, source_row)
);
CREATE INDEX idx_ledger_account_date ON ledger_movements(household_id, account, business_date, sheet_order);

CREATE TABLE weekly_snapshots (
  household_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  planned_variables_satang INTEGER,
  spent_variables_satang INTEGER,
  spent_variables_status TEXT,
  difference_satang INTEGER,
  opening_balance_satang INTEGER,
  opening_balance_status TEXT,
  closing_balance_satang INTEGER,
  status TEXT,
  PRIMARY KEY (household_id, week_start),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

-- Reserved now so Slice C can use the approved hard uniqueness claim without a schema redesign.
CREATE TABLE financial_write_claims (
  household_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  write_token TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (household_id, base_revision),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE correction_audit (
  correction_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  corrected_at TEXT NOT NULL,
  base_revision INTEGER,
  write_token TEXT,
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);
