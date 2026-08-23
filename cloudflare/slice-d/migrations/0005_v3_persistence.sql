PRAGMA foreign_keys = ON;

-- V3-1 is additive only. It establishes persistence and migration safety without
-- initializing the active cycle or changing v2 financial behavior.
CREATE TABLE IF NOT EXISTS cycle_plans (
  household_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  variables_target_satang INTEGER CHECK (
    variables_target_satang IS NULL OR
    (typeof(variables_target_satang) = 'integer' AND variables_target_satang >= 0)
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (household_id, cycle_start),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE IF NOT EXISTS cycle_plan_events (
  event_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  old_target_satang INTEGER CHECK (
    old_target_satang IS NULL OR
    (typeof(old_target_satang) = 'integer' AND old_target_satang >= 0)
  ),
  new_target_satang INTEGER CHECK (
    new_target_satang IS NULL OR
    (typeof(new_target_satang) = 'integer' AND new_target_satang >= 0)
  ),
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  write_token TEXT NOT NULL,
  FOREIGN KEY (household_id, cycle_start) REFERENCES cycle_plans(household_id, cycle_start)
);

CREATE TRIGGER IF NOT EXISTS cycle_plan_events_append_only_update
BEFORE UPDATE ON cycle_plan_events
BEGIN
  SELECT RAISE(ABORT, 'cycle_plan_events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS cycle_plan_events_append_only_delete
BEFORE DELETE ON cycle_plan_events
BEGIN
  SELECT RAISE(ABORT, 'cycle_plan_events are append-only');
END;

CREATE TABLE IF NOT EXISTS cycle_commitments (
  commitment_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  commitment_type TEXT NOT NULL CHECK (commitment_type IN ('ef_cycle','goal_cycle')),
  destination_name TEXT,
  committed_amount_satang INTEGER NOT NULL CHECK (
    typeof(committed_amount_satang) = 'integer' AND committed_amount_satang >= 0
  ),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('active','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (commitment_type='ef_cycle' AND destination_name IS NULL) OR
    (commitment_type='goal_cycle' AND destination_name IS NOT NULL AND LENGTH(TRIM(destination_name)) > 0)
  ),
  FOREIGN KEY (household_id, cycle_start) REFERENCES cycle_plans(household_id, cycle_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cycle_commitment_identity
ON cycle_commitments(household_id, cycle_start, commitment_type, COALESCE(destination_name,''));

CREATE UNIQUE INDEX IF NOT EXISTS uq_cycle_commitment_household_id
ON cycle_commitments(household_id, commitment_id);

CREATE TABLE IF NOT EXISTS commitment_events (
  event_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  commitment_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('create','edit','zero','close')),
  old_amount_satang INTEGER CHECK (
    old_amount_satang IS NULL OR
    (typeof(old_amount_satang) = 'integer' AND old_amount_satang >= 0)
  ),
  new_amount_satang INTEGER CHECK (
    new_amount_satang IS NULL OR
    (typeof(new_amount_satang) = 'integer' AND new_amount_satang >= 0)
  ),
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  write_token TEXT NOT NULL,
  FOREIGN KEY (household_id, commitment_id) REFERENCES cycle_commitments(household_id, commitment_id)
);

CREATE TRIGGER IF NOT EXISTS commitment_events_append_only_update
BEFORE UPDATE ON commitment_events
BEGIN
  SELECT RAISE(ABORT, 'commitment_events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS commitment_events_append_only_delete
BEFORE DELETE ON commitment_events
BEGIN
  SELECT RAISE(ABORT, 'commitment_events are append-only');
END;

CREATE TABLE IF NOT EXISTS goal_withdrawal_classifications (
  ledger_id INTEGER PRIMARY KEY,
  household_id TEXT NOT NULL,
  goal_name TEXT NOT NULL,
  use_classification TEXT NOT NULL CHECK (use_classification IN ('goal_purpose','non_purpose')),
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  write_token TEXT NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledger_movements(ledger_id),
  FOREIGN KEY (household_id, goal_name) REFERENCES goals(household_id, name),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_withdrawal_classification_ledger
ON goal_withdrawal_classifications(ledger_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_withdrawal_classification_household_ledger
ON goal_withdrawal_classifications(household_id, ledger_id);

-- Classification is immutable semantic audit data. Cross-table validation is
-- intentionally strict about the factual amount storage class, not only value.
CREATE TRIGGER IF NOT EXISTS goal_withdrawal_classification_validate_insert
BEFORE INSERT ON goal_withdrawal_classifications
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM ledger_movements l
  WHERE l.ledger_id = NEW.ledger_id
    AND l.household_id = NEW.household_id
    AND l.account = NEW.goal_name
    AND l.direction = 'Withdrawal'
    AND typeof(l.amount_satang) = 'integer'
    AND l.amount_satang > 0
)
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal classification must reference the same-household positive factual Goal withdrawal with positive integer-satang amount');
END;

CREATE TRIGGER IF NOT EXISTS goal_withdrawal_classification_append_only_update
BEFORE UPDATE ON goal_withdrawal_classifications
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal classifications are immutable');
END;

CREATE TRIGGER IF NOT EXISTS goal_withdrawal_classification_append_only_delete
BEFORE DELETE ON goal_withdrawal_classifications
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal classifications are immutable');
END;

-- A classified factual withdrawal can be superseded exactly once by additive
-- correction metadata. A non-NULL authoritative ledger id is the factual
-- replacement; NULL is a complete reversal. Goal-withdrawal replacements must
-- already carry their own compatible immutable classification in the same
-- transaction before this event is inserted.
CREATE TABLE IF NOT EXISTS goal_withdrawal_effect_events (
  effect_event_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  superseded_ledger_id INTEGER NOT NULL,
  authoritative_ledger_id INTEGER,
  correction_id TEXT NOT NULL,
  effect_kind TEXT NOT NULL CHECK (
    (effect_kind = 'replacement' AND authoritative_ledger_id IS NOT NULL) OR
    (effect_kind = 'reversal' AND authoritative_ledger_id IS NULL)
  ),
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  write_token TEXT NOT NULL,
  CHECK (authoritative_ledger_id IS NULL OR authoritative_ledger_id <> superseded_ledger_id),
  FOREIGN KEY (household_id, superseded_ledger_id)
    REFERENCES goal_withdrawal_classifications(household_id, ledger_id),
  FOREIGN KEY (authoritative_ledger_id) REFERENCES ledger_movements(ledger_id),
  FOREIGN KEY (correction_id) REFERENCES correction_audit(correction_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_withdrawal_effect_superseded
ON goal_withdrawal_effect_events(household_id, superseded_ledger_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_withdrawal_effect_authoritative
ON goal_withdrawal_effect_events(household_id, authoritative_ledger_id)
WHERE authoritative_ledger_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_withdrawal_effect_correction
ON goal_withdrawal_effect_events(household_id, correction_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_withdrawal_effect_write_token
ON goal_withdrawal_effect_events(household_id, write_token);

CREATE TRIGGER IF NOT EXISTS goal_withdrawal_effect_validate_insert
BEFORE INSERT ON goal_withdrawal_effect_events
FOR EACH ROW
WHEN
  NOT EXISTS (
    SELECT 1
    FROM goal_withdrawal_classifications c
    JOIN ledger_movements l ON l.ledger_id = c.ledger_id
    WHERE c.household_id = NEW.household_id
      AND c.ledger_id = NEW.superseded_ledger_id
      AND l.household_id = c.household_id
      AND l.account = c.goal_name
      AND l.direction = 'Withdrawal'
      AND typeof(l.amount_satang) = 'integer'
      AND l.amount_satang > 0
  )
  OR (
    NEW.authoritative_ledger_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ledger_movements l
      WHERE l.ledger_id = NEW.authoritative_ledger_id
        AND l.household_id = NEW.household_id
    )
  )
  OR (
    NEW.authoritative_ledger_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM ledger_movements l
      WHERE l.ledger_id = NEW.authoritative_ledger_id
        AND l.household_id = NEW.household_id
        AND l.direction = 'Withdrawal'
        AND (
          EXISTS (
            SELECT 1 FROM goals g
            WHERE g.household_id = l.household_id AND g.name = l.account
          )
          OR (l.source_sheet = 'Ledger' AND l.account <> 'EF' AND LENGTH(TRIM(l.account)) > 0)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM goal_withdrawal_classifications c
      JOIN ledger_movements l ON l.ledger_id = c.ledger_id
      WHERE c.ledger_id = NEW.authoritative_ledger_id
        AND c.household_id = NEW.household_id
        AND c.goal_name = l.account
        AND l.direction = 'Withdrawal'
        AND typeof(l.amount_satang) = 'integer'
        AND l.amount_satang > 0
    )
  )
  OR (
    EXISTS (
      SELECT 1 FROM correction_audit a
      WHERE a.correction_id = NEW.correction_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM correction_audit a
      WHERE a.correction_id = NEW.correction_id
        AND a.household_id = NEW.household_id
        AND a.entity_type IN ('ledger_movement','ledgerMovement')
        AND CAST(a.entity_id AS INTEGER) = NEW.superseded_ledger_id
        AND a.write_token = NEW.write_token
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal effect must preserve a valid authoritative factual effect, compatible replacement classification, and matching Ledger correction audit');
END;

CREATE TRIGGER IF NOT EXISTS goal_withdrawal_effect_append_only_update
BEFORE UPDATE ON goal_withdrawal_effect_events
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal effect events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS goal_withdrawal_effect_append_only_delete
BEFORE DELETE ON goal_withdrawal_effect_events
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal effect events are append-only');
END;

-- Protected Ledger semantics cannot be changed under classification/effect
-- metadata. Legal correction remains additive and is represented by new Ledger
-- rows plus one effect event and one correction-audit fact.
CREATE TRIGGER IF NOT EXISTS classified_goal_withdrawal_ledger_protect_update
BEFORE UPDATE OF household_id,account,direction,amount_satang ON ledger_movements
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM goal_withdrawal_classifications c WHERE c.ledger_id = OLD.ledger_id)
  OR EXISTS (
    SELECT 1 FROM goal_withdrawal_effect_events e
    WHERE e.superseded_ledger_id = OLD.ledger_id OR e.authoritative_ledger_id = OLD.ledger_id
  )
BEGIN
  SELECT RAISE(ABORT, 'classified Goal withdrawal factual semantics are immutable; use additive correction');
END;

CREATE TRIGGER IF NOT EXISTS classified_goal_withdrawal_ledger_protect_delete
BEFORE DELETE ON ledger_movements
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM goal_withdrawal_classifications c WHERE c.ledger_id = OLD.ledger_id)
  OR EXISTS (
    SELECT 1 FROM goal_withdrawal_effect_events e
    WHERE e.superseded_ledger_id = OLD.ledger_id OR e.authoritative_ledger_id = OLD.ledger_id
  )
BEGIN
  SELECT RAISE(ABORT, 'classified Goal withdrawal factual semantics are immutable; use additive correction');
END;

-- Existing generic correction is allowed for ordinary Ledger rows. Once a
-- classified Goal withdrawal exists, a correction-audit row is accepted only
-- when the same logical transaction has already recorded its additive effect.
CREATE TRIGGER IF NOT EXISTS classified_goal_withdrawal_correction_effect_required
BEFORE INSERT ON correction_audit
FOR EACH ROW
WHEN NEW.entity_type IN ('ledger_movement','ledgerMovement')
  AND EXISTS (
    SELECT 1 FROM goal_withdrawal_classifications c
    WHERE c.ledger_id = CAST(NEW.entity_id AS INTEGER)
      AND c.household_id = NEW.household_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM goal_withdrawal_effect_events e
    WHERE e.household_id = NEW.household_id
      AND e.superseded_ledger_id = CAST(NEW.entity_id AS INTEGER)
      AND e.correction_id = NEW.correction_id
      AND e.write_token = NEW.write_token
  )
BEGIN
  SELECT RAISE(ABORT, 'classified Goal withdrawal correction requires additive authoritative-effect metadata');
END;

-- Reciprocal binding closes the deferred-FK ordering gap: when an effect row is
-- inserted first, the audit that later satisfies correction_id must describe
-- exactly that same classified Ledger correction under the same write claim.
CREATE TRIGGER IF NOT EXISTS goal_withdrawal_effect_correction_audit_validate_insert
BEFORE INSERT ON correction_audit
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM goal_withdrawal_effect_events e
  WHERE e.correction_id = NEW.correction_id
)
  AND NOT EXISTS (
    SELECT 1 FROM goal_withdrawal_effect_events e
    WHERE e.correction_id = NEW.correction_id
      AND e.household_id = NEW.household_id
      AND NEW.entity_type IN ('ledger_movement','ledgerMovement')
      AND e.superseded_ledger_id = CAST(NEW.entity_id AS INTEGER)
      AND e.write_token = NEW.write_token
  )
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal effect correction audit must match household, Ledger entity, correction id, and write token');
END;

-- Legacy weekly rows remain untouched. A future v3 weekly writer will create a
-- companion version row atomically with each v3 weekly snapshot. Untagged rows
-- are therefore legacy rows; tagged rows are unambiguously v3.
CREATE TABLE IF NOT EXISTS weekly_snapshot_model_versions (
  household_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  planning_model_version TEXT NOT NULL CHECK (planning_model_version = 'v3'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, week_start),
  FOREIGN KEY (household_id, week_start) REFERENCES weekly_snapshots(household_id, week_start)
);

-- AT-50 migration safety. Legacy imported Ledger rows have a factual account
-- identity: EF or a Goal account. Current Goal matches are included regardless
-- of source; imported non-EF withdrawals remain in the historical Goal-account
-- domain even if the current Goal row was later removed or no longer matches.
-- Purpose is never inferred: every qualifying unclassified row aborts migration.
CREATE TABLE IF NOT EXISTS _v3_goal_withdrawal_preflight_guard (
  guard INTEGER PRIMARY KEY
);

CREATE TRIGGER IF NOT EXISTS _v3_goal_withdrawal_preflight_abort
BEFORE INSERT ON _v3_goal_withdrawal_preflight_guard
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM ledger_movements l
  LEFT JOIN goal_withdrawal_classifications c
    ON c.ledger_id = l.ledger_id
  WHERE l.direction = 'Withdrawal'
    AND c.ledger_id IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM goals g
        WHERE g.household_id = l.household_id AND g.name = l.account
      )
      OR (l.source_sheet = 'Ledger' AND l.account <> 'EF' AND LENGTH(TRIM(l.account)) > 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'V3_MIGRATION_DATA_EXCEPTION_UNCLASSIFIED_GOAL_WITHDRAWAL');
END;

INSERT OR REPLACE INTO _v3_goal_withdrawal_preflight_guard(guard) VALUES(1);
DROP TRIGGER IF EXISTS _v3_goal_withdrawal_preflight_abort;
DROP TABLE IF EXISTS _v3_goal_withdrawal_preflight_guard;
