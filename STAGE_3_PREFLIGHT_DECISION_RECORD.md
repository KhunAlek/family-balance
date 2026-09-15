# Stage 3 Preflight Decision Record — Deterministic Historical Classification

**Decision date:** 11 September 2026

**Repository baseline reviewed:** `57752793e8bca797e22a3bf5ab1295888e576b9a`

**Authority:** owner-accepted Step 2 schema candidate and `STAGE_2_SCHEMA_DECISION_RECORD.md` for local Step 3 work

**Status:** local implemented-candidate design; not run against production or a representative production copy

## Decision

Add a read-only classifier over the complete portable-backup table inventory. It issues only `SELECT` statements, builds the report in memory, and returns a canonical JSON serialization. It does not insert identity rows, update typed facts, apply migrations, or expose an API or UI.

## Complete inventory

Every row in the reviewed `BACKUP_TABLES` inventory receives a stable source-item identity from its table's declared primary key. Classification fails closed if a required table is absent, a table value is not an array, a key is missing, a durable source identity is duplicated, a proposed component is absent, ownership is duplicated, or any source item is omitted.

Each source row lands exactly once in one of these classes:

1. a proposed component of an unambiguous logical transaction;
2. an immutable balance observation;
3. non-transaction configuration, planning, reporting, revision, receipt, audit, or identity material;
4. an ambiguous legacy item.

## Evidence hierarchy and classification

Only these evidence forms can establish a proposed logical transaction:

1. an explicitly reviewed authoritative mapping already encoded by migration `0010_historical_one_offs.sql`;
2. a typed parent ID with a complete allocation set and explicit foreign-key component links;
3. a write token encoded in the typed receipt identity that resolves to the same household's durable revision claim.

Dates, amounts, descriptions, accounts, source names, source rows, and adjacency are never grouping evidence. They may be factual fields in source material, but the classifier does not use them to join independent items.

One-off payments are proposed only when their positive typed allocations exist, sum exactly to the typed parent amount, and no more than one explicitly linked balance effect exists. A malformed group is emitted as one ambiguous item per source row so coverage remains exact.

Income-receipt rows are grouped only when their typed receipt IDs contain one common write token, that token resolves to a revision claim in the same household, and the receipt rows identify one source/date action with unique destination accounts. The linked balance row remains an immutable observation rather than a proposed component because Stage 2 reserves `balance_effect` for the explicit typed-payment link.

Obligation payments remain ambiguous because the current schema has no durable link to their cash effect. Ledger movements remain ambiguous because they have no durable link to their KTB counterpart. Similar-looking balance rows are observations and do not resolve either ambiguity.

Balance rows carrying an explicit `one_off_payment_id` are typed payment effects. Every other balance row is an immutable balance observation. Configuration, planning state, frozen weekly reporting, claims, request receipts, legacy correction audit, Step 2 identity material, and management audit are non-transactions.

## Stable identities, reasons, and order

- Source item IDs are `table:key=value` identities with URI-encoded key values in declared primary-key order.
- Proposed logical IDs are namespaced from durable parent IDs or verified write tokens; they contain no runtime values.
- Reason codes are fixed uppercase identifiers in the implementation and are independent of presentation language.
- Evidence objects use stable field order.
- Every output collection is sorted by stable item or logical ID, and every component collection is sorted by stable source-item ID.
- Serialization is exactly `JSON.stringify(report)` followed by one newline. It contains no timestamp, random value, database iteration order, or environment-specific field.

## Zero-write proof design

`runHistoricalPreflight` prepares exactly one `SELECT *` per reviewed table and submits only those statements. Classification and serialization operate on returned in-memory rows. Tests snapshot every table, `PRAGMA schema_version`, `total_changes()`, and household revision before the run and compare them after both success and an injected read failure. Empty Step 2 identity tables are asserted to remain empty.

## Explicit limitations

- The classifier has been exercised only against repository/synthetic fixtures.
- No proposed mapping has been inserted or reviewed against representative household data.
- Obligation cash effects and EF/Goal/KTB counterpart chains remain ambiguous until a later authoritative relationship exists.
- Legacy receipt rows without a verified write-token claim remain ambiguous.
- The report is implementation evidence for a later owner review; it is not a migration plan and grants no mutation eligibility.
