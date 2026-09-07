# Available Pace Decision Record

**Status:** owner-approved implementation authority  
**Business date:** 2026-09-07 (Asia/Bangkok)  
**Audited baseline:** `78ecb21cf45e413f7e25e4d50343b4a9ead142e3`

## 1. Decision and precedence

`Available to spend` is the household's sole spending authority and the exclusive basis of forward pace. Variables target, target remaining, target exceeded, target pace, target variance, and target-derived weekly guidance are retired from active and historical family guidance.

This record supersedes earlier requirements only where they make Variables target part of forward planning, prompt for it, permit it to be set, or present target-derived guidance. Earlier rules remain authoritative for Accounting, balances, commitments, transaction safety, correction handling, salary-cycle transitions, factual Variables spending, frozen weekly history, backup, and restore except where this record explicitly says otherwise.

## 2. Preserved financial semantics

```text
Available to spend =
current spending-account balances
− total outstanding commitments
```

- Available remains signed and is never clamped.
- Expected income is excluded until receipt.
- Commitment, completion, payment, transfer, correction, and salary-cycle semantics do not change.
- EF and Goal Contributions may complete explicit cycle commitments; later ordinary withdrawals do not recreate completed commitments.
- All business dates use Asia/Bangkok.
- Pace is guidance only. Exceeding it does not make a financially safe payment invalid.

## 3. Canonical Available pace

For an active salary cycle with a valid future next-salary boundary:

```text
pace base = max(Available to spend, 0)
remaining runway days = inclusive Bangkok dates from today through the day before next salary
unrounded daily pace = pace base / remaining runway days
displayed daily pace = round(unrounded daily pace, 2)

current guidance end = earlier of Sunday or salary-cycle end
days in current guidance window = inclusive Bangkok dates from today through current guidance end
weekly pace = round(pace base × days in current guidance window / remaining runway days, 2)
```

Weekly pace is derived from the unrounded proportion, not rounded daily pace, and cannot exceed the non-negative pace base. If future open weekly cards remain, each uses the same proportion for the card days inside the remaining runway. Current and future open cards reconcile to the pace base to the cent; assign any rounding remainder deterministically to the final open card.

If Available is zero or negative, daily and weekly pace are exactly `0 THB`; the authoritative signed Available remains unchanged.

At an expired recorded salary boundary without a qualifying receipt, signed Available and old-cycle commitments remain live, `planningState` remains `awaiting_salary_receipt`, and forward pace is unavailable. A missing or invalid salary boundary retains the existing authoritative unavailability behavior. No state may divide by a zero or negative runway.

## 4. Canonical read-model contract

The server owns one calculation shared by Position and Pace. The intended shape is:

```text
availablePace: {
  today,
  throughSunday,
  remainingRunwayDays,
  guidanceEnd,
  basis: "available_to_spend"
}
```

Names may follow repository conventions, but the meaning may not diverge. The frontend must not independently calculate financial pace. Serialization must distinguish zero from unavailable, including Available equal to zero, Available below zero, expired boundary, and missing/invalid boundary.

Active read models must remove or deprecate ambiguous target-derived guidance fields, including `recommendedPace`, `targetPace`, `targetRemaining`, `targetExceededBy`, and `originalElapsedPaceDelta`.

## 5. Variables target retirement

Active behavior must not:

- prompt for Variables target after cutover, salary receipt, or next-salary-date entry;
- allow Variables target to be set or edited;
- use `variables_target_satang` in forward planning;
- emit `target_not_set`, target warnings, target prompts, or target-caused unavailable pace;
- calculate or present target remaining/exceeded, target pace, recommended target pace, target variance, target-derived weekly guidance, or target-versus-actual performance;
- describe Variables target as required current-cycle state;
- expose `variablesTargetRequired` in active salary-receipt API/frontend behavior.

A legacy direct `setVariablesTarget` request must produce the validation error `Variables target is no longer supported` and zero financial or state writes, including on retry.

A qualifying salary receipt remains committed, advances the cycle, freezes missing closed weekly snapshots from the pre-reset state, resets current-only planning state only after freezing, sets `next_salary_date = NULL`, and invokes only the established next-salary-date prompt. Existing reset SQL may continue setting the dormant legacy target column to `NULL`; there is no production cleanup or rewrite.

## 6. User-interface contract

Position keeps signed Available as the sole prominent spending-authority value. Immediately below it, a strip shows `Available pace through Sunday` and `Available pace today`, both from the canonical server object. It includes visible or accessible copy: `A subdivision of Available until the next salary—not additional money or a separate limit.` The strip is hidden when forward pace is unavailable.

The Pace screen is named `Available pace`. It shows signed Available, next salary date, remaining runway days, today's pace, pace through the current Sunday, and optionally the current/future distribution of Available. It contains no target controls, target status, target explanations, target comparisons, or legacy frozen target-plan display. Its explanation is: `Pace divides today’s Available across the remaining days until salary. Spending changes future pace because it changes the real account balance.`

Factual past Variables spending may appear only when clearly labelled as factual reporting. Pace is never a separate allowance, balance, reservation, or authority.

## 7. Historical and persistence preservation

- Do not drop `variables_target_satang`, clear existing production target values, or rewrite stored target values.
- Do not delete or rewrite frozen weekly snapshots, including their dormant legacy plan fields.
- Do not present legacy plan fields as current or historical family guidance.
- Preserve factual Variables spending and historical Accounting.
- Preserve portable backup/restore compatibility with all stored legacy fields.
- No schema migration is required by this decision.

## 8. Scope lock

This change does not authorize deployment, production D1/R2 mutation, Cloudflare configuration changes, data cleanup, a new recommendation system, event sourcing, a planning-history system, or changes to financial semantics outside the exact pace dependency removal described above.

