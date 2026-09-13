# Stage 14 Task Specification — Guarded Salary Management

Starting from the owner-accepted Step 13 candidate, design and review salary-receipt correction, deletion, restoration, and undo before enabling any salary mutation. Inspect exact typed receipt/cash relationships, qualifying-source membership, reporting-cycle assignment, active-cycle boundaries, commitments, weekly freezes, canonical/history/reconciliation, Worker gates, and portable recovery.

Frozen weekly snapshots remain immutable; `next_salary_date` is never inferred. Fail closed if one unambiguous terminal salary result cannot be reconstructed. Any additive migration, representative-data access, external migration, merge, deployment, repair, configuration/dependency change, or implementation beyond the separately accepted design requires explicit authorization. Do not enable replacement or begin Step 15.
