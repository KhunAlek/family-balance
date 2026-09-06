-- Other-income identities and effective-dated lifecycle. Salary definitions
-- and existing receipt facts are retained unchanged.
CREATE TABLE other_income_sources (
 other_income_source_id TEXT PRIMARY KEY,
 household_id TEXT NOT NULL REFERENCES households(household_id),
 name TEXT NOT NULL,
 name_key TEXT NOT NULL,
 UNIQUE(household_id,name_key)
);
CREATE TABLE other_income_source_versions (
 version_id TEXT PRIMARY KEY,
 other_income_source_id TEXT NOT NULL REFERENCES other_income_sources(other_income_source_id),
 effective_date TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 created_revision INTEGER NOT NULL
);
CREATE INDEX idx_other_income_lifecycle ON other_income_source_versions(other_income_source_id,effective_date,created_revision);
INSERT INTO other_income_sources
SELECT household_id||':other-income:'||source,household_id,source,lower(trim(source)) FROM income_definitions WHERE pay_day='Variable';
INSERT INTO other_income_source_versions
SELECT s.other_income_source_id||':imported',s.other_income_source_id,
 COALESCE((SELECT MIN(r.business_date) FROM income_receipts r WHERE r.household_id=s.household_id AND r.source=s.name),c.current_cycle_start),1,0
FROM other_income_sources s JOIN salary_cycle_state c ON c.household_id=s.household_id;
ALTER TABLE income_receipts ADD COLUMN other_income_source_id TEXT REFERENCES other_income_sources(other_income_source_id);
