# Stage 5 History Decision Record — Read-Only Transaction History

**Decision date:** 11 September 2026

**Repository baseline reviewed:** `9871da3f65240cc565d609cbf4b66162890c5479`

**Authority:** owner-accepted Step 4 candidate and `STAGE_4_READ_MODEL_DECISION_RECORD.md` for local Step 5 work

**Status:** local implemented-candidate design; server-only, read-only, and not run against production or a representative production copy

## Decision

Add one authenticated same-origin Worker action, `transactionHistory`, backed by a SELECT-only history module. The module loads the same complete portable inventory as Step 4, calls `buildTerminalTransactionReadModel`, and applies history periods, filters, ordering, totals, detail selection, audit visibility, and pagination only to canonical DTOs. It does not reconstruct transaction semantics, expose mutation, or replace any dashboard, Available, commitments, reporting, salary-cycle, weekly, or accounting consumer.

## Period and filter contract

- Current salary cycle requires the recorded `current_cycle_start` and a later recorded `next_salary_date`; it is `[current_cycle_start, next_salary_date)`. Missing or invalid recorded boundaries return `PERIOD_UNAVAILABLE`; no date is inferred.
- Previous salary cycle requires the recorded current start to have an immediately preceding factual `reporting_salary_cycles` start; it is `[previous_start, current_start)`. Missing adjacency returns `PERIOD_UNAVAILABLE`.
- Custom endpoints are valid inclusive `YYYY-MM-DD` Bangkok business dates. All history has no date bounds.
- Free text covers canonical description, payee/source, category name, and allocation account name. Category, kind, and account lists use exact identifiers. Exact/minimum/maximum amount filters use positive integer satang with inclusive bounds.
- Actor and management-operation filters are valid only in audit mode and select transactions having one matching canonical audit operation.

## Financial and audit interpretation

Default results contain only filtered active terminal canonical DTOs. Complete-set result count and money-in/money-out totals are calculated before pagination from those active DTOs. Only canonical `money_in` and `money_out` directions contribute. Deleted transactions and ambiguous legacy items appear separately only with `showAudit`; superseded versions and management operations remain inside canonical audit summaries. Deleted, ambiguous, management, reversal/superseded material, balance observations, and internal movements cannot enter financial totals. Every DTO continues to carry Step 4's mutation-disabled action contract.

## Ordering and pagination

Ordering is business date descending, committed revision descending with historical null revisions last, then logical transaction ID descending. The cursor is URL-safe base64 of a versioned internal object containing the household revision, SHA-256 hash of the complete normalized query, and the final row's ordering key. It is transport-opaque and contains no transaction semantics beyond the ordering key.

A changed normalized query returns `INVALID_CURSOR`; a changed household revision returns `STALE_HISTORY_QUERY`. Both require restart. A missing cursor position is invalid rather than silently resuming elsewhere. No cross-request database snapshot is held.

## Determinism and zero writes

Inputs are normalized and set filters sorted before hashing. Step 4 supplies deterministic canonical DTOs. History ordering is total, response object serialization recursively sorts keys, and cursor JSON field order is fixed. The database adapter submits exactly one `SELECT *` per reviewed portable table in one batch. Tests snapshot every table, total changes, and household revision across success, validation failure, stale/invalid cursor, unavailable period, injected read failure, and authenticated route behavior.

## Explicit limitations

- UI authorization was omitted, so there is no phone/desktop or English/Russian UI in Step 5.
- The query has been exercised only against repository and synthetic fixtures.
- It has not been run against production or an isolated representative production backup.
- Current canonical limitations remain: obligation, KTB transfer, EF, and Goal identity kinds fail closed until complete typed relationships exist; their legacy facts remain audit-visible ambiguities.
- The cursor is query/revision bound but is not a cryptographic authorization token; authorization is enforced independently by the signed session and same-origin Worker route.
