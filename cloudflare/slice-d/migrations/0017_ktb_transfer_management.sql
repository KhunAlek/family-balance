-- Durable Step 12 relationship for newly recorded KTB-to-KTB transfers only.
-- Existing balance rows are deliberately not backfilled or reclassified.
CREATE TABLE ktb_transfers (
  transfer_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(household_id),
  business_date TEXT NOT NULL,
  amount_satang INTEGER NOT NULL CHECK(typeof(amount_satang)='integer' AND amount_satang>0),
  source_account TEXT NOT NULL CHECK(source_account IN ('Alex','Olga')),
  destination_account TEXT NOT NULL CHECK(destination_account IN ('Alex','Olga')),
  balance_effect_id INTEGER NOT NULL UNIQUE REFERENCES balance_history(balance_row_id),
  CHECK(source_account<>destination_account)
);
CREATE TRIGGER immutable_ktb_transfer BEFORE UPDATE ON ktb_transfers BEGIN SELECT RAISE(ABORT,'Recorded KTB transfers are immutable'); END;
CREATE TRIGGER immutable_ktb_transfer_delete BEFORE DELETE ON ktb_transfers BEGIN SELECT RAISE(ABORT,'Recorded KTB transfers are immutable'); END;
