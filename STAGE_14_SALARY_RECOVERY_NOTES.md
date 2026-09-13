# Stage 14 Salary Recovery Notes

`salary_receipt_parents` is an optional portable-v2 schema family introduced by migration candidate `0019_salary_receipt_management.sql`. A backup that contains the table must also contain its validation/immutability triggers and the transaction-identity family; partial presence is rejected.

Restore order is determined by the portable schema and table inventory. Salary parents restore after `income_receipts` and before logical transaction identity consumers are reconstructed. Isolated verification must check foreign keys, row counts and hashes, canonical terminal serialization, management eligibility/refusal codes, household revision, and exact request-receipt replay.

Recovery must never attach an older receipt to a salary parent, infer a source interval or `next_salary_date`, mutate a balance observation, or update/delete/relabel a frozen weekly snapshot or preserved reporting boundary. Legacy salary material without the new parent remains visible through the historical adapter or ambiguous-item path and remains mutation-disabled.

No external backup, restore, migration application, historical repair, D1/R2 mutation, or production access is authorized by this note.
