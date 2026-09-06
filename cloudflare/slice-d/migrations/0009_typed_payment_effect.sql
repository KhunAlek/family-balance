-- Link only new balance effects. Existing balance rows remain unchanged.
ALTER TABLE balance_history ADD COLUMN one_off_payment_id TEXT REFERENCES one_off_payments(one_off_payment_id);
CREATE UNIQUE INDEX idx_balance_one_off_payment ON balance_history(one_off_payment_id) WHERE one_off_payment_id IS NOT NULL;
CREATE TRIGGER immutable_one_off_payment BEFORE UPDATE ON one_off_payments BEGIN SELECT RAISE(ABORT,'Recorded one-off payments are immutable'); END;
CREATE TRIGGER immutable_one_off_allocation BEFORE UPDATE ON one_off_payment_allocations BEGIN SELECT RAISE(ABORT,'Recorded one-off allocations are immutable'); END;
CREATE TRIGGER immutable_balance_payment_link BEFORE UPDATE OF one_off_payment_id ON balance_history WHEN OLD.one_off_payment_id IS NOT NULL AND NEW.one_off_payment_id IS NOT OLD.one_off_payment_id BEGIN SELECT RAISE(ABORT,'Payment balance links are immutable'); END;
