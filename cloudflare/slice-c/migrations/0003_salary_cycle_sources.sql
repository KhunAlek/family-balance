PRAGMA foreign_keys = ON;

CREATE TABLE salary_cycle_sources (
  household_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (household_id, cycle_start, source),
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  FOREIGN KEY (household_id, source) REFERENCES income_definitions(household_id, source)
);

-- The imported current cycle predates factual salary-receipt metadata. The
-- legacy migration explicitly seeded all configured salary sources as already
-- belonging to the active cycle; preserve that state so an early next payday
-- correctly opens a new cycle instead of being mistaken for the second salary
-- of the current round.
INSERT INTO salary_cycle_sources(household_id,cycle_start,source)
SELECT s.household_id,s.current_cycle_start,i.source
FROM salary_cycle_state s
JOIN income_definitions i ON i.household_id=s.household_id
WHERE s.current_cycle_start IS NOT NULL
  AND TRIM(COALESCE(i.pay_day,'')) <> 'Variable';
