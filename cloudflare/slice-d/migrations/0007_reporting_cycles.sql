-- Factual reporting boundaries and typed payment storage.
-- Development continuation of 0006; historical Accounting is untouched.
CREATE TABLE reporting_salary_cycles (
  household_id TEXT NOT NULL REFERENCES households(household_id),
  cycle_start TEXT NOT NULL,
  PRIMARY KEY(household_id,cycle_start)
);
INSERT INTO reporting_salary_cycles(household_id,cycle_start)
SELECT household_id,current_cycle_start FROM salary_cycle_state WHERE current_cycle_start IS NOT NULL;

CREATE TABLE one_off_payments (
  one_off_payment_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(household_id),
  business_date TEXT NOT NULL,
  category_id TEXT REFERENCES one_off_categories(category_id),
  description TEXT,
  amount_satang INTEGER NOT NULL CHECK(typeof(amount_satang)='integer' AND amount_satang>0),
  paid_from_account TEXT CHECK(paid_from_account IN ('Alex','Olga')),
  created_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  legacy_origin TEXT,
  UNIQUE(household_id,request_id),
  CHECK(legacy_origin IS NOT NULL OR paid_from_account IS NOT NULL),
  CHECK(category_id IS NOT NULL OR length(trim(description))>0)
);
CREATE INDEX idx_one_off_payments_date ON one_off_payments(household_id,business_date,one_off_payment_id);
CREATE TABLE one_off_payment_allocations (
  one_off_payment_id TEXT NOT NULL REFERENCES one_off_payments(one_off_payment_id),
  account TEXT NOT NULL CHECK(account IN ('Alex','Olga')),
  amount_satang INTEGER NOT NULL CHECK(typeof(amount_satang)='integer' AND amount_satang>0),
  PRIMARY KEY(one_off_payment_id,account)
);
