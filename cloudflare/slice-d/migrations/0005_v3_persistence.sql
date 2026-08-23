PRAGMA foreign_keys = ON;

-- V3-1 is additive only. It establishes persistence and migration safety without
-- initializing the active cycle or changing v2 financial behavior.
CREATE TABLE IF NOT EXISTS cycle_plans (
  household_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  variables_target_satang INTEGER CHECK (variables_target_satang IS NULL OR variables_target_satang >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (household_id, cycle_start),
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

CREATE TABLE IF NOT EXISTS cycle_plan_events (
  event_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  old_target_satang INTEGER CHECK (old_target_satang IS NULL OR old_target_satang >= 0),
  new_target_satang INTEGER CHECK (new_target_satang IS NULL OR new_target_satang >= 0),
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
  committed_amount_satang INTEGER NOT NULL CHECK (committed_amount_satang >= 0),
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
  old_amount_satang INTEGER CHECK (old_amount_satang IS NULL OR old_amount_satang >= 0),
  new_amount_satang INTEGER CHECK (new_amount_satang IS NULL OR new_amount_satang >= 0),
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

-- Cross-table facts cannot be expressed as a CHECK constraint. This trigger
-- makes a classification valid only for the exact positive factual Goal
-- withdrawal in the same household. The monetary amount remains solely in
-- ledger_movements and is never duplicated here.
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
    AND l.amount_satang > 0
)
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal classification must reference the same-household positive factual Goal withdrawal');
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

-- AT-50 migration safety. Any pre-existing Goal withdrawal without an
-- authoritative classification is a hard migration-data exception. Never infer
-- purpose and never rewrite the factual Ledger row.
CREATE TABLE IF NOT EXISTS _v3_goal_withdrawal_preflight_guard (
  guard INTEGER PRIMARY KEY
);

CREATE TRIGGER IF NOT EXISTS _v3_goal_withdrawal_preflight_abort
BEFORE INSERT ON _v3_goal_withdrawal_preflight_guard
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM ledger_movements l
  JOIN goals g
    ON g.household_id = l.household_id
   AND g.name = l.account
  LEFT JOIN goal_withdrawal_classifications c
    ON c.ledger_id = l.ledger_id
  WHERE l.direction = 'Withdrawal'
    AND c.ledger_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'V3_MIGRATION_DATA_EXCEPTION_UNCLASSIFIED_GOAL_WITHDRAWAL');
END;

INSERT OR REPLACE INTO _v3_goal_withdrawal_preflight_guard(guard) VALUES(1);
DROP TRIGGER IF EXISTS _v3_goal_withdrawal_preflight_abort;
DROP TABLE IF EXISTS _v3_goal_withdrawal_preflight_guard;
