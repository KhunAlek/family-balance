-- First development increment of the 2026-09-03 specification.
-- Category identities and new-function request receipts; no Accounting updates.
CREATE TABLE one_off_categories (
  category_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(household_id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  UNIQUE(household_id, name_key)
);

CREATE TABLE new_function_request_receipts (
  household_id TEXT NOT NULL REFERENCES households(household_id),
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  semantic_payload_hash TEXT NOT NULL,
  committed_revision INTEGER NOT NULL CHECK (committed_revision > 0),
  response_json TEXT NOT NULL,
  PRIMARY KEY(household_id, request_id)
);

INSERT OR IGNORE INTO one_off_categories(category_id,household_id,name,name_key,active)
SELECT household_id || ':category:' || seed.slug, household_id, seed.name, lower(seed.name), 1
FROM households CROSS JOIN (
  SELECT 'eating-out' AS slug, 'Eating Out' AS name
  UNION ALL SELECT 'health', 'Health'
  UNION ALL SELECT 'car', 'Car Repair and Insurance'
  UNION ALL SELECT 'documents', 'Documents'
  UNION ALL SELECT 'entertainment', 'Entertainment'
) AS seed;
