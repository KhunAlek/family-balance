PRAGMA foreign_keys = ON;

-- Promote only historical one-off payments whose complete typed relationship is
-- already provable. This adds management identity; it does not rewrite facts.
BEGIN TRANSACTION;

INSERT INTO logical_transactions(
  logical_transaction_id, household_id, lifecycle_status, terminal_version_id,
  created_actor_email, created_at_utc, creation_request_id,
  creation_write_token, creation_committed_revision
)
SELECT
  'managed-history:one-off:' || p.one_off_payment_id,
  p.household_id,
  'active',
  NULL,
  NULL, NULL, NULL, NULL, NULL
FROM one_off_payments p
WHERE
  (SELECT COUNT(*) FROM one_off_payment_allocations a
    WHERE a.one_off_payment_id=p.one_off_payment_id) > 0
  AND (SELECT COALESCE(SUM(a.amount_satang),0) FROM one_off_payment_allocations a
    WHERE a.one_off_payment_id=p.one_off_payment_id)=p.amount_satang
  AND (SELECT COUNT(*) FROM balance_history b
    WHERE b.one_off_payment_id=p.one_off_payment_id) <= 1
  AND NOT EXISTS(
    SELECT 1 FROM logical_transaction_components c
    WHERE c.component_kind='one_off_payment' AND c.component_id=p.one_off_payment_id
  )
  AND NOT EXISTS(
    SELECT 1 FROM one_off_payment_allocations a
    JOIN logical_transaction_components c
      ON c.component_kind='one_off_payment_allocation'
     AND c.component_id=a.one_off_payment_id || ':' || a.account
    WHERE a.one_off_payment_id=p.one_off_payment_id
  )
  AND NOT EXISTS(
    SELECT 1 FROM balance_history b
    JOIN logical_transaction_components c
      ON c.component_kind='balance_effect'
     AND c.component_id=CAST(b.balance_row_id AS TEXT)
    WHERE b.one_off_payment_id=p.one_off_payment_id
  );

INSERT INTO logical_transaction_versions(
  version_id, logical_transaction_id, version_number, kind, business_date,
  committed_revision, operation_type, management_operation_id
)
SELECT
  t.logical_transaction_id || ':v1',
  t.logical_transaction_id,
  1,
  'one_off_payment',
  p.business_date,
  COALESCE((
    SELECT c.base_revision + 1
    FROM financial_write_claims c
    WHERE c.household_id=p.household_id
      AND p.one_off_payment_id LIKE '%:one-off'
      AND c.write_token=substr(p.one_off_payment_id,1,length(p.one_off_payment_id)-8)
  ),1),
  'created',
  NULL
FROM logical_transactions t
JOIN one_off_payments p
  ON t.logical_transaction_id='managed-history:one-off:' || p.one_off_payment_id
WHERE t.terminal_version_id IS NULL;

INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role)
SELECT
  t.logical_transaction_id || ':v1',
  'one_off_payment',
  p.one_off_payment_id,
  'primary'
FROM logical_transactions t
JOIN one_off_payments p
  ON t.logical_transaction_id='managed-history:one-off:' || p.one_off_payment_id
WHERE t.terminal_version_id IS NULL;

INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role)
SELECT
  t.logical_transaction_id || ':v1',
  'one_off_payment_allocation',
  a.one_off_payment_id || ':' || a.account,
  'allocation'
FROM logical_transactions t
JOIN one_off_payments p
  ON t.logical_transaction_id='managed-history:one-off:' || p.one_off_payment_id
JOIN one_off_payment_allocations a
  ON a.one_off_payment_id=p.one_off_payment_id
WHERE t.terminal_version_id IS NULL;

INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role)
SELECT
  t.logical_transaction_id || ':v1',
  'balance_effect',
  CAST(b.balance_row_id AS TEXT),
  'cash_effect'
FROM logical_transactions t
JOIN one_off_payments p
  ON t.logical_transaction_id='managed-history:one-off:' || p.one_off_payment_id
JOIN balance_history b
  ON b.one_off_payment_id=p.one_off_payment_id
WHERE t.terminal_version_id IS NULL;

UPDATE logical_transactions
SET terminal_version_id=logical_transaction_id || ':v1'
WHERE logical_transaction_id LIKE 'managed-history:one-off:%'
  AND terminal_version_id IS NULL;

COMMIT;
