# Stage 15 Full Backup/Restore Equivalence Result

## Verdict

Implemented candidate. This Stage 15 candidate is not owner-accepted, externally restored, migrated, merged, deployed, repaired, or run against representative or production data.

## Exact revisions

- Accepted Stage 14 starting SHA: `242022ba9f8a4739a7b06daaa547856ceeb2e480`
- Stage 15 candidate SHA: `269d51655756e1733a268aac5fdfaa58d5dfa246`
- Candidate commit: `Strengthen portable restore equivalence checks`

## Implemented scope

- Portable-v2 verification now requires exactly the supported 33-table inventory and exact non-negative safe-integer row counts.
- Imported backups must declare SHA-256 and contain no duplicate schema objects.
- The optional salary-management schema is accepted only as one complete table-and-five-trigger family with the complete transaction-identity family.
- Rehashed backups still fail closed when transaction/version/component/audit relationships are orphaned or crossed, the terminal is not the latest version, audit adjacency disagrees, or lifecycle disagrees with the terminal operation.
- Restore SQL is not generated for any failed integrity specimen.
- No recovery subsystem, schema migration, financial semantic change, dependency, or configuration change was introduced.

## Requirement-to-evidence map

| Requirement | Candidate evidence |
|---|---|
| Canonical terminal and audit equivalence | Per-family isolated restore tests compare the complete canonical model, active/deleted terminal state, components, ordered audits, eligibility, and exact stored-response replay before and after restore. Canonical shuffled-input tests prove byte-stable serialization. |
| Balances and reconciliation | One-off, income, KTB, fund, salary, Balance-history, and v3 planning tests preserve per-account/combined balances, observation anchoring, partial authority, and no double application. |
| Commitments and salary state | Obligation and fund management restore tests preserve terminal completion; v3 and salary suites preserve current planning, `awaiting_salary_receipt`, active cycle/source membership, reporting boundaries, and `next_salary_date`, including `NULL`. |
| Immutable observations | Salary and weekly-freeze suites compare preserved weekly snapshots, balance observations, and reporting boundaries and prove their triggers/write paths remain immutable. |
| Hash/count/partial-schema failures | Backup tests reject wrong algorithms, broken row counts, unsupported extra table inventory, changed payload/schema hashes, and a rehashed partial salary family. |
| Orphan/crossed/projection failures | Backup tests rehash damaged version ownership, terminal ownership, and lifecycle projection specimens; verification rejects each before restore SQL generation. |
| Full regression | Pre-candidate Slice B/C/D run: 327 passed, 0 failed. Exact-candidate results are recorded in the execution ledger. |

## Changed files

- `cloudflare/slice-d/src/backup.mjs`
- `cloudflare/slice-d/test/backup.test.mjs`
- `STAGE_15_EXECUTION_LEDGER.md`
- `STAGE_15_RESULT.md`
- `STAGE_16_PHONE_DESKTOP_EN_RU_COMPLETION_TASK_SPEC.md`
- `STAGE_16_FRESH_CHAT_PROMPT.md`

## Limitations and owner gate

Evidence uses repository fixtures and isolated in-memory SQLite only. No representative or production backup was accessed, and no external restore or migration was attempted. Explicit owner acceptance of the exact Stage 15 candidate is required before it is accepted or before Stage 16 work begins. Merge, deployment, representative/production access, external D1/R2 mutation, migration, factual repair, dependency/configuration changes, and salary replacement remain separately gated.
