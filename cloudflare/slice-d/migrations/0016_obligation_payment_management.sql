-- Durable Step 11 relationships for newly recorded obligation payments only.
-- Existing facts are deliberately not backfilled or reclassified.
CREATE TABLE obligation_payment_allocations (
  payment_id TEXT NOT NULL REFERENCES obligation_payments(payment_id),
  account TEXT NOT NULL CHECK(account IN ('Alex','Olga')),
  amount_satang INTEGER NOT NULL CHECK(typeof(amount_satang)='integer' AND amount_satang>0),
  PRIMARY KEY(payment_id,account)
);
ALTER TABLE balance_history ADD COLUMN obligation_payment_id TEXT REFERENCES obligation_payments(payment_id);
CREATE UNIQUE INDEX idx_balance_obligation_payment ON balance_history(obligation_payment_id) WHERE obligation_payment_id IS NOT NULL;
CREATE TRIGGER immutable_obligation_payment BEFORE UPDATE ON obligation_payments BEGIN SELECT RAISE(ABORT,'Recorded obligation payments are immutable'); END;
CREATE TRIGGER immutable_obligation_payment_allocation BEFORE UPDATE ON obligation_payment_allocations BEGIN SELECT RAISE(ABORT,'Recorded obligation payment allocations are immutable'); END;
CREATE TRIGGER immutable_obligation_payment_link BEFORE UPDATE OF obligation_payment_id ON balance_history WHEN OLD.obligation_payment_id IS NOT NULL AND NEW.obligation_payment_id IS NOT OLD.obligation_payment_id BEGIN SELECT RAISE(ABORT,'Obligation payment balance links are immutable'); END;
