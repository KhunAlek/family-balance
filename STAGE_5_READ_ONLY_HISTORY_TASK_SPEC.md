# Stage 5 Task Specification — Read-Only Transaction History

## Objective

Starting from candidate `9871da3f65240cc565d609cbf4b66162890c5479`, implement the first read-only Transaction history server query over the accepted canonical terminal transaction model. Add salary-cycle/custom/all-history periods, filters, complete-set counts and totals, stable ordering, detail/audit visibility, and stale-safe pagination without enabling any transaction mutation or changing existing financial consumers.

## Authorization prerequisite

Do not implement Step 5 unless the owner explicitly accepts the Step 4 candidate and authorizes local Step 5 work. Running either read-only model against production or a representative production copy remains a separate gate.

## Required intake

Read repository `AGENTS.md`, the accepted REV1 specification, master staged specification, Step 2 schema decision/result/ledger, Step 3 preflight decision/result/ledger, Step 4 read-model decision/result/ledger, and this task specification. Verify package hashes, exact starting SHA, and dirty state. Inspect exact-SHA Worker routing/auth, salary-cycle/reporting boundaries, revision reads, canonical model, frontend architecture/i18n, current accounting consumers, backup/restore, and relevant tests before describing current behavior.

## Authorized local work

- Add an authenticated read-only internal/public Worker query for Transaction history and detail.
- Implement current/previous salary-cycle, inclusive Bangkok custom dates, and all-history periods without inferred boundaries.
- Implement free-text, category, kind, account, exact/min/max positive-satang filters.
- Compute result count and money-in/money-out totals over the complete filtered active terminal set; exclude internal movement, deleted, superseded, reversal, management, ambiguous, and balance-observation rows from financial totals.
- Order by business date descending, committed revision descending with a documented null ordering for legacy rows, then logical ID descending.
- Add opaque, query-bound pagination whose cursor contains the household revision and canonical query hash. A revision mismatch returns a stable stale-query response; do not maintain a cross-request database snapshot.
- Expose audit/deleted/ambiguous visibility only behind the explicit audit option, with all mutation controls absent.
- Add read-only phone/desktop English/Russian UI only if separately explicit in the Step 5 authorization; otherwise keep the stage server-only and document the limitation.
- Add local fixtures/tests, decision/result/ledger documents, one local candidate commit, and the Step 6 handoff package.

## Forbidden actions

No production or representative-copy access, database write, migration, backfill, classification/relationship persistence, factual repair, transaction preview/commit, correction/delete/restore/replace/undo, balance-history mutation, current dashboard/report/Available/commitment/weekly consumer switch, dependency change, Cloudflare configuration change, D1/R2 mutation, merge, deployment, or Step 6 implementation.

## Acceptance cases

1. Default results contain active terminal transactions only and use the canonical DTO without rebuilding transaction semantics in the endpoint.
2. Current/previous cycle boundaries use recorded factual boundaries; unavailable boundaries return explicit stable unavailability, never inference.
3. Custom dates are inclusive Bangkok dates; invalid/reversed ranges fail read-only.
4. Every filter and free-text combination is deterministic and applied to the complete set.
5. Count and totals cover the complete filtered set, not the loaded page; money direction rules exclude internal/audit/deleted/superseded/reversal material.
6. Ordering is stable across ties and legacy null revisions.
7. Cursor is opaque, query-bound, and household-revision-bound; changed query or revision fails stale/invalid with zero writes and requires restart.
8. Audit visibility shows deleted transactions, ordered audit summaries, and separate ambiguous legacy items without enabling mutation or counting them financially.
9. Repeated and shuffled-input queries serialize byte-for-byte identically.
10. All success/failure paths perform zero writes.
11. Step 4 focused tests, Step 3 preflight, Step 2 schema/portable restore, Step 1 correction safety, and complete Slice B/C/D regressions remain passing.

## Deliverables and stop boundaries

Produce `STAGE_5_HISTORY_DECISION_RECORD.md`, `STAGE_5_RESULT.md`, `STAGE_5_EXECUTION_LEDGER.md`, Step 6 task/prompt/manifest/ZIP, and one local candidate commit. Stop only for a material unresolved query/UI rule, conflicting owner change, unavailable evidence, or required authorization gate; ask exactly one focused question when needed.
