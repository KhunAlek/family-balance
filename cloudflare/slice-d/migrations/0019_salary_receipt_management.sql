-- Newly recorded salary versions only. No historical receipt is attached or changed.
CREATE TABLE salary_receipt_parents (
  salary_receipt_parent_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(household_id),
  business_date TEXT NOT NULL CHECK(date(business_date)=business_date),
  source TEXT NOT NULL CHECK(length(trim(source))>0),
  total_satang INTEGER NOT NULL CHECK(typeof(total_satang)='integer' AND total_satang>0),
  alex_receipt_id TEXT UNIQUE REFERENCES income_receipts(receipt_id),
  olga_receipt_id TEXT UNIQUE REFERENCES income_receipts(receipt_id),
  cycle_start TEXT NOT NULL CHECK(date(cycle_start)=cycle_start),
  opened_cycle INTEGER NOT NULL CHECK(opened_cycle IN (0,1)),
  preceding_cycle_start TEXT CHECK(preceding_cycle_start IS NULL OR date(preceding_cycle_start)=preceding_cycle_start),
  recorded_next_salary_date_before TEXT CHECK(recorded_next_salary_date_before IS NULL OR date(recorded_next_salary_date_before)=recorded_next_salary_date_before),
  source_evidence_revision INTEGER NOT NULL CHECK(typeof(source_evidence_revision)='integer' AND source_evidence_revision>0),
  source_evidence_recorded_at_utc TEXT NOT NULL CHECK(length(source_evidence_recorded_at_utc)=24 AND substr(source_evidence_recorded_at_utc,24,1)='Z'),
  pre_planning_json TEXT NOT NULL CHECK(json_valid(pre_planning_json)),
  post_planning_json TEXT NOT NULL CHECK(json_valid(post_planning_json)),
  CHECK(alex_receipt_id IS NOT NULL OR olga_receipt_id IS NOT NULL),
  CHECK(opened_cycle=1 OR cycle_start<=business_date)
);

CREATE TRIGGER salary_receipt_parent_validate
BEFORE INSERT ON salary_receipt_parents
WHEN
  (NEW.alex_receipt_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM income_receipts r WHERE r.receipt_id=NEW.alex_receipt_id AND r.household_id=NEW.household_id
      AND r.source=NEW.source AND r.business_date=NEW.business_date AND r.lands_in='Alex KTB'
      AND typeof(r.amount_satang)='integer' AND r.amount_satang>0 AND r.source_balance_row_id IS NOT NULL))
  OR
  (NEW.olga_receipt_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM income_receipts r WHERE r.receipt_id=NEW.olga_receipt_id AND r.household_id=NEW.household_id
      AND r.source=NEW.source AND r.business_date=NEW.business_date AND r.lands_in='Olga KTB'
      AND typeof(r.amount_satang)='integer' AND r.amount_satang>0 AND r.source_balance_row_id IS NOT NULL))
  OR NEW.total_satang <> COALESCE((SELECT amount_satang FROM income_receipts WHERE receipt_id=NEW.alex_receipt_id),0)
                         + COALESCE((SELECT amount_satang FROM income_receipts WHERE receipt_id=NEW.olga_receipt_id),0)
BEGIN SELECT RAISE(ABORT,'Salary parent does not match its receipts'); END;

CREATE TRIGGER salary_receipt_parent_immutable BEFORE UPDATE ON salary_receipt_parents
BEGIN SELECT RAISE(ABORT,'Salary receipt parents are immutable'); END;
CREATE TRIGGER salary_receipt_parent_delete_forbidden BEFORE DELETE ON salary_receipt_parents
BEGIN SELECT RAISE(ABORT,'Salary receipt parents cannot be deleted'); END;

-- The imported salary classification is the durable source evidence available
-- for salary actions recorded after this migration. The application has no
-- income-definition mutation path; this trigger makes that boundary explicit.
CREATE TRIGGER salary_income_definition_update_forbidden BEFORE UPDATE ON income_definitions
BEGIN SELECT RAISE(ABORT,'Income source classification is immutable'); END;
CREATE TRIGGER salary_income_definition_delete_forbidden BEFORE DELETE ON income_definitions
BEGIN SELECT RAISE(ABORT,'Income source classification is immutable'); END;
