# Available Pace Acceptance Matrix

**Authority:** `08_AVAILABLE_PACE_DECISION_RECORD_2026-09-07.md`
**Design baseline:** `78ecb21cf45e413f7e25e4d50343b4a9ead142e3`
**Rule:** these cases replace target-based expectations only where the decision record supersedes them. All unrelated regression coverage remains mandatory.

| ID | Invariant and setup | Required observation | Intended proof surface |
|---|---|---|---|
| AP-01 | Positive signed Available; active cycle; future salary boundary | Daily pace is `max(Available, 0) /` inclusive remaining Bangkok runway days, rounded only for display | planning unit test |
| AP-02 | Current guidance window ends before Sunday | Through-Sunday pace uses today through cycle end, inclusively | planning/weekly unit test |
| AP-03 | Current guidance window reaches Sunday before cycle end | Through-Sunday pace uses today through Sunday, inclusively | planning/weekly unit test |
| AP-04 | Today is midweek | Current window begins today, never Monday | planning/weekly unit test |
| AP-05 | Positive pace base distributed across current and future open cards | Open amounts sum to pace base to `0.01 THB`; deterministic remainder is on final open card | weekly unit test |
| AP-06 | Change only a dormant non-null Variables target | Available, daily pace, weekly pace, canonical read model, and rendered UI values are identical | planning/read/UI tests |
| AP-07 | Compare null and non-null legacy target with all other state identical | Forward pacing and planning availability are identical; neither emits `target_not_set` | planning/read tests |
| AP-08 | Available is negative | Signed Available remains negative; daily and weekly pace serialize and render as exactly zero | planning/read/UI tests |
| AP-09 | Available is zero | Signed Available and both pace figures are exactly zero, not unavailable | planning/read/UI tests |
| AP-10 | Today is the last runway day; positive Available | Remaining days is one; daily and weekly pace equal positive Available | planning/read test |
| AP-11 | Recorded salary boundary is today/past; no qualifying receipt | `awaiting_salary_receipt`; Available and commitments live; canonical pace unavailable; no invalid denominator | planning/read/UI tests |
| AP-12 | Salary boundary missing or invalid | Existing authoritative unavailable state remains; no pace object is manufactured | planning/read/UI tests |
| AP-13 | Qualifying salary receipt advances cycle | Receipt writes and transition persist; missing closed snapshots freeze before reset; `next_salary_date` becomes `NULL`; no Variables-target response/prompt | salary/write/DB tests |
| AP-14 | Next-salary-date flow succeeds after salary receipt | Flow never invokes Variables-target prompt and pace resumes from Available once boundary is valid | frontend/write contract tests |
| AP-15 | Direct legacy `setVariablesTarget`, including retry | Validation is exactly `Variables target is no longer supported`; zero statements/writes/revision effects | write/revision/DB tests |
| AP-16 | Existing frozen weekly rows before and after target retirement | Rows remain byte/value equivalent; no mutation or rewrite | weekly-freeze/DB tests |
| AP-17 | Factual Variables spending changes through factual balance/flow data | It remains factual reporting only and never reserves Available or changes pace except through the real balance | planning/reporting tests |
| AP-18 | Payment and transfer safety across positive/zero/negative Available | Safety continues to use signed Available and established commitment semantics; pace never gates validity | financial-write regression tests |
| AP-19 | Read model serialized, reconstructed, backed up, and restored with legacy fields | Available pace semantics survive; legacy fields remain compatible but dormant | read-model/backup/restore tests |
| AP-20 | Phone and desktop assets | No active Variables-target controls, prompts, warnings, or copy; Position strip and Available pace screen meet the decision record | frontend static/rendered contracts |
| AP-21 | Closed legacy weekly plan fields and any historical presentation | No target-derived field is shown as current or historical household guidance | read/UI contracts |
| AP-22 | Position and Pace render the same response | Both consume one canonical server-side Available-based pace object; no frontend finance calculation | read/frontend contracts |
| AP-23 | Fractional-cent distribution, including multiple open cards | Daily/weekly use unrounded proportions; final values round to cents; weekly never exceeds pace base; open cards reconcile deterministically | planning/weekly unit tests |
| AP-24 | Retry, correction, ordering, salary transition, weekly freeze, and restore variants | Existing idempotency and factual ordering remain intact; correction-driven balance/commitment changes recalculate pace from reconstructed Available only | cross-suite regression tests |

## Required state partitions

Every implementation verdict must cover valid creation, invalid creation, mutation rejection, retry/idempotency, reversal/correction where applicable, ordering, serialization, restore, salary transition, weekly freeze, and read-model reconstruction. Zero pace and unavailable pace are separate states and must never share an ambiguous serialized representation.
## Superseded acceptance expectations

At implementation time, replace—not weaken—the target-dependent expectations currently found in `cloudflare/slice-b/test/live-read-model.test.mjs`, `cloudflare/slice-c/test/v3-minimal-acceptance.test.mjs`, `cloudflare/slice-c/test/salary-cycle.test.mjs`, `cloudflare/slice-c/test/write-actions.test.mjs`, `cloudflare/slice-c/test/frontend-unavailability-contract.test.mjs`, `cloudflare/slice-c/test/phone-ui-contract.test.mjs`, `cloudflare/slice-d/test/other-income.test.mjs`, and `cloudflare/slice-d/test/v3-minimal-db-acceptance.test.mjs`. Preserve unrelated assertions in those files.
