# Stage 9 Task Specification — Other-Income Management

## Objective

Starting from candidate `50bd2750dc353768c0fe8f5b2f40bd2e7f143e65`, enable correction, deletion, restoration, and undo for persisted other-income logical transactions through the accepted shared protocol. Replacement remains disabled.

## Authorization prerequisite

Do not implement Step 9 unless the owner explicitly accepts the Step 8 candidate and authorizes local Step 9 work. Any additive migration, representative-copy access, production mutation, merge, or deployment requires separate authorization.

## Required intake

Read repository `AGENTS.md`, REV1, the master specification, Steps 2–8 decisions/results/ledgers, and this task. Verify package hashes, exact SHA, dirty state, typed receipt parents and split allocations, balance effects, canonical/history readers, Step 7 protocol, Step 8 family pattern and migration, Worker gates, backup/restore, current consumers, and relevant tests at the exact SHA.

## Authorized local scope when granted

- Define durable other-income eligibility and dependency rules without guessing identity or source classification.
- Implement authoritative preview, correction, delete, restore-last-active, and undo.
- Append complete immutable receipt facts, versions, components, balance effects, audit, receipt, pointer, lifecycle, and revision atomically.
- Preserve salary classification and never allow other income to advance or rewrite a salary cycle.
- Prove split allocation, source lifecycle/date validation, replay, stale/race exclusion, rollback, terminal reconstruction, history visibility, and portable restore.

## Forbidden scope

No replacement, salary management, non-income family enablement, production/representative access, backfill, guessed classification, factual repair, observation mutation, current-consumer switch, dependency/configuration change, merge, deployment, or Step 10 work.

## Stop boundaries

Stop for an unresolved material receipt-parent/allocation rule, a required additive migration without explicit authorization, conflicting owner work, unavailable evidence, or another authorization gate. Ask exactly one focused question.
