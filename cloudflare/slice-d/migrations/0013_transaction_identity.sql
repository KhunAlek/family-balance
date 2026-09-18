PRAGMA foreign_keys = ON;

-- Additive logical identity only. Existing typed factual tables remain the
-- accounting authority, and no historical row is classified or linked here.
CREATE TABLE logical_transactions (
  logical_transaction_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('active','deleted')),
  terminal_version_id TEXT,
  created_actor_email TEXT,
  created_at_utc TEXT,
  creation_request_id TEXT,
  creation_write_token TEXT,
  creation_committed_revision INTEGER,
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  FOREIGN KEY (logical_transaction_id,terminal_version_id)
    REFERENCES logical_transaction_versions(logical_transaction_id,version_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK(
    (created_actor_email IS NULL AND created_at_utc IS NULL AND creation_request_id IS NULL
      AND creation_write_token IS NULL AND creation_committed_revision IS NULL)
    OR
    (created_actor_email IS NOT NULL AND length(trim(created_actor_email)) > 0
      AND created_at_utc IS NOT NULL
      AND length(created_at_utc) = 24 AND substr(created_at_utc,24,1) = 'Z'
      AND creation_request_id IS NOT NULL AND length(trim(creation_request_id)) > 0
      AND creation_write_token IS NOT NULL AND length(trim(creation_write_token)) > 0
      AND creation_committed_revision IS NOT NULL AND creation_committed_revision > 0)
  )
);
CREATE INDEX idx_logical_transactions_household_lifecycle
  ON logical_transactions(household_id,lifecycle_status,logical_transaction_id);

CREATE TABLE logical_transaction_versions (
  version_id TEXT PRIMARY KEY,
  logical_transaction_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(typeof(version_number)='integer' AND version_number > 0),
  kind TEXT NOT NULL CHECK(kind IN (
    'one_off_payment','other_income_receipt','obligation_payment','ktb_transfer',
    'ef_movement','goal_movement','salary_receipt'
  )),
  business_date TEXT NOT NULL CHECK(
    length(business_date)=10
    AND business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  committed_revision INTEGER NOT NULL CHECK(typeof(committed_revision)='integer' AND committed_revision > 0),
  operation_type TEXT NOT NULL CHECK(operation_type IN ('created','corrected','deleted','restored','replaced','undone')),
  management_operation_id TEXT,
  FOREIGN KEY (logical_transaction_id) REFERENCES logical_transactions(logical_transaction_id),
  FOREIGN KEY (logical_transaction_id,management_operation_id)
    REFERENCES transaction_management_audit(logical_transaction_id,operation_id)
    DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(logical_transaction_id,version_number),
  UNIQUE(logical_transaction_id,version_id),
  CHECK(
    (operation_type='created' AND management_operation_id IS NULL)
    OR
    (operation_type<>'created' AND length(trim(management_operation_id)) > 0)
  )
);
CREATE INDEX idx_logical_transaction_versions_kind_date
  ON logical_transaction_versions(kind,business_date,logical_transaction_id);

CREATE TABLE logical_transaction_components (
  version_id TEXT NOT NULL,
  component_kind TEXT NOT NULL CHECK(component_kind IN (
    'one_off_payment','one_off_payment_allocation','balance_effect',
    'income_receipt','obligation_payment','ledger_movement'
  )),
  component_id TEXT NOT NULL CHECK(length(trim(component_id)) > 0),
  component_role TEXT NOT NULL CHECK(component_role IN (
    'primary','allocation','cash_effect','receipt','obligation_effect',
    'source_effect','destination_effect','fund_effect'
  )),
  PRIMARY KEY(version_id,component_kind,component_id,component_role),
  FOREIGN KEY (version_id) REFERENCES logical_transaction_versions(version_id),
  UNIQUE(component_kind,component_id)
);

CREATE TABLE transaction_management_audit (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('corrected','deleted','restored','replaced','undone')),
  logical_transaction_id TEXT NOT NULL,
  prior_version_id TEXT NOT NULL,
  resulting_version_id TEXT NOT NULL,
  actor_email TEXT NOT NULL CHECK(length(trim(actor_email)) > 0),
  committed_at_utc TEXT NOT NULL CHECK(length(committed_at_utc)=24 AND substr(committed_at_utc,24,1)='Z'),
  reason_code TEXT NOT NULL CHECK(length(trim(reason_code)) > 0),
  reason_explanation TEXT,
  request_id TEXT NOT NULL CHECK(length(trim(request_id)) > 0),
  semantic_payload_hash TEXT NOT NULL CHECK(
    length(semantic_payload_hash)=64 AND semantic_payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  preview_base_revision INTEGER NOT NULL CHECK(typeof(preview_base_revision)='integer' AND preview_base_revision >= 0),
  committed_revision INTEGER NOT NULL CHECK(
    typeof(committed_revision)='integer' AND committed_revision=preview_base_revision+1
  ),
  write_token TEXT NOT NULL CHECK(length(trim(write_token)) > 0),
  impact_summary_json TEXT NOT NULL CHECK(json_valid(impact_summary_json)),
  FOREIGN KEY (logical_transaction_id) REFERENCES logical_transactions(logical_transaction_id),
  FOREIGN KEY (logical_transaction_id,prior_version_id)
    REFERENCES logical_transaction_versions(logical_transaction_id,version_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (logical_transaction_id,resulting_version_id)
    REFERENCES logical_transaction_versions(logical_transaction_id,version_id)
    DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(logical_transaction_id,operation_id),
  UNIQUE(logical_transaction_id,request_id),
  UNIQUE(logical_transaction_id,write_token),
  CHECK(prior_version_id <> resulting_version_id)
);
CREATE INDEX idx_transaction_management_audit_revision
  ON transaction_management_audit(logical_transaction_id,committed_revision,operation_id);

CREATE TRIGGER logical_transaction_identity_immutable
BEFORE UPDATE ON logical_transactions
WHEN NEW.logical_transaction_id IS NOT OLD.logical_transaction_id
  OR NEW.household_id IS NOT OLD.household_id
  OR NEW.created_actor_email IS NOT OLD.created_actor_email
  OR NEW.created_at_utc IS NOT OLD.created_at_utc
  OR NEW.creation_request_id IS NOT OLD.creation_request_id
  OR NEW.creation_write_token IS NOT OLD.creation_write_token
  OR NEW.creation_committed_revision IS NOT OLD.creation_committed_revision
BEGIN SELECT RAISE(ABORT,'Logical transaction identity and creation evidence are immutable'); END;

CREATE TRIGGER logical_transaction_terminal_not_cleared
BEFORE UPDATE OF terminal_version_id ON logical_transactions
WHEN OLD.terminal_version_id IS NOT NULL AND NEW.terminal_version_id IS NULL
BEGIN SELECT RAISE(ABORT,'Logical transaction terminal version cannot be cleared'); END;

CREATE TRIGGER logical_transaction_lifecycle_requires_new_version
BEFORE UPDATE OF lifecycle_status ON logical_transactions
WHEN NEW.lifecycle_status IS NOT OLD.lifecycle_status
 AND NEW.terminal_version_id IS OLD.terminal_version_id
BEGIN SELECT RAISE(ABORT,'Lifecycle changes require a new terminal version'); END;

CREATE TRIGGER logical_transaction_terminal_advances_one
BEFORE UPDATE OF terminal_version_id ON logical_transactions
WHEN OLD.terminal_version_id IS NOT NULL
 AND NEW.terminal_version_id IS NOT OLD.terminal_version_id
 AND (
   (SELECT version_number FROM logical_transaction_versions WHERE version_id=NEW.terminal_version_id)
   <> (SELECT version_number FROM logical_transaction_versions WHERE version_id=OLD.terminal_version_id)+1
 )
BEGIN SELECT RAISE(ABORT,'Terminal version must advance by exactly one'); END;

CREATE TRIGGER logical_transaction_terminal_lifecycle_matches
BEFORE UPDATE OF lifecycle_status,terminal_version_id ON logical_transactions
WHEN NEW.terminal_version_id IS NOT NULL AND (
  (NEW.lifecycle_status='deleted' AND COALESCE((SELECT operation_type FROM logical_transaction_versions WHERE version_id=NEW.terminal_version_id),'')<>'deleted')
  OR
  (NEW.lifecycle_status='active' AND COALESCE((SELECT operation_type FROM logical_transaction_versions WHERE version_id=NEW.terminal_version_id),'')='deleted')
)
BEGIN SELECT RAISE(ABORT,'Lifecycle must match the terminal version operation'); END;

CREATE TRIGGER logical_transaction_delete_forbidden
BEFORE DELETE ON logical_transactions
BEGIN SELECT RAISE(ABORT,'Logical transactions cannot be deleted'); END;

CREATE TRIGGER logical_transaction_version_sequence
BEFORE INSERT ON logical_transaction_versions
WHEN NEW.version_number <> COALESCE(
  (SELECT MAX(version_number)+1 FROM logical_transaction_versions WHERE logical_transaction_id=NEW.logical_transaction_id),1
)
BEGIN SELECT RAISE(ABORT,'Logical transaction version number is not next'); END;

CREATE TRIGGER logical_transaction_version_update_forbidden
BEFORE UPDATE ON logical_transaction_versions
BEGIN SELECT RAISE(ABORT,'Logical transaction versions are immutable'); END;
CREATE TRIGGER logical_transaction_version_delete_forbidden
BEFORE DELETE ON logical_transaction_versions
BEGIN SELECT RAISE(ABORT,'Logical transaction versions cannot be deleted'); END;
CREATE TRIGGER logical_transaction_component_update_forbidden
BEFORE UPDATE ON logical_transaction_components
BEGIN SELECT RAISE(ABORT,'Logical transaction components are immutable'); END;
CREATE TRIGGER logical_transaction_component_delete_forbidden
BEFORE DELETE ON logical_transaction_components
BEGIN SELECT RAISE(ABORT,'Logical transaction components cannot be deleted'); END;
CREATE TRIGGER transaction_management_audit_update_forbidden
BEFORE UPDATE ON transaction_management_audit
BEGIN SELECT RAISE(ABORT,'Transaction management audit is immutable'); END;
CREATE TRIGGER transaction_management_audit_delete_forbidden
BEFORE DELETE ON transaction_management_audit
BEGIN SELECT RAISE(ABORT,'Transaction management audit cannot be deleted'); END;
CREATE TRIGGER transaction_management_audit_version_consistency
BEFORE INSERT ON transaction_management_audit
WHEN NOT EXISTS(
  SELECT 1
  FROM logical_transaction_versions prior
  JOIN logical_transaction_versions resulting
    ON resulting.logical_transaction_id=prior.logical_transaction_id
  WHERE prior.logical_transaction_id=NEW.logical_transaction_id
    AND prior.version_id=NEW.prior_version_id
    AND resulting.version_id=NEW.resulting_version_id
    AND resulting.operation_type=NEW.operation_type
    AND resulting.management_operation_id=NEW.operation_id
    AND resulting.committed_revision=NEW.committed_revision
    AND resulting.version_number=prior.version_number+1
)
BEGIN SELECT RAISE(ABORT,'Management audit does not match its versions'); END;
