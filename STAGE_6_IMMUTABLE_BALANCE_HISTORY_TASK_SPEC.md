# Stage 6 Task Specification — Immutable Balance History

## Objective

Starting from candidate `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8`, implement a read-only Balance history server query that keeps immutable balance observations separate from transaction-created balance effects, represents partial-account authority accurately, and links only durably related reconciliation effects to canonical logical transactions without double-applying effects.

## Authorization prerequisite

Do not implement Step 6 unless the owner explicitly accepts the Step 5 candidate and authorizes local Step 6 work. Production or representative-copy access remains a separate gate. Add phone/desktop English/Russian UI only if explicitly authorized for Step 6.

## Required intake

Read repository `AGENTS.md`, the accepted REV1 and master staged specification, Step 2 schema evidence, Step 3 preflight evidence, Step 4 canonical decision/evidence, Step 5 history decision/evidence, and this task specification. Verify package hashes, exact starting SHA, and dirty state. Inspect exact-SHA balance storage/read ordering, typed transaction-effect links, partial observation semantics, reconciliation/current-position consumers, Worker auth/routing, canonical/history modules, portable backup/restore, and relevant tests before describing current behavior.

## Authorized local work

- Add an authenticated same-origin, SELECT-only Balance history server query using local repository/synthetic fixtures.
- Return immutable balance observations separately from transaction-created balance effects.
- Preserve exact Alex-only, Olga-only, and combined observation authority; never manufacture an unrecorded counterpart or combined balance.
- Link a transaction-created balance effect to a canonical logical transaction only through durable typed evidence.
- Expose reconciliation context without applying transaction effects already incorporated in the selected observation a second time.
- Add stable ordering, deterministic serialization, bounded pagination if required by the accepted design, stable fail-closed errors, and zero-write tests.
- Keep every balance-history mutation control absent and all transaction-management actions disabled.
- Add decision/result/ledger documents, one local candidate commit, and the Step 7 handoff package.

## Forbidden actions

No production or representative-copy access, database write, migration, backfill, classification/relationship persistence, observation repair/invalidation, transaction or balance-history mutation, current dashboard/report/Available/commitment/salary-cycle/weekly/accounting consumer switch, dependency change, Cloudflare configuration change, D1/R2 mutation, merge, deployment, UI unless explicitly authorized, or Step 7 implementation.

## Acceptance cases

1. Balance observations are never emitted as transactions and transaction-created effects are never emitted as observations.
2. Alex-only and Olga-only observations preserve explicit partial authority; combined values are unavailable unless both accounts are recorded authoritatively.
3. Typed one-off balance effects link to the correct canonical logical transaction using durable identity; unlinked or ambiguous rows remain unlinked and fail closed for transaction interpretation.
4. Reconciliation presentation never double-applies an effect already included in an observation.
5. Ordering and any pagination are stable, deterministic, and complete.
6. No response exposes correction/delete/restore/undo or any other mutation control.
7. Repeated and shuffled-input queries serialize byte-for-byte identically.
8. Every success/failure path performs zero writes.
9. Step 5 history, Step 4 canonical model, Step 3 preflight, Step 2 schema/portable restore, Step 1 correction safety, and complete Slice B/C/D regressions remain passing.

## Deliverables and stop boundaries

Produce `STAGE_6_BALANCE_HISTORY_DECISION_RECORD.md`, `STAGE_6_RESULT.md`, `STAGE_6_EXECUTION_LEDGER.md`, Step 7 task/prompt/manifest/ZIP, and one local candidate commit. Stop only for a material unresolved reconciliation/authority rule, conflicting owner change, unavailable evidence, or required authorization gate; ask exactly one focused question when needed.

