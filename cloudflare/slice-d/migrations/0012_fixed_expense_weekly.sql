CREATE TABLE obligations_weekly (
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  expected_amount_satang INTEGER NOT NULL,
  due_type TEXT NOT NULL,
  due_day INTEGER,
  category TEXT,
  amount_type TEXT NOT NULL,
  legacy_paid_this_month INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  recurrence_type TEXT NOT NULL DEFAULT 'monthly' CHECK(recurrence_type IN('weekly','monthly','yearly')),
  due_month INTEGER CHECK(due_month IS NULL OR due_month BETWEEN 1 AND 12),
  start_date TEXT,
  due_weekday INTEGER CHECK(due_weekday IS NULL OR due_weekday BETWEEN 1 AND 7),
  PRIMARY KEY (household_id, name),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);
CREATE TABLE obligation_occurrences_weekly (
  occurrence_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  obligation_name TEXT NOT NULL,
  due_date TEXT NOT NULL,
  expected_amount_satang INTEGER NOT NULL,
  amount_type TEXT NOT NULL,
  cycle_start TEXT,
  category TEXT,
  FOREIGN KEY (household_id, obligation_name) REFERENCES obligations_weekly(household_id, name),
  UNIQUE (household_id, obligation_name, due_date)
);
CREATE TABLE obligation_payments_weekly (
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
  occurrence_id TEXT REFERENCES obligation_occurrences_weekly(occurrence_id),
  FOREIGN KEY (household_id, obligation_name) REFERENCES obligations_weekly(household_id, name)
);
INSERT INTO obligations_weekly(household_id,name,expected_amount_satang,due_type,due_day,category,amount_type,legacy_paid_this_month,active,recurrence_type,due_month,start_date,due_weekday)
SELECT household_id,name,expected_amount_satang,due_type,due_day,category,amount_type,legacy_paid_this_month,active,recurrence_type,due_month,start_date,NULL FROM obligations;
INSERT INTO obligation_occurrences_weekly(occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start,category)
SELECT occurrence_id,household_id,obligation_name,due_date,expected_amount_satang,amount_type,cycle_start,category FROM obligation_occurrences;
INSERT INTO obligation_payments_weekly(payment_id,household_id,obligation_name,period,payment_date,occurrence_due_date,expected_amount_satang,actual_amount_satang,paid_from,balance_adjusted,payment_status,note,occurrence_id)
SELECT payment_id,household_id,obligation_name,period,payment_date,occurrence_due_date,expected_amount_satang,actual_amount_satang,paid_from,balance_adjusted,payment_status,note,occurrence_id FROM obligation_payments;
DROP TABLE obligation_payments;
DROP TABLE obligation_occurrences;
DROP TABLE obligations;
ALTER TABLE obligations_weekly RENAME TO obligations;
ALTER TABLE obligation_occurrences_weekly RENAME TO obligation_occurrences;
ALTER TABLE obligation_payments_weekly RENAME TO obligation_payments;
CREATE INDEX idx_obligation_payments_occurrence ON obligation_payments(household_id,obligation_name,occurrence_due_date,payment_date);
CREATE INDEX idx_obligation_occurrence_cycle ON obligation_occurrences(household_id,cycle_start,due_date);
CREATE TRIGGER fixed_expense_management_enabled BEFORE INSERT ON obligation_occurrences WHEN NEW.cycle_start IS NULL BEGIN SELECT RAISE(ABORT,'cycle_start is required'); END;
