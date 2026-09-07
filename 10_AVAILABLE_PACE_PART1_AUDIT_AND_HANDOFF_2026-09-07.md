# Available Pace Part 1 — Audit and Part 2 Handoff

## Baseline

- Starting SHA: `78ecb21cf45e413f7e25e4d50343b4a9ead142e3`
- Starting branch: `feature/goal-withdrawal-ui-20260906`
- Starting upstream: `origin/feature/goal-withdrawal-ui-20260906`
- Starting worktree: clean; local branch one commit ahead of upstream; no uncommitted user changes
- Part 1 branch: `docs/available-pace-part1-20260907`
- Production Worker: `family-cash-flow-production`
- Production deployment identifier: `d536b765-5992-4b2e-9d7d-add42b3b70d5`
- Production version identifier: `24a6ac54-0af0-4d1b-8587-774524eb4dfa` at 100%
- Production deployment timestamp/source: `2026-09-07T00:27:57.356822Z`, Cloudflare API

## Exact-SHA repository audit

All behavior findings below are from `git show`/`git grep` against the starting SHA, not the mutable worktree. The exhaustive term search found 152 tracked occurrences (excluding lockfiles) of the target/pace terms required by the Part 1 authority.

### Inspected implementation and UI

- `cloudflare/slice-b/src/planning.mjs`
- `cloudflare/slice-b/src/read-model.mjs`
- `cloudflare/slice-b/src/weekly.mjs`
- `cloudflare/slice-b/src/d1-repository.mjs`
- `cloudflare/slice-c/src/salary-cycle.mjs`
- `cloudflare/slice-c/src/weekly-freeze.mjs`
- `cloudflare/slice-c/src/write-actions.mjs`
- `cloudflare/slice-c/src/write-protocol.mjs`
- `cloudflare/slice-d/src/backup.mjs`
- `cloudflare/slice-d/src/weekly-job.mjs`
- `cloudflare/slice-d/tools/portable-restore.mjs`
- `index.html`
- `assets/v24/v24_1_app1.js`
- `assets/v24/v24_1_app3.js`
- `assets/v24/v24_1_app4.js`
- `assets/v24/v24_1_position_pace.css`
- `assets/v24/v24_1_responsive.css`
- `wrangler.production.jsonc`
- `.github/workflows/cloudflare-production-deploy.yml`
- `.github/workflows/production-cutover-pr-checks.yml`

### Inspected tests

- Slice B planning/read-model suites: `live-read-model.test.mjs`, `read-model-unavailability.test.mjs`, `financial-regression.test.mjs`, `history-order.test.mjs`
- Slice C invariant suites: `v3-minimal-acceptance.test.mjs`, `salary-cycle.test.mjs`, `write-actions.test.mjs`, `revision-protocol.test.mjs`, `correction.test.mjs`, `correction-edge.test.mjs`, `repair-run3.test.mjs`
- Frontend suites: `frontend-contract.test.mjs`, `frontend-unavailability-contract.test.mjs`, `phone-ui-contract.test.mjs`
- Slice D persistence/runtime suites: `backup.test.mjs`, `v3-minimal-db-acceptance.test.mjs`, `weekly-job.test.mjs`, `runtime.test.mjs`, `other-income.test.mjs`, `reporting-correction.test.mjs`, `typed-payment.test.mjs`
- Packaging/deployment checks in the two workflow files listed above

### Inspected authoritative references

The project-level `sources/` files were read-only and were not modified. The current authority, implementation plan, acceptance matrix, design-decision handoff, package-review resolution, and cutover record were searched and their target/Available/salary/weekly clauses inspected. In particular:

- `sources/00_Family_Cash_Flow_v3_MINIMAL_Implementation_Authority_REV1_2026-08-23.md`
- `sources/01_Family_Cash_Flow_v3_MINIMAL_Implementation_Plan_REV1_2026-08-23.md`
- `sources/02_Family_Cash_Flow_v3_MINIMAL_Acceptance_Matrix_REV1_2026-08-23.md`
- `sources/04_Family_Cash_Flow_v3_MINIMAL_Package_Review_Resolution_2026-08-23.md`
- `sources/Family_Cash_Flow_v3_Design_Decision_Handoff_2026-08-22.md`
- `sources/Family_Cash_Flow_Cutover_Record_2026-08-15.md`

## Current dependency summary at the starting SHA

1. `planning.mjs` loads the legacy target, emits `target_not_set`, calculates target remaining/exceeded, target/runway/recommended pace, and elapsed target delta. Missing target disables the recommended pace while signed Available remains independently calculated.
2. `weekly.mjs` allocates open weekly `planned` amounts from target remaining and derives closed provisional plans from the cycle target. Frozen rows retain target-plan fields.
3. `read-model.mjs` builds `positionPace` from weekly target-based `planned` plus `variables.recommendedPace`, capped by non-negative Available, and serializes target data through `variables`, `variablesState`, and config.
4. `salary-cycle.mjs` clears the target column during current-only reset and returns `variablesTargetRequired: true` on cycle advance. The required pre-reset weekly freeze ordering is already explicit.
5. `write-actions.mjs` exposes `setVariablesTarget` as a state-changing action and forwards `variablesTargetRequired` from income receipt responses.
6. `index.html` contains a target warning action, Pace target edit control, target drawer, and salary copy promising a target prompt.
7. `v24_1_app1.js`, `v24_1_app3.js`, and `v24_1_app4.js` render target-derived guidance, register the target drawer/form, and place the target prompt before next-salary-date prompt.
8. Current CSS supports the Position pace strip and responsive Pace layout without embedding finance logic; labels/copy and related HTML/JS contracts need updating.
9. Tests positively require target setting, `target_not_set`, target-derived pace, target prompt ordering, and target persistence. Backup/restore also proves legacy target preservation, which must remain while its active planning influence is removed.
10. Payment/transfer safety already uses signed Available rather than target pace; this is regression-sensitive and should remain unchanged.

## Implementation surface for Part 2 (server, writes, persistence contracts)

Expected production-code changes:

- `cloudflare/slice-b/src/planning.mjs`: calculate canonical Available pace and remove target gating/derivations.
- `cloudflare/slice-b/src/weekly.mjs`: allocate current/future open guidance from non-negative Available with deterministic cent reconciliation while preserving closed snapshot data.
- `cloudflare/slice-b/src/read-model.mjs`: serialize one canonical pace object and stop exposing target-derived guidance as active data.
- `cloudflare/slice-c/src/write-actions.mjs`: reject legacy `setVariablesTarget` with the exact unsupported response and zero statements; remove active target-required response behavior.
- `cloudflare/slice-c/src/salary-cycle.mjs`: return no target prompt requirement while retaining freeze-before-reset and dormant column compatibility.

Expected test changes/additions:

- `cloudflare/slice-b/test/live-read-model.test.mjs`
- `cloudflare/slice-b/test/read-model-unavailability.test.mjs`
- `cloudflare/slice-c/test/v3-minimal-acceptance.test.mjs`
- `cloudflare/slice-c/test/salary-cycle.test.mjs`
- `cloudflare/slice-c/test/write-actions.test.mjs`
- `cloudflare/slice-c/test/revision-protocol.test.mjs`
- `cloudflare/slice-c/test/repair-run3.test.mjs`
- `cloudflare/slice-d/test/other-income.test.mjs`
- `cloudflare/slice-d/test/reporting-correction.test.mjs`
- `cloudflare/slice-d/test/v3-minimal-db-acceptance.test.mjs`
- `cloudflare/slice-d/test/backup.test.mjs`
- `cloudflare/slice-d/test/weekly-job.test.mjs`

`cloudflare/slice-c/src/weekly-freeze.mjs`, `cloudflare/slice-b/src/d1-repository.mjs`, migrations, and backup/restore code should normally remain unchanged: they preserve dormant legacy data. Touch them only if a failing acceptance invariant demonstrates a compatibility defect.

## Implementation surface for Part 3 (family UI)

Expected changes:

- `index.html`
- `assets/v24/v24_1_app1.js`
- `assets/v24/v24_1_app3.js`
- `assets/v24/v24_1_app4.js`
- `assets/v24/v24_1_position_pace.css`
- `assets/v24/v24_1_responsive.css` only if layout proof requires it
- `cloudflare/slice-c/test/frontend-contract.test.mjs`
- `cloudflare/slice-c/test/frontend-unavailability-contract.test.mjs`
- `cloudflare/slice-c/test/phone-ui-contract.test.mjs`

The frontend must consume the canonical server object. It must not calculate the daily or weekly money values.

## Part 2 fresh-chat handoff

- Ending SHA: use the exact documentation commit hash reported with this handoff (a commit cannot embed its own hash)
- Branch: `docs/available-pace-part1-20260907`
- Expected worktree after commit: clean
- Decision record: `08_AVAILABLE_PACE_DECISION_RECORD_2026-09-07.md`
- Acceptance design: `09_AVAILABLE_PACE_ACCEPTANCE_MATRIX_2026-09-07.md`
- Audit/implementation map: this file
- Application behavior changed in Part 1: no
- Production mutation: none
- Unresolved issues: none identified in Part 1.
