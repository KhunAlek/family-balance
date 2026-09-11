-- Permit undo of a restore to reconstruct the preceding deleted lifecycle.
-- Every other deleted terminal still requires a deleted operation.
DROP TRIGGER logical_transaction_terminal_lifecycle_matches;
CREATE TRIGGER logical_transaction_terminal_lifecycle_matches
BEFORE UPDATE OF lifecycle_status,terminal_version_id ON logical_transactions
WHEN NEW.terminal_version_id IS NOT NULL AND (
  (NEW.lifecycle_status='deleted' AND NOT (
    COALESCE((SELECT operation_type FROM logical_transaction_versions WHERE version_id=NEW.terminal_version_id),'')='deleted'
    OR (
      COALESCE((SELECT operation_type FROM logical_transaction_versions WHERE version_id=NEW.terminal_version_id),'')='undone'
      AND COALESCE((
        SELECT prior.operation_type
        FROM transaction_management_audit current_audit
        JOIN logical_transaction_versions current_version ON current_version.version_id=current_audit.prior_version_id
        JOIN transaction_management_audit prior_audit ON prior_audit.resulting_version_id=current_version.version_id
        JOIN logical_transaction_versions prior ON prior.version_id=prior_audit.prior_version_id
        WHERE current_audit.resulting_version_id=NEW.terminal_version_id
          AND current_version.operation_type='restored'
      ),'')='deleted'
    )
  ))
  OR
  (NEW.lifecycle_status='active' AND COALESCE((SELECT operation_type FROM logical_transaction_versions WHERE version_id=NEW.terminal_version_id),'')='deleted')
)
BEGIN SELECT RAISE(ABORT,'Lifecycle must match the terminal version operation'); END;
