# Stage 14 Implementation Task — Guarded Salary Management

## Objective

Starting at exact SHA `fea362e4cb9c5ec52c9e377a2526de49185d4d6a`, implement the owner-accepted `STAGE_14_SALARY_MANAGEMENT_DESIGN.md` as one local candidate. Enable correction, deletion, restoration, and ten-minute undo only for complete newly typed salary transactions whose cash, cycle, reporting, planning, freeze, and reconciliation consequences have one deterministic authoritative result.

This task does not authorize salary replacement, guessed historical attachment, production access or mutation, external migration, merge, deployment, repair, dependency/configuration changes, or Step 15.

## Required sequence

1. Read `AGENTS.md`, the REV1 requirements, master staged specification, Stage 7 shared-protocol decision record/result, Stage 13 result/ledger, accepted salary design, and acceptance record.
2. Verify every manifest hash, starting SHA, and dirty-worktree item. Preserve all pre-existing owner changes and untracked artifacts.
3. Record work continuously in `STAGE_14_IMPLEMENTATION_EXECUTION_LEDGER.md` using `action — exact SHA — exact command/check — observed result`.
4. Re-read all affected source and tests at the exact starting SHA before describing behavior.
5. Add acceptance tests for the complete salary invariant family before or alongside implementation. Never weaken existing authoritative tests merely to pass.
6. Implement the narrow additive schema, creation typing, canonical reconstruction, eligibility/preview, commit operations, cycle/reporting/planning/freeze projections, Worker routing, UI/i18n, and portable recovery required by the accepted design.
7. Run focused tests after each coherent increment and the complete Slice B/C/D regression with the bundled Node runtime supporting `node:sqlite`.
8. Inspect the whole invariant family and final diff.
9. Create one local candidate commit, then rerun the focused and full gates at the exact candidate SHA.
10. Produce `STAGE_14_IMPLEMENTATION_RESULT.md`, the final ledger, and a complete Step 15 ZIP and fresh-chat prompt. Do not begin Step 15.

## Mandatory implementation boundaries

### Typed salary identity

- Add one narrow immutable typed parent/relationship family for newly created salary receipt versions.
- Link every non-zero account receipt and its exact cash-effect row.
- Require same household, salary source, Bangkok business date, unique supported destination accounts, positive safe-integer satang, exact sum, and unique effect ownership.
- Store the transition evidence required by the accepted design, including explicit pre/post planning values when a new managed transition needs future reversal.
- Do not backfill or attach historical rows.
- Create one logical transaction/version/component set for each newly typed salary action.

### Source history and eligibility

- Prove salary classification for the effective business date from durable evidence or refuse `SALARY_SOURCE_HISTORY_UNAVAILABLE`.
- Never infer historical source classification from name coincidence or current configuration alone.
- Keep ambiguous legacy salary items visible and mutation-disabled.

### Projection and immutable evidence

- Reconstruct cycle/source/reporting results from active terminal typed salary versions and preserved factual anchors.
- Never rename or delete a preserved reporting boundary.
- Never update, delete, replace, relabel, or supersede a frozen weekly snapshot.
- Never edit a balance observation.
- Refuse `PRESERVED_REPORTING_BOUNDARY_CONFLICT`, `FROZEN_WEEKLY_SNAPSHOT_CONFLICT`, or `CURRENT_PLANNING_RESET_NOT_REVERSIBLE` whenever the corresponding invariant cannot be proved.
- Never infer `next_salary_date`.

### Operations

- Correction may change date, positive account allocation, and a provably valid salary-class source.
- Deletion appends exact reversing cash effects and a deleted terminal version.
- Restoration recreates the last complete active salary meaning with new facts/effects.
- Undo is server-timed, limited to ten minutes, latest-operation/latest-revision only, and revalidates the full salary invariant.
- All operations retain one logical transaction ID and append immutable versions/audits.
- Salary replacement remains disabled at canonical eligibility and Worker routing.

### Shared protocol and atomicity

- Require authenticated actor, stable request ID, semantic hash, preview/base revision, and terminal version ID.
- Preview is read-only.
- Commit reloads and recomputes authority.
- Same ID/same payload replays the original response; changed payload fails.
- Stale revision/version, dependency, expiry, or SQL failure writes nothing.
- One success atomically writes every fact, relationship, projection, audit, receipt, terminal pointer, and exactly one revision.

### Consumers and recovery

- Dashboard, Transaction history, Balance history, reports, Available, commitments, reconciliation, reload, backup, and restore must use the same terminal interpretation.
- Prevent double application of effects already incorporated into observations.
- Extend portable backup as one complete optional salary schema family and reject partial schema.
- Restore in dependency order and prove canonical plus semantic equivalence, including eligibility and idempotent replay.

## Acceptance matrix

The implementation must turn every test family listed under **Required test matrix before implementation acceptance** in the accepted design into executable evidence. At minimum it must cover:

- Alex-only, Olga-only, and split creation;
- invalid amount/allocation/source/date/household/cardinality/ownership;
- first receipt, second source, repeated source, exact/after boundary, same-day ordering, null and expired boundary;
- correction, deletion, restoration, undo, invalid operation, expiry, later dependency, and replacement refusal;
- cycle membership, active start, reporting assignment, commitments, planning reset, awaiting-salary behavior, frozen weeks, cash/reconciliation, and no double application;
- terminal/audit visibility and deterministic serialization;
- authentication, actor, replay, request conflict, stale revision/version, concurrent requests, lost response, and forced rollback;
- backup integrity, partial-schema refusal, isolated restore, post-restore eligibility, and replay equivalence;
- all existing salary, reporting, history, planning, backup, authentication, management, and full Slice B/C/D regressions.

## Required deliverables

- One local candidate commit.
- `STAGE_14_IMPLEMENTATION_RESULT.md` with starting/candidate SHA, requirement-to-evidence table, changed files, invariant review, limitations, and next owner gate.
- `STAGE_14_IMPLEMENTATION_EXECUTION_LEDGER.md` written as work proceeds.
- `STAGE_15_FULL_BACKUP_RESTORE_EQUIVALENCE_TASK_SPEC.md`.
- `STAGE_15_FRESH_CHAT_PROMPT.md`.
- Step 15 manifest and ZIP containing all controlling and recent evidence documents needed by a fresh chat.

Verdict must be **implemented candidate**, not accepted, migrated, merged, deployed, repaired, or complete, unless the owner separately performs those gates.

## Stop boundaries

Do not pause for progress confirmation. Stop only for a genuine unresolved business rule, an unavoidable conflict with preserved owner work, missing required access/evidence, or a newly discovered invariant that makes the accepted design unsafe. Ask exactly one focused question with exact-SHA evidence when stopped.

