# REPAIR RUN 3 EXECUTION LEDGER

Date: 24 August 2026 (Asia/Bangkok)

Accepted baseline: `88bfe8fca25bff4964ac8cc79ec47676b7a6470d`

Branch: `v3-minimal-clean-implementation-20260823`

Starting remote head: `b22b5b1997a170d9aed440ac64dfe3aea659f60c`

Code/test evidence head before this ledger-only commit: `275d38a34034dbaeb87a5ee229ed3727a13657f2`

Merge/deploy/production D1/R2/Cloudflare mutation: none

## Authority used

Owner-supplied 24 August 2026 rules for this repair run:

- REV1 Authority §9.12 is amended to include the sixth state `salary_boundary_not_set`; no next salary date may be computed or inferred.
- A relevant unresolved current-cycle correction takes precedence over every other planning-state condition.
- The 24 August expired-boundary decision remains unchanged: at an expired salary boundary `Available to spend` and the commitment breakdown remain live, while target pace, runway pace, recommended pace, and forward target-remaining guidance are unavailable.
- V3-M45 requires an unresolved correction state to be machine-readable and must not allow a conservative safe minimum to be presented under a state implying exactness.
- V3-M25 remains the regression authority for the expired salary boundary.

Repository identity check performed through the GitHub API against the exact branch showed that the committed repository tree contains no REV1 Authority document and no `project_sources/` directory. Therefore this run does not invent a repository-file citation for the 24 August §9.12 amendment; the explicit owner instruction above is the controlling authority for this repair.

Finding 1 is an ordering defect in the owner's 24 August precedence decision. It does **not** reverse or modify the decision itself.

## Repairs

### Finding 1 — `degraded_correction_data` precedence

Files:

- `cloudflare/slice-b/src/planning.mjs`
- `cloudflare/slice-c/test/repair-run3.test.mjs`
- `cloudflare/slice-c/test/frontend-unavailability-contract.test.mjs`

Change:

- `buildPlanningState()` now selects `degraded_correction_data` before `awaiting_salary_receipt`, `salary_boundary_not_set`, `target_not_set`, and `ready` whenever a relevant unresolved current-cycle correction exists.
- Financial arithmetic was not changed. At an expired boundary Available and commitments remain live; only the state/reason/affected-account presentation changes when correction data is degraded.
- New regression coverage exercises all four requested precedence combinations through planning, read model, frontend warning/affected-account contract, one-off payment preview, EF transfer, and Goal transfer.

### Finding 2 — preserve unavailable commitments through serialization/UI

Files:

- `cloudflare/slice-b/src/read-model.mjs`
- `assets/v24/v24_1_app1.js`
- `cloudflare/slice-b/test/read-model-unavailability.test.mjs`
- `cloudflare/slice-c/test/frontend-unavailability-contract.test.mjs`

Change:

- When planner commitments are unavailable, the read model keeps `commitments`, `fixedObligations`, `transferLimits`, payment-safety commitment totals, and current-cycle Goal commitment fields unavailable instead of manufacturing numeric zero or an empty-list fact.
- Factual Accounting remains separately usable: balances, factual EF balance/history, factual Goal saved balance, lifetime target, and factual lifetime remaining still serialize.
- `historical_not_authoritative` no longer attaches current-cycle Goal/EF commitment values to historical Accounting.
- Frontend summary, Goals, EF commitment hint, and required-obligation section render unavailable state explicitly instead of coercing it to zero or “none exist.”

No existing V3-M01–V3-M46 acceptance expectation was edited.

## Fresh verification evidence

### 1. Starting and current branch identity

Observed through GitHub branch API at the start of the run:

```text
v3-minimal-clean-implementation-20260823 -> b22b5b1997a170d9aed440ac64dfe3aea659f60c
```

Observed immediately before this ledger-only commit:

```text
v3-minimal-clean-implementation-20260823 -> 275d38a34034dbaeb87a5ee229ed3727a13657f2
```

### 2. Repair delta

GitHub compare operation:

```text
base = b22b5b1997a170d9aed440ac64dfe3aea659f60c
head = 275d38a34034dbaeb87a5ee229ed3727a13657f2
```

Observed:

```text
status: ahead
ahead_by: 8
behind_by: 0
changed files: 6
```

Changed files observed:

```text
assets/v24/v24_1_app1.js
cloudflare/slice-b/src/planning.mjs
cloudflare/slice-b/src/read-model.mjs
cloudflare/slice-b/test/read-model-unavailability.test.mjs
cloudflare/slice-c/test/frontend-unavailability-contract.test.mjs
cloudflare/slice-c/test/repair-run3.test.mjs
```

`cloudflare/slice-c/test/v3-minimal-acceptance.test.mjs` and `cloudflare/slice-d/test/v3-minimal-db-acceptance.test.mjs` are not in the Repair Run 3 delta.

### 3. Full accepted regression suite + V3-M01 through V3-M46

The local execution environment could not reach `github.com` and did not provide the SQLite runtime required by the DB acceptance cases. The existing read-only PR workflow was therefore used without modifying CI configuration.

Draft validation PR: `#10`, unmerged.

Workflow:

```text
Production cutover PR checks
run: 32706343994
job: 97368154904
```

The PR workflow checked out synthetic merge commit:

```text
6d0b36acd2b38bc0cf2b5dc128c4d8060311cc27
```

The source branch head was:

```text
275d38a34034dbaeb87a5ee229ed3727a13657f2
```

Observed Git tree identity for both commits:

```text
eed334e9b7945e49b5e82cd224ff8024cb33b49d
```

Therefore the workflow executed byte-identical repository contents to the source branch head; the synthetic merge introduced no tree-content difference against accepted baseline `88bfe8f...`.

Exact regression/syntax command block observed in the workflow log:

```sh
set -euo pipefail
(cd cloudflare/slice-b && npm test)
(cd cloudflare/slice-c && npm test)
(cd cloudflare/slice-d && npm test)
find assets -name '*.js' -type f -print0 | xargs -0 -n1 node --check
node --check cloudflare/slice-d/src/index.js
node --check sw.js
node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest','utf8'))"
```

Observed output:

```text
Slice B: tests 17, pass 17, fail 0
Slice C: tests 92, pass 92, fail 0
Slice D: tests 26, pass 26, fail 0
Total Node tests: 135 passed, 0 failed
```

V3 acceptance evidence observed in the same log:

```text
V3-M01 through V3-M21: PASS
V3-M22: PASS
V3-M23 through V3-M40: PASS
V3-M41: PASS
V3-M42: PASS
V3-M43 through V3-M46: PASS
Acceptance total: 46 passed, 0 failed
```

No failure output existed to quote.

### 4. Required earlier-regression protections observed in this fresh run

Observed PASS test names:

```text
V3-M25 — Salary date before receipt is recorded
weekly freeze fills leading, interior, multiple, and trailing gaps without rewriting existing cards
weekly freeze preserves NULL target across every missing gap
salary advance freezes every missing old-cycle card when next salary date is NULL
early repeat salary freezes every missing old-cycle card before v3 current-state reset
V3-M34 — Goal outstanding limit rejection
one-off payment preview uses its distinct payment-safety availability field
salary receipt prompt chain requests Variables target before next salary date
```

The salary-cycle suite also observed:

```text
Salary at the explicit next-salary boundary advances the cycle, resets v3 planning state, and requires target input
```

### 5. Repair-specific regression protections observed in this fresh run

Observed PASS test names:

```text
salary_boundary_not_set preserves unavailable commitments while factual Accounting remains usable
historical_not_authoritative suppresses current-cycle commitments instead of serializing them as historical truth
frontend degraded warning reports affected accounts before ordinary state copy
frontend summary preserves unavailable Goal commitment total instead of rendering zero
frontend Goals render unavailable cycle commitment data explicitly
frontend distinguishes unavailable required obligations from a factual empty obligation list
repair run 3 — degraded correction data precedes awaiting_salary_receipt across read/payment/transfer consumers
repair run 3 — degraded correction data precedes salary_boundary_not_set and keeps authority unavailable
repair run 3 — degraded correction data precedes target_not_set across read/payment/transfer consumers
repair run 3 — degraded correction data precedes ready across read/payment/transfer consumers
```

### 6. Syntax/manifest validation

The syntax/manifest commands are included in the exact workflow command block above. The workflow step `Run all accepted regression tests` completed with `conclusion: success`; there was no syntax or manifest failure output.

### 7. Cloudflare deployment dry run only

Exact command observed:

```sh
npx --yes wrangler@4.123.0 deploy --config wrangler.production.jsonc --dry-run --outdir /tmp/production-dry-run
```

Observed terminal output:

```text
--dry-run: exiting now.
```

No deployment occurred.

### 8. GitHub Actions availability

Existing workflow `.github/workflows/production-cutover-pr-checks.yml` can execute the B/C/D accepted regression suite and syntax checks for this branch when the branch is the head of a pull request targeting `main`.

It is **not** configured to run this suite automatically on a direct push to `v3-minimal-clean-implementation-20260823`.

No CI file was created or modified in Repair Run 3. Draft PR #10 was opened only to trigger the existing read-only validation workflow and must not be merged.

## Scope boundary

No merge performed.

No production deployment performed.

No production D1 mutation performed.

No production R2 mutation performed.

No Cloudflare configuration change performed.
