# Stage 11 Task Specification — Fixed-Obligation Payment Management

## Objective

Starting from the Step 10 deferral candidate `4435ce65575fe465e72e6ad3c418f189927215b9`, enable correction, deletion, restoration of the last active version, and ten-minute undo for fixed-obligation payments only after proving each payment's occurrence and exact cash components through durable evidence.

## Authorization prerequisites

Do not implement Step 11 unless the owner explicitly accepts the Step 10 deferral candidate and authorizes local Step 11 work. Any additive migration, representative-copy access, production mutation, merge, or deployment requires separate explicit authorization.

## Required intake

Read repository `AGENTS.md`, REV1, the master staged specification, Steps 2–10 decisions/results/ledgers, and this task. Verify package hashes, exact SHA, dirty state, obligation configuration/version/occurrence/payment writers, cash-effect relationships, status consumers, shared management protocol, canonical/history/Balance-history readers, Worker gates, portable backup/restore, current dashboard/Available/commitment/reporting consumers, and relevant tests at the exact SHA before describing current behavior.

## Local scope only when granted

- Establish one durable logical transaction per eligible fixed-obligation payment using only authoritative typed relationships.
- Link the payment to its exact obligation occurrence and complete Alex/Olga cash components; do not infer relationships from dates, amounts, names, or row adjacency.
- Derive occurrence status and paid amount from terminal authoritative payments; never maintain a contradictory independently editable status.
- Implement complete correction, deletion, last-active restoration, and ten-minute latest-operation undo invariants over the shared protocol.
- Revalidate Bangkok date, occurrence eligibility, positive exact allocations, balances, stale state, dependencies, audit reason, actor, concurrency, rollback, and semantic replay.
- Preserve original facts and append complete immutable replacement versions, components, audit, receipt, terminal pointer/lifecycle, and one revision atomically.
- Prove partial, full, and overpayment status; reassignment between occurrences; both accounts and split allocations; retry; race exclusion; rollback; delete/restore/undo; canonical/history/audit visibility; balance reconciliation; current consumers; and portable restore.

## Forbidden scope

No guessed historical linkage or backfill; no payment/other-income replacement; no salary management/replacement; no KTB transfer, EF, or Goal management; no factual repair or observation mutation; no consumer switch beyond the accepted terminal obligation interpretation required by this stage; no dependency/configuration change; no production/representative access; no merge, deployment, or Step 12 implementation.

## Stop boundaries

Stop for missing acceptance/authorization, absence of durable payment-to-cash or payment-to-occurrence evidence, an unresolved obligation status or dependency rule, a required additive migration without explicit authorization, conflicting owner work, or unavailable evidence. Ask exactly one focused question.
