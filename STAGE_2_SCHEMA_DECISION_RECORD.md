# Stage 2 Schema Decision Record — Logical Transaction Identity

**Decision date:** 11 September 2026

**Repository baseline reviewed:** `7574ce7f5e4b9e87131fe68254fdee42c6a0f0cc`

**Authority:** owner-accepted `15_TRANSACTION_HISTORY_AND_CORRECTION_SPECIFICATION_REV1_2026-09-11.md` for local Step 2 implementation only

**Status:** reviewed design preceding migration code; local candidate, not accepted or deployed

## Decision

Add four relationship-only tables in migration `0013_transaction_identity.sql`. Existing typed factual tables remain the only accounting source. The identity tables contain no amount, balance, category, description, account balance, or computed financial-total columns.

## Tables, keys, and indexes

### `logical_transactions`

- `logical_transaction_id TEXT PRIMARY KEY`
- `household_id TEXT NOT NULL` → `households(household_id)`
- `lifecycle_status TEXT NOT NULL CHECK IN ('active','deleted')`
- `terminal_version_id TEXT`, initially nullable only to permit ordered atomic creation; a guarded trigger validates every non-null pointer against a version belonging to this logical transaction.
- Nullable creation evidence: `created_actor_email`, `created_at_utc`, `creation_request_id`, `creation_write_token`, and `creation_committed_revision`. A check requires either all five to be null for historical material or all five to be present, non-blank, and have a positive revision for newly created identities.
- `FOREIGN KEY(logical_transaction_id,terminal_version_id)` → the composite version identity. This is deferred to the end of the transaction so the parent identity can precede its first version.
- Index: `(household_id,lifecycle_status,logical_transaction_id)`.

The logical ID and household are immutable. Lifecycle and terminal pointer are authoritative mutable state, but may change only together to a version of the same logical transaction. The terminal pointer is the sole terminal-version authority and is updated in the same atomic batch as a new version and audit operation. A committed transaction may not return to a null terminal pointer.

The terminal version must advance by exactly one. A `deleted` lifecycle must point to a `deleted` version; an active lifecycle may not point to a `deleted` version. An audit insertion trigger also requires its prior/result versions to be adjacent and requires the resulting version's operation type, management-operation ID, and committed revision to match the audit row.

### `logical_transaction_versions`

- `version_id TEXT PRIMARY KEY`
- `logical_transaction_id TEXT NOT NULL` → `logical_transactions`
- `version_number INTEGER NOT NULL CHECK > 0`
- `kind TEXT NOT NULL` constrained to `one_off_payment`, `other_income_receipt`, `obligation_payment`, `ktb_transfer`, `ef_movement`, `goal_movement`, or `salary_receipt`
- `business_date TEXT NOT NULL` constrained to canonical `YYYY-MM-DD`; it is the effective Bangkok business date.
- `committed_revision INTEGER NOT NULL CHECK > 0`
- `operation_type TEXT NOT NULL` constrained to `created`, `corrected`, `deleted`, `restored`, `replaced`, or `undone`
- `management_operation_id TEXT`; null exactly for `created`, mandatory and non-blank otherwise.
- Unique `(logical_transaction_id,version_number)` and `(logical_transaction_id,version_id)`.
- Deferred foreign key from `(logical_transaction_id,management_operation_id)` to the matching management audit. The deferred cycle lets a future D1 batch insert the version and its immutable audit row before commit without weakening either relationship.
- Index: `(logical_transaction_id,version_number)` is supplied by the unique constraint; a second index covers `(kind,business_date,logical_transaction_id)` for later canonical reads.

Versions are append-only. A trigger rejects every update and delete. Version numbers are positive and unique; an insert trigger requires version 1 for the first version and exactly `MAX(version_number)+1` thereafter.

### `logical_transaction_components`

- Composite primary key: `(version_id,component_kind,component_id,component_role)`.
- `version_id TEXT NOT NULL` → `logical_transaction_versions`
- `component_kind TEXT NOT NULL` constrained to `one_off_payment`, `one_off_payment_allocation`, `balance_effect`, `income_receipt`, `obligation_payment`, or `ledger_movement`.
- `component_id TEXT NOT NULL` is the durable typed factual identity, not a guessed description/date/amount match.
- `component_role TEXT NOT NULL` constrained to `primary`, `allocation`, `cash_effect`, `receipt`, `obligation_effect`, `source_effect`, `destination_effect`, or `fund_effect`.
- Unique `(component_kind,component_id)` prevents any typed factual component from being attached to multiple versions.
- Index: `(component_kind,component_id)` is supplied by the unique constraint.

The generic typed identity is necessary because existing factual tables use heterogeneous primary keys, including integer balance/Ledger IDs and composite allocation identities. Stage 2 does not add links or infer any identity. Later authorized writers/preflight must construct a stable `component_id` from durable typed evidence and validate the referenced factual row before insertion. Component rows are append-only; update and delete triggers reject retargeting or removal.

Balance observations are never components. The `balance_effect` kind is reserved for transaction-created balance-effect rows explicitly identified by a typed payment link; it must not be used for unlinked observations.

### `transaction_management_audit`

- `operation_id TEXT PRIMARY KEY`
- `operation_type TEXT NOT NULL` constrained to `corrected`, `deleted`, `restored`, `replaced`, or `undone`
- `logical_transaction_id TEXT NOT NULL`
- `prior_version_id TEXT NOT NULL`
- `resulting_version_id TEXT NOT NULL`
- `actor_email TEXT NOT NULL`, non-blank
- `committed_at_utc TEXT NOT NULL`, canonical UTC timestamp ending in `Z`
- `reason_code TEXT NOT NULL`, non-blank; `reason_explanation TEXT` optional
- `request_id TEXT NOT NULL`, non-blank
- `semantic_payload_hash TEXT NOT NULL`, exactly 64 lowercase hexadecimal SHA-256 characters
- `preview_base_revision INTEGER NOT NULL CHECK >= 0`
- `committed_revision INTEGER NOT NULL CHECK = preview_base_revision + 1`
- `write_token TEXT NOT NULL`, non-blank
- `impact_summary_json TEXT NOT NULL`, valid JSON for audit display only; it is never an accounting source.
- Foreign keys require the logical ID, prior version, and resulting version all to belong to the same logical transaction.
- Unique `(logical_transaction_id,operation_id)`, `(logical_transaction_id,request_id)`, and `(logical_transaction_id,write_token)`.
- Index: `(logical_transaction_id,committed_revision,operation_id)`.

Audit rows are append-only. Update and delete triggers reject changes. The audit row and non-created resulting version reference each other with deferred foreign keys, ensuring a complete operation relationship at transaction commit. `created` is represented by version creation evidence rather than a management-audit row.

## Future atomic write order

Within the existing revision-claim batch, a future authorized transaction-management writer will use this order:

1. insert the `financial_write_claims` row;
2. for a new logical transaction, insert `logical_transactions` with null terminal pointer and complete new-creation evidence;
3. insert the next immutable `logical_transaction_versions` row;
4. insert all new typed factual rows and their immutable component links;
5. for management operations, insert the immutable `transaction_management_audit` row;
6. update only `logical_transactions.lifecycle_status` and `terminal_version_id` to the new same-transaction version;
7. insert the applicable semantic request receipt and response;
8. increment `household_revisions` exactly once.

Deferred foreign keys are checked at batch commit. Any failure rolls back the claim, identity, factual rows, components, audit, receipt, terminal pointer, and revision together. Stage 2 adds no endpoint or writer using this sequence.

## Immutability enforcement

- Versions, components, and management audits reject all `UPDATE` and `DELETE` statements.
- Logical transaction identity, household, and creation evidence reject changes.
- Logical transactions reject deletion and reject clearing a committed terminal pointer.
- A terminal pointer must identify a version of the same logical transaction. The lifecycle is allowed to change only as part of a terminal-pointer advance to a different same-transaction version.
- Existing factual-table immutability and the Step 1 correction gate remain unchanged.

## Backup and restore

Portable backup inventory appends the new tables in dependency order:

1. `logical_transactions`
2. `logical_transaction_versions`
3. `logical_transaction_components`
4. `transaction_management_audit`

Because logical transactions/versions/audits intentionally form deferred relationship cycles, isolated schema restore creates all schema objects first and then inserts rows inside one explicit transaction. Deferred checks run at commit, followed by `PRAGMA foreign_key_check`. The backup verifier requires either all four identity tables or none for compatibility with older portable backups; a partial identity schema is invalid.

## Fresh schema and additive upgrade

Fresh schema applies migrations `0001` through `0013`. Upgrade applies only `0013` after the complete Stage 1 schema. Migration `0013` contains `CREATE TABLE`, `CREATE INDEX`, and `CREATE TRIGGER` statements only: no `INSERT`, `UPDATE`, `DELETE`, `ALTER TABLE`, or historical mapping statement. Therefore every pre-existing accounting, configuration, planning, claim, receipt, and audit row remains byte-for-byte unchanged.

The four new tables are empty immediately after upgrade. Existing facts remain unlinked, separately displayable by later read work, and mutation-disabled by the Step 1 fail-closed gate. Historical classification and linkage are explicitly deferred to Step 3 and later separately authorized gates.
