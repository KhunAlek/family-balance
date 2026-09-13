-- Durable Step 13 relationship for newly recorded EF/Goal movements only.
-- Historical Ledger and balance rows are deliberately not linked or changed.
CREATE TABLE fund_movements (
  fund_movement_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(household_id),
  fund_kind TEXT NOT NULL CHECK(fund_kind IN ('EF','Goal')),
  goal_name TEXT,
  business_date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('Contribution','Withdrawal')),
  amount_satang INTEGER NOT NULL CHECK(typeof(amount_satang)='integer' AND amount_satang>0),
  ktb_account TEXT NOT NULL CHECK(ktb_account IN ('Alex','Olga')),
  withdrawal_purpose TEXT,
  ledger_effect_id INTEGER NOT NULL UNIQUE REFERENCES ledger_movements(ledger_id),
  balance_effect_id INTEGER NOT NULL UNIQUE REFERENCES balance_history(balance_row_id),
  CHECK((fund_kind='EF' AND goal_name IS NULL) OR (fund_kind='Goal' AND length(trim(goal_name))>0)),
  CHECK(withdrawal_purpose IS NULL OR (fund_kind='Goal' AND direction='Withdrawal' AND withdrawal_purpose IN ('useForGoal','anotherReason')))
);
CREATE TRIGGER immutable_fund_movement BEFORE UPDATE ON fund_movements BEGIN SELECT RAISE(ABORT,'Recorded fund movements are immutable'); END;
CREATE TRIGGER immutable_fund_movement_delete BEFORE DELETE ON fund_movements BEGIN SELECT RAISE(ABORT,'Recorded fund movements are immutable'); END;
