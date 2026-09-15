# Stage 15 Task — Full Backup/Restore Equivalence

## Objective

Starting from the exact owner-accepted Stage 14 candidate SHA, review and prove portable backup plus isolated restore equivalence across every implemented transaction family. Do not introduce a new recovery subsystem or change financial meaning.

## Required sequence

1. Read repository `AGENTS.md`, the accepted REV1/master specifications, Stage 7 protocol record, Stage 13 evidence, the accepted Stage 14 design, and Stage 14 implementation result/ledger/recovery notes.
2. Verify the Step 15 package manifest, exact starting SHA, and dirty worktree. Preserve all owner changes and artifacts.
3. Maintain `STAGE_15_EXECUTION_LEDGER.md` live using `action — exact SHA — exact command/check — observed result`.
4. Inventory every portable table, column, trigger, relationship, request receipt, audit, revision claim, and dependency order at the exact starting SHA.
5. Add or strengthen isolated tests proving byte-stable canonical serialization and semantic equivalence before/after restore for active/deleted terminal transactions, audits, reconciliation, eligibility/refusals, balances, commitments, salary/reporting assignments, frozen observations, and replay responses.
6. Prove partial-schema, hash/count, orphan, crossed relationship, and projection-disagreement failures are fail-closed.
7. Run focused recovery suites and complete Slice B/C/D regression, review the full invariant family, create one local candidate commit, re-run checks at its exact SHA, and prepare Step 16 handoff.

## Boundaries

No representative or production access, external backup/restore, D1/R2 mutation, migration application outside isolated memory, historical attachment/repair, accounting reinterpretation, dependency/configuration change, merge, deployment, salary replacement, or Step 16 implementation is authorized. Ask exactly one focused owner question only if required evidence or a material business rule is genuinely unavailable.

## Required deliverables

- One local Stage 15 candidate commit.
- `STAGE_15_RESULT.md` and live `STAGE_15_EXECUTION_LEDGER.md`.
- Requirement-to-evidence map, exact commands/results, limitations, and owner gate.
- Complete Step 16 task spec, fresh-chat prompt, manifest, and ZIP.

Verdict is **implemented candidate** unless and until the owner explicitly accepts it.
