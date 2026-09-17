# Stage 2 Result

## Verdict

Implemented candidate. This stage is not owner-accepted, merged, migrated, or deployed.

## Authorization boundary

The owner authorized a reviewed schema decision record, local additive migration, schema/backup/restore compatibility code, tests, documentation, one local candidate commit, and the Step 3 handoff package. No production or representative-production access, D1/R2 mutation, Cloudflare configuration change, dependency change, merge, deployment, historical classifier/backfill, UI/API management enablement, or accounting repair was performed.

## Exact revisions

- Starting SHA: `7574ce7f5e4b9e87131fe68254fdee42c6a0f0cc`
- Candidate SHA: `57752793e8bca797e22a3bf5ab1295888e576b9a`
- Candidate commit: `Add transaction identity schema candidate`

## Implemented scope and evidence

| Requirement | Implementation | Candidate evidence |
|---|---|---|
| Reviewed design precedes migration | `STAGE_2_SCHEMA_DECISION_RECORD.md` fixes exact tables, constraints, indexes, triggers, atomic order, backup order, and ambiguity policy | Ledger records decision review before migration creation |
| Additive identity model | Migration `0013_transaction_identity.sql` adds logical transactions, immutable versions/components, lifecycle/terminal pointer, and immutable management audit | Fresh/upgrade tests passed; migration has no historical DML or accounting amount/balance columns |
| Enforced semantics | Checks, composite/deferred foreign keys, sequence and consistency triggers, and update/delete denial enforce identity, adjacency, terminal/lifecycle, component uniqueness, actor/request/hash/revision, and audit/version agreement | Valid graph and invalid/rollback/immutability tests passed |
| Preserve existing facts | Upgrade snapshots every pre-identity factual/configuration/planning/audit table before/after migration | Rows remained byte-for-byte equal; all new tables empty; foreign-key check clean |
| No guessed backfill | Migration creates schema objects only | Zero logical/version/component/audit rows after upgrade |
| Portable recovery | Backup inventory and completeness validation cover all four tables; restore uses one transaction for deferred cycles | Synthetic two-version graph, components, audit, triggers, and foreign keys round-tripped exactly |
| Step 1 and financial behavior unchanged | No correction/UI/write-action changes | Full Slice B/C/D candidate suite passed 258/258, including disabled correction zero-write cases |

## Changed files in candidate

- `STAGE_2_SCHEMA_DECISION_RECORD.md`
- `STAGE_2_EXECUTION_LEDGER.md`
- `cloudflare/slice-d/migrations/0013_transaction_identity.sql`
- `cloudflare/slice-d/src/backup.mjs`
- `cloudflare/slice-d/tools/portable-restore.mjs`
- `cloudflare/slice-d/test/backup.test.mjs`
- `cloudflare/slice-d/test/transaction-identity.test.mjs`

## Observed tests at exact candidate SHA

- Bundled runtime: `/Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`, Node `v24.19.0`.
- Focused schema/backup/restore: 6 passed, 0 failed.
- Complete Slice B/C/D regression: 258 passed, 0 failed.

## Limitations and deferred work

- The migration has not been run against production or a representative production copy.
- No existing factual row has a logical identity. Ambiguous and all other legacy facts remain unlinked and mutation-disabled.
- Polymorphic component identities cannot have direct SQL foreign keys to heterogeneous typed tables. Stage 2 constrains kind/role and global component ownership; a later authorized classifier/writer must validate typed existence using durable evidence before insertion.
- No canonical terminal read model, history UI, classifier, correction/delete/restore/undo protocol, or management endpoint is included.
- Backup/restore proves exact schema and relationship recovery for synthetic identity rows; full cross-family equivalence remains a later stage.

## Next owner gate

The owner must review and accept the schema candidate at `57752793e8bca797e22a3bf5ab1295888e576b9a` before Step 3 uses it as authority. Step 3 may then implement a deterministic zero-write historical preflight locally. Running that preflight against an isolated representative production backup requires separate explicit authorization.

