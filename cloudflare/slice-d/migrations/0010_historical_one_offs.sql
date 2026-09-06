-- Owner-confirmed deterministic historical report import. Accounting rows remain untouched.
INSERT OR IGNORE INTO reporting_salary_cycles(household_id,cycle_start) SELECT household_id,'2026-06-30' FROM households;
INSERT OR IGNORE INTO reporting_salary_cycles(household_id,cycle_start) SELECT household_id,'2026-07-31' FROM households;
INSERT OR IGNORE INTO one_off_payments(one_off_payment_id,household_id,business_date,category_id,description,amount_satang,paid_from_account,created_at,request_id,legacy_origin)
SELECT household_id||':legacy-one-off:dentist-800',household_id,'2026-07-13',NULL,'Dentist',80000,'Alex','2026-09-06T00:00:00.000Z','legacy-dentist-800','Balance Check row 11' FROM households
UNION ALL SELECT household_id||':legacy-one-off:openai-api',household_id,'2026-07-13',NULL,'OpenAI API',20000,'Alex','2026-09-06T00:00:00.000Z','legacy-openai-api','Balance Check row 12' FROM households
UNION ALL SELECT household_id||':legacy-one-off:dentist-3000',household_id,'2026-08-04',NULL,'Dentist',300000,'Alex','2026-09-06T00:00:00.000Z','legacy-dentist-3000','Balance Check row 56' FROM households
UNION ALL SELECT household_id||':legacy-one-off:dumbo-rats',household_id,'2026-08-08',NULL,'Dumbo rats for Nick',250000,'Olga','2026-09-06T00:00:00.000Z','legacy-dumbo-rats','Balance Check row 64' FROM households
UNION ALL SELECT household_id||':legacy-one-off:toyota',household_id,'2026-07-16',NULL,'Toyota',544500,NULL,'2026-09-06T00:00:00.000Z','legacy-toyota','Balance Check rows 17+18; owner-confirmed split' FROM households;
INSERT OR IGNORE INTO one_off_payment_allocations(one_off_payment_id,account,amount_satang)
SELECT household_id||':legacy-one-off:dentist-800','Alex',80000 FROM households;
INSERT OR IGNORE INTO one_off_payment_allocations(one_off_payment_id,account,amount_satang)
SELECT household_id||':legacy-one-off:openai-api','Alex',20000 FROM households;
INSERT OR IGNORE INTO one_off_payment_allocations(one_off_payment_id,account,amount_satang)
SELECT household_id||':legacy-one-off:dentist-3000','Alex',300000 FROM households;
INSERT OR IGNORE INTO one_off_payment_allocations(one_off_payment_id,account,amount_satang)
SELECT household_id||':legacy-one-off:dumbo-rats','Olga',250000 FROM households;
INSERT OR IGNORE INTO one_off_payment_allocations(one_off_payment_id,account,amount_satang)
SELECT household_id||':legacy-one-off:toyota','Alex',44500 FROM households;
INSERT OR IGNORE INTO one_off_payment_allocations(one_off_payment_id,account,amount_satang)
SELECT household_id||':legacy-one-off:toyota','Olga',500000 FROM households;
