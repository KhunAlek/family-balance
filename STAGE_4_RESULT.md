# Stage 4 Result

## Verdict

Implemented candidate. This stage is not owner-accepted, merged, deployed, exposed through an API/UI, or run against production or a representative production copy.

## Authorization boundary

The owner accepted the Step 3 candidate and authorized a local internal read-only terminal transaction model, repository/synthetic fixtures, tests, documentation, one candidate commit, and a Step 5 handoff package. No database classification/relationship write, migration, backfill, factual repair, production/representative-copy access, D1/R2 mutation, Cloudflare configuration or dependency change, public API/UI, management mutation, current financial-consumer switch, merge, deployment, or Step 5 implementation occurred.

## Exact revisions

- Starting SHA: `bd369e00b16116c4be2ea70ea325efe6ac96747a`
- Candidate SHA: `9871da3f65240cc565d609cbf4b66162890c5479`
- Candidate commit: `Add canonical terminal transaction read model candidate`

## Implemented scope and evidence

| Requirement | Implementation | Candidate evidence |
|---|---|---|
| Stable canonical DTO | Stable identity, kind/lifecycle/date/version/revision, household descriptions, category, positive satang total, direction, allocations, typed components, explicit creation evidence, audit, reconciliation, and action/refusal fields | DTO shape and reconstruction assertions passed |
| Authoritative terminal chain | Stored terminal pointer selects the latest same-logical-transaction version; every version, audit edge, lifecycle, component, and typed fact is validated | Active, corrected, deleted, crossed, missing, duplicate, orphan, unsupported, and incomplete cases passed |
| Complete typed facts | One-off parents/allocations/effects and income receipts reconstruct from typed identities with same-household/date/kind/sum checks | Multi-account/terminal fixture and repository historical adapter passed |
| Audit-only superseded/deleted material | Active and deleted outputs are separate; superseded versions and management operations occur only in audit evidence | Multi-version/deleted assertions passed; module exposes no financial-total consumer |
| Legacy adaptation | Non-overlapping Step 3 unambiguous groups become read-only canonical DTOs; ambiguity stays separate and mutation-disabled | Repository fixture adaptation/ambiguity test passed |
| Observations and exclusions | Balance observations remain separate; non-transactions are excluded with a count | Separation assertions passed |
| Determinism | Stable ordering plus recursively canonical JSON and one trailing newline | Repeated and reversed table/row input was byte-identical |
| Zero writes | One SELECT per portable-inventory table; all work in memory | Exact table/schema/revision/total-change snapshots unchanged on success, injected read failure, and validation failure |
| Existing financial behavior | No endpoint, UI, writer, migration, consumer, backup inventory, dependency, or configuration changed | Complete Slice B/C/D candidate regression passed 270/270 |

## Candidate files

- `STAGE_4_READ_MODEL_DECISION_RECORD.md`
- `STAGE_4_EXECUTION_LEDGER.md` through pre-candidate verification
- `cloudflare/slice-d/src/terminal-transaction-read-model.mjs`
- `cloudflare/slice-d/test/terminal-transaction-read-model.test.mjs`

The completed ledger, this result, and Step 5 handoff files are post-candidate evidence artifacts so they can name the immutable candidate SHA.

## Exact observed checks at candidate SHA

- Bundled runtime: `/Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`, Node `v24.19.0`.
- Focused Step 4 plus Step 3 preflight, Step 2 schema/portable backup/restore, and Step 1 correction safety: 24 passed, 0 failed.
- Complete Slice B/C/D regression: 270 passed, 0 failed.

## Limitations

- Repository and synthetic fixtures only; no production or isolated representative production backup was read.
- The model is internal and has no history endpoint, filters, totals, cursor, pagination, UI, or enabled mutation.
- Current financial consumers intentionally still use their established factual readers.
- Persisted identities for obligation payments, KTB transfers, EF movements, and Goal movements fail closed until later authorized work supplies complete typed relationships. Their current legacy facts remain explicit Step 3 ambiguities.
- Step 5 must define revision-bound querying and cursor behavior without treating audit rows, deleted rows, reversals, superseded versions, or internal movements as money-in/out totals.

## Next owner gate

Owner acceptance of candidate `9871da3f65240cc565d609cbf4b66162890c5479` and separate authorization are required before Step 5 read-only Transaction history implementation. Running the Step 3 preflight or Step 4 read model against an isolated representative production backup remains a separate authorization gate. Mutation, migration, deployment, merge, and production access remain unauthorized.
