# Available Pace Part 2 — Part 3 Handoff

## Repository state

- Starting SHA: `26336efe5e6feb831bbc3c91edc9ceaf746d1071`
- Branch: `docs/available-pace-part1-20260907`
- Upstream: none configured
- Ending SHA: use the exact commit hash reported with this handoff (a commit cannot embed its own hash)
- Expected worktree: clean
- Production mutation: none
- Schema/configuration mutation: none

## Changed server contracts

- `availablePace` is the sole forward pace object. Its fields are `today`, `throughSunday`, `remainingRunwayDays`, `guidanceEnd`, `currentGuidanceDays`, and `basis: "available_to_spend"`.
- `availablePace` is `null` when the salary boundary is missing/invalid, expired, or the requested state is historically unavailable. Exact zero amounts remain numeric zero when pace is available.
- `variables` contains factual `spent` and `spentCycleToDate` only. Active target, remaining, exceeded, target pace, runway pace, recommended pace, and elapsed target variance fields are absent.
- `weeklyVariablesCards[].planned` is Available-based for open cards, begins today for the current card, and reconciles to non-negative Available to the cent with the remainder on the final open card. Closed-card stored target plans remain untouched but are not serialized as guidance.
- `positionPace` temporarily aliases the same canonical server values for the existing Part 2/Part 3 boundary; it performs no independent calculation.
- Direct `setVariablesTarget` fails with `Variables target is no longer supported` before any statement or revision claim is produced, including retries.
- Salary receipt responses no longer expose `variablesTargetRequired`. Salary freeze-before-reset ordering, dormant column reset, next-salary-date reset, and factual receipt behavior remain unchanged.

## Remaining Part 3 work

- Update `index.html`, `assets/v24/v24_1_app1.js`, `assets/v24/v24_1_app3.js`, `assets/v24/v24_1_app4.js`, and relevant Pace/Position CSS to consume `availablePace` directly.
- Remove target controls, warnings, drawer/form registration, target prompt ordering, and target copy.
- Rename and present the Pace surface as Available pace, including the approved explanatory copy and unavailable-state behavior.
- Replace the still-target-based frontend contract assertions in Slice C; retain unrelated phone/navigation/accessibility assertions.
- Prove Position and Pace render the same canonical response without frontend financial calculations.
- Do not deploy without a separate owner authorization.
