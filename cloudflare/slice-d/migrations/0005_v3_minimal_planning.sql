-- Family Cash Flow v3 MINIMAL current-cycle planning state.
-- Additive only: no historical accounting rows are rewritten.

ALTER TABLE salary_cycle_state ADD COLUMN variables_target_satang INTEGER NULL;
ALTER TABLE salary_cycle_state ADD COLUMN ef_cycle_commitment_satang INTEGER NOT NULL DEFAULT 1500000;
ALTER TABLE goals ADD COLUMN cycle_commitment_satang INTEGER NOT NULL DEFAULT 0;

-- Mid-cycle cutover: Variables target is deliberately unset. The EF commitment
-- inherits the existing configured monthly claim cap, with 15,000 THB fallback.
UPDATE salary_cycle_state
SET variables_target_satang = NULL,
    ef_cycle_commitment_satang = COALESCE(
      (
        SELECT value_satang
        FROM configuration
        WHERE configuration.household_id = salary_cycle_state.household_id
          AND configuration.config_key = 'ef_monthly_claim_cap'
      ),
      1500000
    );

-- v3 Goal commitments are opt-in current-cycle decisions. Existing lifetime
-- targets and Ledger history remain untouched.
UPDATE goals SET cycle_commitment_satang = 0;
