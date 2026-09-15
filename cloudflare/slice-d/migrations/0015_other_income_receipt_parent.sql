PRAGMA foreign_keys = ON;

-- Durable parent for one other-income receipt action. Existing receipt facts
-- are deliberately not backfilled or classified by this migration.
CREATE TABLE other_income_receipt_parents (
  other_income_receipt_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(household_id),
  other_income_source_id TEXT NOT NULL REFERENCES other_income_sources(other_income_source_id),
  business_date TEXT NOT NULL CHECK(
    length(business_date)=10
    AND business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  total_satang INTEGER NOT NULL CHECK(typeof(total_satang)='integer' AND total_satang>0),
  created_at_utc TEXT NOT NULL CHECK(length(created_at_utc)=24 AND substr(created_at_utc,24,1)='Z'),
  request_id TEXT NOT NULL CHECK(length(trim(request_id))>0),
  UNIQUE(household_id,request_id)
);

CREATE TABLE other_income_receipt_allocations (
  other_income_receipt_id TEXT NOT NULL REFERENCES other_income_receipt_parents(other_income_receipt_id),
  receipt_id TEXT NOT NULL UNIQUE REFERENCES income_receipts(receipt_id),
  account TEXT NOT NULL CHECK(account IN ('Alex','Olga')),
  amount_satang INTEGER NOT NULL CHECK(typeof(amount_satang)='integer' AND amount_satang>0),
  PRIMARY KEY(other_income_receipt_id,account)
);

CREATE TRIGGER other_income_receipt_parent_update_forbidden
BEFORE UPDATE ON other_income_receipt_parents
BEGIN SELECT RAISE(ABORT,'Other-income receipt parents are immutable'); END;
CREATE TRIGGER other_income_receipt_parent_delete_forbidden
BEFORE DELETE ON other_income_receipt_parents
BEGIN SELECT RAISE(ABORT,'Other-income receipt parents cannot be deleted'); END;
CREATE TRIGGER other_income_receipt_allocation_update_forbidden
BEFORE UPDATE ON other_income_receipt_allocations
BEGIN SELECT RAISE(ABORT,'Other-income receipt allocations are immutable'); END;
CREATE TRIGGER other_income_receipt_allocation_delete_forbidden
BEFORE DELETE ON other_income_receipt_allocations
BEGIN SELECT RAISE(ABORT,'Other-income receipt allocations cannot be deleted'); END;
