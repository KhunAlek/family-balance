# Stage 4 Read-Model Decision Record — Canonical Terminal Transactions

**Decision date:** 11 September 2026

**Repository baseline reviewed:** `bd369e00b16116c4be2ea70ea325efe6ac96747a`

**Authority:** owner-accepted Step 3 candidate and `STAGE_3_PREFLIGHT_DECISION_RECORD.md` for local Step 4 work

**Status:** local implemented-candidate design; read-only and not run against production or a representative production copy

## Decision

Add one internal, SELECT-only canonical read model over the same complete portable-backup inventory as the Step 3 preflight. It resolves persisted Step 2 identities through the authoritative terminal pointer, validates every version/component/audit relationship, and adapts non-overlapping Step 3 historical groups without persisting them. It exposes no route or UI and replaces no existing accounting, dashboard, Available, commitment, reporting, or weekly consumer.

## Canonical output

The model format is `family-cash-flow-terminal-transactions-v1`. It contains separately ordered active transactions, deleted transactions, ambiguous legacy items, and balance observations, plus a count-only non-transaction exclusion summary.

Every transaction DTO has stable fields for:

- logical identity and whether it came from persisted identity material or the historical adapter;
- kind, lifecycle, Bangkok business date, terminal version/operation, and committed revision;
- description, source, payee, category, positive total satang, direction, and sorted account allocations;
- sorted typed component kinds, identities, and roles;
- complete creation evidence or explicit `not_recorded` null fields;
- an ordered management-audit summary;
- reconciliation state;
- all management actions disabled with stable refusal code `MANAGEMENT_NOT_ENABLED_STEP_4`.

Ambiguous legacy entries remain separate and carry their Step 3 reason/evidence plus `AMBIGUOUS_LEGACY_ITEM`; they never become transaction DTOs. Balance observations remain separate. Non-transactions remain excluded.

## Resolution and failure contract

The persisted terminal pointer is authoritative. The reader requires:

- one unique logical identity and terminal pointer;
- contiguous version numbers beginning at one, with the terminal pointer naming the latest same-transaction version;
- creation semantics on version one and one exact adjacent audit relationship for every later version;
- lifecycle agreement with the terminal operation;
- every component attached to a resolved version and globally owned once;
- complete typed factual reconstruction for every version, including same-household ownership, kind/date agreement, positive amounts, exact one-off allocation sums, unique receipt destinations, and valid typed balance-effect links;
- no orphan or duplicate version, component, or audit row;
- no partial overlap between a persisted identity and a Step 3 historical group.

Failures throw `TerminalTransactionReadError` with a stable uppercase code. Current durable typed relationships support complete reconstruction for one-off payments, other-income receipts, and salary receipts. Other identity kinds fail closed as `UNSUPPORTED_TRANSACTION_KIND` until their complete typed relationships exist; their legacy rows remain Step 3 ambiguities.

## Financial interpretation

Only active terminal DTOs appear in `activeTransactions`. Deleted terminal DTOs are audit-visible in `deletedTransactions`. Superseded versions and management rows appear only within audit evidence and are never emitted as financial transactions. The module calculates no dashboard/report total and is not connected to any existing financial consumer, preventing it from becoming a second accounting source during Step 4.

## Determinism and zero writes

All input collections, component collections, allocations, audit chains, and output groups are ordered by stable persisted identities. Serialization recursively orders object keys and is exactly one JSON value followed by a newline. It contains no clock, randomness, or environment value.

The database adapter submits exactly one `SELECT *` for each reviewed backup table in one batch. All validation, reconstruction, adaptation, ordering, and serialization occur in memory. Tests snapshot every table, schema version, total changes, and household revision before success, injected read failure, and validation failure.

## Explicit limitations

- This is an internal local model with no public read API, pagination, filters, UI, or enabled mutation.
- It has been exercised only against repository and synthetic fixtures.
- It has not been run against production or an isolated representative production backup.
- Current accounting/reporting consumers intentionally remain unchanged in Step 4.
- Obligation, KTB transfer, EF, and Goal identities cannot become canonical transactions until later authorized schema/work proves their complete typed relationships.
