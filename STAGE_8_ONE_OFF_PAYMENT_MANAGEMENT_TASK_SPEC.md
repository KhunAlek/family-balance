# Stage 8 Task Specification — One-Off Payment Management

## Objective

Starting from candidate `2c539dd6c1f1abe3a06654388c13ec9ae7072f13`, enable correction, deletion, restoration, and undo for persisted one-off payment logical transactions through the accepted Step 7 shared management protocol. Replacement to another kind remains disabled.

## Authorization prerequisite

Do not implement Step 8 unless the owner explicitly accepts the Step 7 candidate and authorizes local Step 8 work. Any migration, representative-copy access, production mutation, merge, or deployment requires separate authorization.

## Required intake

Read repository `AGENTS.md`, REV1, master staged specification, Steps 2–7 decisions/results/ledgers, and this task. Verify package hashes, exact starting SHA, dirty state, typed payment/allocation/balance-effect writes, canonical reconstruction, protocol receipt/stale/race/rollback behavior, current consumer semantics, backup/restore, and relevant tests at the exact SHA before describing behavior.

## Authorized local scope when separately granted

- Define complete one-off eligibility and dependency rules from durable typed evidence only.
- Implement authoritative preview impacts and family writer plans for correction, delete, restore, and undo.
- Append immutable typed facts, versions, components, audit, receipt, terminal pointer, and revision through Step 7.
- Preserve prior versions and factual audit visibility; never retarget old components.
- Test valid/invalid creation context, mutation, retry, changed retry, concurrency, rollback, delete/restore/undo ordering, serialization, refresh, and portable restore.
- Keep replacement and every other transaction family disabled.

## Forbidden scope

No production or representative-copy access, production D1/R2 mutation, backfill, guessed identity/classification, factual repair, observation invalidation, balance-history mutation, non-payment family enablement, replacement, current financial-consumer switch, dependency/configuration change, merge, deployment, or Step 9 work.

## Acceptance cases

1. Only persisted, canonically complete one-off identities are eligible.
2. Preview is authoritative and zero-write and reports exact typed/accounting impact.
3. Correction creates a complete new payment/allocation/effect version without rewriting old facts.
4. Delete removes terminal financial effect through an audited terminal version; restore reinstates the exact accepted meaning through new immutable facts.
5. Undo is limited by the one-off dependency invariant and restores the prior accepted meaning without retargeting components.
6. Replay, stale revision/version, race exclusion, and forced rollback satisfy Step 7.
7. Deleted/superseded/audit material never enters active totals; Balance history remains immutable and does not double apply.
8. Direct/old-client attempts for disabled families and replacement write nothing.
9. Portable restore reconstructs terminal state, eligibility, audit, receipt replay, and financial meaning exactly.
10. Steps 1–7 focused suites and complete Slice B/C/D regressions pass at the candidate SHA.

## Stop boundaries

Stop for an unresolved material one-off delete/restore/undo rule, a required additive schema change without explicit authorization, conflicting owner work, unavailable evidence, or another authorization gate. Ask exactly one focused question.
