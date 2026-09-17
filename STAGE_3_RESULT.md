# Stage 3 Result

## Verdict

Implemented candidate. This stage is not owner-accepted, merged, deployed, or run against production or a representative production copy.

## Authorization boundary

The owner authorized a deterministic read-only historical preflight using local repository/synthetic fixtures, tests, documentation, one local candidate commit, and a Step 4 handoff package. No classification or relationship was written to a database. No migration, backfill, factual repair, UI/API enablement, transaction-management mutation, dependency change, Cloudflare configuration change, D1/R2 mutation, merge, deployment, production access, representative-copy access, or Step 4 implementation occurred.

## Exact revisions

- Starting SHA: `57752793e8bca797e22a3bf5ab1295888e576b9a`
- Candidate SHA: `bd369e00b16116c4be2ea70ea325efe6ac96747a`
- Candidate commit: `Add deterministic historical preflight candidate`

## Implemented scope and evidence

| Requirement | Implementation | Candidate evidence |
|---|---|---|
| Complete exact inventory | Every row in the portable-backup inventory receives a stable primary-key source identity and exactly one classification | Coverage test and malformed/duplicate inventory tests passed |
| Durable grouping only | Reviewed legacy mapping, typed parent/foreign keys, or a verified write token plus revision claim can form a proposed group | Typed and legacy grouping tests passed; similarity-only test remained ambiguous |
| Stable output | Stable logical/source IDs, fixed reason codes, sorted collections/evidence, no runtime values, exact newline-terminated JSON | Repeated and reversed table/row input produced byte-identical serialization |
| Explicit ambiguity | Missing receipt parent, obligation cash-effect link, and Ledger counterpart link remain named, separate, and without proposed mappings | Repository fixture emitted 13 explicit ambiguous source items |
| Separate observations | Unlinked balance rows are immutable observations; only explicit one-off payment links produce proposed balance-effect components | Observation/component disjointness test passed |
| Zero writes | Database runner issues only one `SELECT *` per reviewed table; classification/serialization are in memory | Every table, schema version, total changes, revision, and empty identity tables were unchanged after success and injected failure |
| Existing safety/schema/recovery | Step 1 correction gate and Step 2 schema/portable restore remain intact | Focused candidate gate passed 19/19; complete Slice B/C/D passed 265/265 |

## Changed files in candidate

- `STAGE_3_PREFLIGHT_DECISION_RECORD.md`
- `STAGE_3_EXECUTION_LEDGER.md`
- `cloudflare/slice-d/src/historical-preflight.mjs`
- `cloudflare/slice-d/test/historical-preflight.test.mjs`

## Repository-fixture report

The fully migrated synthetic/repository fixture produced 148 source items:

- 5 unambiguous logical transactions;
- 11 proposed components owned by those transactions;
- 69 immutable balance observations;
- 55 non-transaction items;
- 13 ambiguous legacy items: 2 receipts without a durable parent, 8 obligation payments without a cash-effect relationship, and 3 Ledger movements without a KTB-counterpart relationship.

These are fixture results only and must not be treated as representative-production findings.

## Observed tests at exact candidate SHA

- Bundled runtime: `/Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`, Node `v24.19.0`.
- Focused preflight, Step 2 schema/backup/restore, and Step 1 correction safety: 19 passed, 0 failed.
- Complete Slice B/C/D regression: 265 passed, 0 failed.

## Limitations

- The preflight has not been run against production or an isolated representative production backup.
- Proposed mappings have not been reviewed against representative household data and have not been inserted anywhere.
- Current durable evidence cannot link legacy obligation payments or Ledger movements to their cash counterparts.
- Receipt rows without a verified write-token revision claim remain ambiguous.
- The classifier is an internal local module only; there is no history endpoint, canonical transaction DTO, UI, or mutation path.

## Next owner gate

Running the preflight against an isolated representative production backup requires separate explicit owner authorization. Step 4 canonical read-model implementation also requires owner acceptance of this candidate and separate authorization; it must consume classifications without writing them or enabling history UI/read APIs or transaction management unless separately authorized.
