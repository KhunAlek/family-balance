PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

UPDATE income_receipts AS r
SET other_income_source_id=(
  SELECT s.other_income_source_id FROM other_income_sources s
  JOIN income_definitions d ON d.household_id=s.household_id AND d.source=s.name AND d.pay_day='Variable'
  WHERE s.household_id=r.household_id AND s.name=r.source
)
WHERE r.other_income_source_id IS NULL AND r.source_balance_row_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM other_income_sources s JOIN income_definitions d ON d.household_id=s.household_id AND d.source=s.name AND d.pay_day='Variable' WHERE s.household_id=r.household_id AND s.name=r.source);

INSERT INTO other_income_receipt_parents(other_income_receipt_id,household_id,other_income_source_id,business_date,total_satang,created_at_utc,request_id)
SELECT 'managed-history:other-income:'||r.receipt_id,r.household_id,r.other_income_source_id,r.business_date,r.amount_satang,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),'managed-history:'||r.receipt_id
FROM income_receipts r
WHERE r.other_income_source_id IS NOT NULL AND r.source_balance_row_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM other_income_receipt_allocations a WHERE a.receipt_id=r.receipt_id)
  AND NOT EXISTS(SELECT 1 FROM logical_transaction_components c WHERE c.component_kind='income_receipt' AND c.component_id=r.receipt_id);

INSERT INTO other_income_receipt_allocations(other_income_receipt_id,receipt_id,account,amount_satang)
SELECT p.other_income_receipt_id,r.receipt_id,replace(r.lands_in,' KTB',''),r.amount_satang
FROM other_income_receipt_parents p JOIN income_receipts r ON p.other_income_receipt_id='managed-history:other-income:'||r.receipt_id
WHERE NOT EXISTS(SELECT 1 FROM other_income_receipt_allocations a WHERE a.receipt_id=r.receipt_id);

INSERT INTO logical_transactions(logical_transaction_id,household_id,lifecycle_status)
SELECT 'managed-history:other-income:'||r.receipt_id,r.household_id,'active'
FROM income_receipts r JOIN other_income_receipt_allocations a ON a.receipt_id=r.receipt_id
WHERE a.other_income_receipt_id='managed-history:other-income:'||r.receipt_id
  AND NOT EXISTS(SELECT 1 FROM logical_transactions t WHERE t.logical_transaction_id='managed-history:other-income:'||r.receipt_id);

INSERT INTO logical_transaction_versions(version_id,logical_transaction_id,version_number,kind,business_date,committed_revision,operation_type)
SELECT t.logical_transaction_id||':v1',t.logical_transaction_id,1,'other_income_receipt',r.business_date,
  COALESCE((SELECT c.base_revision+1 FROM financial_write_claims c WHERE c.household_id=r.household_id AND r.receipt_id=c.write_token||':income:'||lower(replace(r.lands_in,' KTB',''))),1),'created'
FROM logical_transactions t JOIN income_receipts r ON t.logical_transaction_id='managed-history:other-income:'||r.receipt_id
WHERE t.terminal_version_id IS NULL;

INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role)
SELECT t.logical_transaction_id||':v1','income_receipt',r.receipt_id,'receipt'
FROM logical_transactions t JOIN income_receipts r ON t.logical_transaction_id='managed-history:other-income:'||r.receipt_id WHERE t.terminal_version_id IS NULL;

INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role)
SELECT t.logical_transaction_id||':v1','balance_effect',CAST(r.source_balance_row_id AS TEXT),'cash_effect'
FROM logical_transactions t JOIN income_receipts r ON t.logical_transaction_id='managed-history:other-income:'||r.receipt_id WHERE t.terminal_version_id IS NULL;

UPDATE logical_transactions SET terminal_version_id=logical_transaction_id||':v1'
WHERE logical_transaction_id LIKE 'managed-history:other-income:%' AND terminal_version_id IS NULL;
COMMIT;
