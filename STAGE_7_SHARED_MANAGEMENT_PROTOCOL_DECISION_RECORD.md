# Stage 7 Shared Management Protocol Decision Record

**Decision date:** 11 September 2026

**Repository baseline reviewed:** `ca37a16c7c24f090f68baa12c5ee7333e2aecba3`

**Authority:** owner-accepted Step 6 candidate and `STAGE_6_BALANCE_HISTORY_DECISION_RECORD.md` for local Step 7 work

**Status:** local implemented-candidate design; all transaction families remain mutation-disabled

## Decision

Add authenticated same-origin `transactionManagementPreview` and `transactionManagementCommit` actions over canonical persisted logical transaction IDs. Preview reloads the complete portable inventory and canonical terminal model, returns the authoritative household revision and terminal version plus a correlation ID, and performs no writes. Commit requires a stable request ID, semantic payload, preview base revision, terminal version, and authenticated actor.

No schema migration is required. The accepted `new_function_request_receipts` table already carries household/request identity, action, semantic hash, committed revision, and exact response JSON and is already in portable backup/restore. Step 7 reuses it without changing schema.

## Public eligibility

Every transaction family and every operation remains disabled with stable refusal `MANAGEMENT_NOT_ENABLED_STEP_7`. The public commit action has no component writer or enablement switch. Historical-adapter identities and ambiguous items remain ineligible. Balance observations retain their separate immutable refusal.

Tests exercise the shared assembler only through explicitly named synthetic-only callbacks passed directly to the internal function. The Worker route never supplies those callbacks, so it cannot enable a family.

## Request and stale contract

The semantic hash covers the action, logical transaction ID, operation, preview base revision, preview terminal version, and recursively canonicalized semantic payload. A committed receipt is checked before current-state validation, so an exact lost-response retry returns the stored response even after the revision and terminal pointer advance. Reusing a request ID with different semantics returns `REQUEST_ID_CONFLICT`.

Without a receipt, commit reloads the complete canonical authority. Revision mismatch returns `STALE_MANAGEMENT_REVISION`; terminal mismatch returns `STALE_TERMINAL_VERSION`; family eligibility is then re-evaluated. All occur before a financial write claim.

## Atomic assembly and concurrency

An enabled later family must provide complete new typed factual statements and component identities. The shared batch order is: revision claim; new factual rows; immutable version; immutable components; immutable management audit; terminal/lifecycle update; request receipt; household revision. IDs are stable functions of logical transaction and request ID. The audit and receipt share the semantic hash, request ID, revision, actor, UTC time, and write token.

The existing unique `(household_id, base_revision)` claim excludes two writers from one revision. D1 batch failure rolls back the claim, facts, version, components, audit, terminal pointer, receipt, and revision. Exact-request races replay the winner through the accepted receipt protocol.

## Recovery and consumer isolation

Portable backup/restore already includes every protocol table and preserves exact receipts, identity chains, triggers, and revision state. Restored preview eligibility and exact replay are verified. No dashboard, Available, commitments, reports, salary-cycle, weekly, accounting, reconciliation, Transaction history, or Balance history consumer is switched.

## Limitations

- Repository and synthetic fixtures only; no production or representative-copy access.
- No transaction family writer or dependency rule is enabled.
- The internal assembler requires each later family to prove its own typed factual plan, eligibility, reversal/correction behavior, and impact summary.
- No UI is added.
