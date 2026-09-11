# Stage 6 Balance History Decision Record — Immutable Observations and Typed Effects

**Decision date:** 11 September 2026

**Repository baseline reviewed:** `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8`

**Authority:** owner-accepted Step 5 candidate and `STAGE_5_HISTORY_DECISION_RECORD.md` for local Step 6 work
**Status:** local implemented-candidate design; server-only, SELECT-only, and not run against production or a representative copy

## Decision

Add authenticated same-origin Worker action `balanceHistory`, backed by a SELECT-only module over the complete portable inventory and the Step 4 canonical transaction model. It emits a single deterministically ordered timeline whose entries have an explicit `balance_observation` or `transaction_balance_effect` type. No entry exposes mutation controls.

## Authority and linkage

- A row without durable transaction-effect evidence is an immutable observation.
- `balance_history.one_off_payment_id` identifies a typed one-off effect.
- `income_receipts.source_balance_row_id` identifies a typed income effect.
- An effect links to a logical transaction only when the canonical model contains the matching typed component. Missing or conflicting canonical evidence stays explicitly unlinked and cannot affect reconciliation.
- Alex, Olga, and combined observation authority derive only from non-null recorded columns. Combined is unavailable unless both were recorded on that observation.

## Current-position reconciliation context

For each account independently, select the latest immutable observation that recorded that account. Apply only active canonical transaction allocations whose durably linked effect is strictly later in the established balance-history ordering. Effects at or before the anchor are already incorporated and are never applied again. A later observation re-anchors that account. Combined current position is available only when both account positions have authoritative anchors.

This is Balance-history presentation context only. It does not replace or modify dashboard, Available, commitments, reports, salary-cycle, weekly, accounting, or existing reconciliation consumers.

## Ordering, pagination, determinism, and failure

Timeline ordering is business date descending, then the established committed-source/sheet chronology descending, then balance row ID descending. The opaque cursor binds the normalized query, household revision, and final ordering key. Changed query returns `INVALID_CURSOR`; changed revision returns `STALE_BALANCE_HISTORY_QUERY`. Serialization recursively orders object keys and ends with one newline.

The database adapter executes one SELECT batch over `BACKUP_TABLES`; all classification, canonical linkage, reconciliation, ordering, and serialization occur in memory. Invalid input, incomplete inventory, canonical ambiguity, cursor failure, stale revision, injected read failure, and authenticated-route failure perform zero writes.

## Limitations

- Server-only because Step 6 UI authorization was omitted.
- Repository and synthetic fixtures only; no production or representative-copy query was run.
- Typed effects without enough canonical transaction evidence remain unlinked.
- Obligation and Ledger/KTB effects remain unavailable because the accepted schema has no durable cash-counterpart relationship.
- The projection is read-only and deliberately does not switch existing financial consumers.
