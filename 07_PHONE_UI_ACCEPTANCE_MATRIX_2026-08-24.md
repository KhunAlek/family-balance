# Family Cash Flow v3 — Phone UI Acceptance Matrix

Date: 24 August 2026  
Specification under test: `06_PHONE_UI_IMPLEMENTATION_SPEC_2026-08-24.md`  
Baseline inspected: `baf84eb8aaccdcdbae8b2a5f3166b6580ed1adbf`

## Rules for this matrix

1. These expectations are independent authority for the approved UI change. Do not edit an expectation to match defective code.
2. Financial calculations and current v3 acceptance tests remain authoritative and unchanged.
3. A source-string assertion alone is insufficient for layout, visibility, focus, or viewport behavior. Those require rendered browser tests.
4. Test fixtures must include negative, unavailable, degraded, empty, and long-label states—not only the normal screenshot state.

## A. Navigation and layout

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P01 | Phone app loads at 390 × 844 | Position is selected; exactly one primary panel is visible | Rendered browser test |
| UI-P02 | User selects each bottom tab | Visible panel is replaced with Position, Pace, Commitments, or Savings; page is not scrolled to an anchor | Rendered browser test |
| UI-P03 | Data refresh completes while Pace is selected | Pace remains selected and refreshed values render in Pace | Rendered integration test |
| UI-P04 | Normal state at 360 × 800, 390 × 844, and 430 × 932 | Each primary landing panel fits between header and navigation with no vertical page overflow | Rendered viewport test |
| UI-P05 | One consolidated warning is present | Each primary landing panel still satisfies UI-P04 | Rendered viewport test |
| UI-P06 | Two or more warnings apply | One summary is visible; all warning meanings and required actions are available after opening it | Rendered state test |
| UI-P07 | Width is 320–359 or text is enlarged | Content reflows without clipping, overlap, or hidden values; scrolling is allowed | Accessibility viewport test |
| UI-P08 | Bottom navigation is present on a safe-area phone | Navigation does not cover the last content row or focused control | Rendered viewport test |
| UI-P09 | Laptop layout renders | Same four-domain terminology and semantic grouping are used; no standalone action directory returns | Rendered desktop test |

## B. Position

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P10 | Normal current-cycle data | Position shows Available, Operational cash, total commitments, both KTB balances, freshness, and salary-cycle status | Rendered state test |
| UI-P11 | Available is negative | Exact signed negative value and currency are visible; value is not clamped or visually replaced by zero | Rendered state + existing financial tests |
| UI-P12 | Available is unavailable | Position shows unavailable—not zero—and payment preview follows existing payment-safety availability | Rendered state + frontend contract test |
| UI-P13 | User activates Preview payment | Existing payment drawer opens and still requires successful preview before Record payment is enabled | Rendered interaction test |
| UI-P14 | User activates Update balances | Existing balance form opens with current contextual balance summary | Rendered interaction test |
| UI-P15 | Balances are stale | Warning summary promotes Update balances; normal account entry point remains available | Rendered state test |
| UI-P16 | User opens account details | Income received and KTB ↔ KTB are available there | Rendered interaction test |
| UI-P17 | User opens salary-cycle details | Next salary date is available there | Rendered interaction test |

## C. Pace

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P18 | Variables target exists | Target, spent, remaining/exceeded, pace, and weekly indicators are shown | Rendered state test |
| UI-P19 | Variables target is absent | `Target not set` and Set target are shown; Available remains live when the read model says it is live | Rendered state + existing contract test |
| UI-P20 | Target is exceeded | Exact exceeded-by state is shown; weekly pacing remains reporting only | Rendered state test |
| UI-P21 | Salary boundary is reached before receipt | Available and commitments remain live; forward pace alone is unavailable | Rendered state + existing V3-M25 frontend test |
| UI-P22 | User opens weekly details | Existing factual weekly cards/snapshots are accessible in a focused scrollable view | Rendered interaction test |
| UI-P23 | User sets or edits target | Existing form and write path are used; no balance or factual-history mutation occurs | Interaction + existing write tests |

## D. Commitments

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P24 | Normal commitments | Total equals visible required + EF outstanding + Goal outstanding | Rendered state + financial tests |
| UI-P25 | Required obligations are unavailable | Required and total affected state show unavailable/conservative meaning; required is not rendered as zero or empty | Rendered state + existing unavailable contract test |
| UI-P26 | No obligations exist | Factual empty state is distinct from unavailable | Rendered state + existing unavailable contract test |
| UI-P27 | EF completion is unavailable | EF commitment state is explicitly unavailable and total does not silently treat it as zero | Rendered state + frontend contract test |
| UI-P28 | Goal completion is unavailable | Affected Goal and summary are explicitly unavailable and not zero | Rendered state + frontend contract test |
| UI-P29 | Goal is ordinarily hidden/done but has outstanding commitment | Goal remains accessible in commitment detail | Rendered fixture test |
| UI-P30 | User opens required obligations | Full list and per-obligation Record payment are accessible | Rendered interaction test |
| UI-P31 | User edits EF or Goal commitment | Existing drawer, validation, retry, and refresh behavior remain unchanged | Interaction + existing acceptance tests |

## E. Savings

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P32 | EF and Goals exist | Landing shows factual EF and Goal summaries without full chart or full lists | Rendered state test |
| UI-P33 | User opens EF | Factual balance, target, remaining, history, Transfer to EF, and Withdraw from EF are accessible | Rendered interaction test |
| UI-P34 | User opens a Goal | Factual saved, lifetime target, lifetime remaining, and supported movements are accessible | Rendered interaction test |
| UI-P35 | Goal has lifetime remaining but no cycle commitment | Lifetime remaining is not included in commitments or subtracted from Available | Rendered state + financial tests |
| UI-P36 | EF/Goal list is long | Landing height remains fixed; full list scrolls only in focused detail | Rendered viewport test |
| UI-P37 | EF history is long | Landing height remains fixed; chart/history remains usable in focused detail | Rendered viewport and interaction test |

## F. Contextual actions and correction

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P38 | User looks for Notifications | Header bell is visible and opens existing notification UI | Rendered interaction test |
| UI-P39 | User looks for generic action directory | No `What would you like to do?` directory or Actions tab is present | DOM and rendered test |
| UI-P40 | User selects an existing record | Correct record is available from that record's detail/history context | Rendered interaction test |
| UI-P41 | No record is selected | Generic top-level Correct record action is absent | DOM and rendered test |
| UI-P42 | User opens and closes a drawer | Focus enters predictably, Escape closes without submitting, and focus returns to opener | Accessibility interaction test |

## G. Read-model and failure states

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P43 | `salary_boundary_not_set` | Position warning requests next salary date; affected Available, commitments, and pace states remain unavailable as defined by current contract | Rendered state + existing contract test |
| UI-P44 | `awaiting_salary_receipt` | Warning preserves canonical V3-M25 wording and semantics | Rendered state + existing contract test |
| UI-P45 | `degraded_correction_data` | Affected accounts are named; Available is identified as conservative; exact affected commitment values are unavailable | Rendered state + existing contract tests |
| UI-P46 | Cached data is displayed | Cached/stale state is prominent without replacing financial values with invented defaults | Rendered state test |
| UI-P47 | Refresh fails after cached render | Cached values remain identified as cached; selected tab remains usable | Rendered integration test |
| UI-P48 | Initial load fails with no cache | Existing sign-in/error recovery behavior remains available and no misleading zero values render | Rendered integration test |

## H. Regression and non-mutation

| ID | Scenario | Required result | Verification |
|---|---|---|---|
| UI-P49 | Existing automated suites run at implementation SHA | All pre-existing assertions pass unchanged | Exact commands and observed output |
| UI-P50 | Frontend-only redesign diff is inspected | No migration, schema, calculation, API contract, or production configuration change is present | Diff review |
| UI-P51 | All drawers/forms are inventoried | Every previously supported action has one documented contextual route | DOM/action inventory test |
| UI-P52 | Browser back/close behavior is exercised | Closing a detail returns to its originating tab without losing displayed state | Rendered interaction test |
| UI-P53 | Financial values are compared before and after redesign with the same fixture | All displayed authoritative values and availability states are identical | Golden fixture comparison |

## Required execution evidence

Implementation review must record:

- exact implementation SHA;
- exact baseline SHA;
- exact commands;
- observed pass/fail counts;
- phone viewport dimensions tested;
- desktop viewport dimensions tested;
- screenshots for Position, Pace, Commitments, Savings, warning summary, negative Available, and unavailable commitments;
- confirmation that no existing acceptance assertion was edited.

Passing source-string tests without rendered viewport and interaction tests is a partial pass, not acceptance.
