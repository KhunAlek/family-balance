# Family Cash Flow v3 — Phone UI Implementation Specification

Date: 24 August 2026  
Owner-approved design baseline: four-tab phone mockup approved in conversation on 24 August 2026  
Code baseline inspected for this specification: `baf84eb8aaccdcdbae8b2a5f3166b6580ed1adbf`

## 1. Purpose

Replace the current single long phone dashboard with four real, screen-sized tabs while preserving all financial meaning, recorded data, write behavior, validation, warnings, and correction behavior.

This is an information-architecture change. It does not authorize changes to financial formulas, database schema, API contracts, authentication, notification rules, backup/recovery, or production configuration.

## 2. Governing hierarchy

The interface must preserve the v3 hierarchy:

1. factual current cash;
2. outstanding commitments;
3. Available to spend;
4. Variables planning and pace;
5. factual EF and Goal savings.

`Available to spend` remains the primary spending-authority number. Weekly pacing never becomes spending authority. Negative Available must be shown exactly and must never be clamped to zero.

## 3. Phone navigation

The fixed bottom navigation contains exactly four primary tabs, in this order:

1. Position
2. Pace
3. Commitments
4. Savings

Selecting a tab replaces the visible tab panel. It must not scroll the user to an anchor in a long page. Exactly one primary tab panel is visible at a time.

The selected tab persists during a normal data refresh. A full application reload may return to Position.

Notifications remain in the fixed header. Sign out and other account-level controls may live in a compact header menu. There is no Actions tab and no floating action button.

## 4. No-scroll landing-screen contract

At phone widths from 360 to 430 CSS pixels, each primary tab landing screen must fit between the fixed header and fixed bottom navigation without vertical page scrolling when rendered with:

- the normal live state;
- the longest ordinary English labels supplied by the application;
- browser text scaling at 100%;
- the phone safe-area insets;
- one consolidated state or warning banner.

The primary tab landing screen may open a focused detail screen, drawer, or sheet. Detailed obligation lists, Goal lists, histories, charts, forms, and record lists may scroll inside that focused view.

If more than one warning applies, the landing screen shows one consolidated warning summary with a count or short combined message. Opening it reveals the complete warnings. A warning must never be discarded or hidden merely to satisfy the height contract.

At 320–359 CSS pixels or with enlarged system text, content must remain readable and operable. Scrolling is permitted when needed for accessibility; content must not be clipped or overlap the navigation.

## 5. Position tab

### 5.1 Landing content

The Position landing screen shows, in order:

1. consolidated state/warning banner when applicable;
2. Available to spend, with exact sign and currency;
3. the visible calculation relationship:
   - Operational cash;
   - Total outstanding commitments;
   - Available to spend;
4. `Preview payment`;
5. Alex KTB and Olga KTB balances;
6. balance/reconciliation freshness and `Update balances`;
7. current salary-cycle dates or a compact salary-cycle status.

The calculation relationship must not imply that the Variables target reduces Available.

### 5.2 Position actions

- `Preview payment` opens the existing one-off payment preview flow. Preview remains required before recording.
- `Update balances` opens the existing balance form.
- If balances are stale or unavailable, the warning banner promotes `Update balances` without removing the normal contextual entry point.
- Account details provide `Income received` and `KTB ↔ KTB`.
- Salary-cycle details provide `Next salary date`.
- When salary receipt or salary-date attention is required, the relevant action is also promoted in the warning detail.

## 6. Pace tab

### 6.1 Landing content

The Pace landing screen shows:

- Variables cycle target, or `Target not set`;
- Variables spent in the salary-cycle window;
- remaining target or exceeded-by amount;
- current recommended pace and its mode/status;
- four compact weekly indicators representing the existing weekly cards;
- a visible statement that pace is guidance/reporting, not spending authority.

The full weekly cards or historical weekly detail open in a focused detail view.

### 6.2 Pace actions

`Set target` or `Edit target` is attached to the Variables target. It opens the existing Variables target form. Setting or editing the target must not move money, modify balances, or rewrite frozen weekly history.

## 7. Commitments tab

### 7.1 Landing content

The Commitments landing screen shows:

- total outstanding commitments;
- required fixed obligations outstanding;
- EF current-cycle commitment outstanding;
- Goal current-cycle commitments outstanding.

Each category displays an unavailable state when its source is unavailable. An unavailable amount must never be rendered as zero.

### 7.2 Commitment details and actions

- Required obligations opens the existing current-cycle obligation list and provides `Record payment` for the selected obligation.
- Required-obligation detail provides `Record obligation` where the current application supports it.
- EF opens current-cycle commitment, gross completed, outstanding, and `Edit commitment`.
- Goals opens each relevant Goal's current-cycle commitment, gross completed, outstanding, and `Edit commitment`.
- A Goal with an outstanding commitment remains accessible even if its ordinary display status changes.

EF and Goal lifetime targets are not presented as current commitments.

## 8. Savings tab

### 8.1 Landing content

The Savings landing screen shows compact factual summaries for:

- Emergency Fund current balance, lifetime target, lifetime remaining, and progress;
- Savings Goals factual progress.

The landing screen does not embed the full EF history chart or the full Goals list.

### 8.2 Savings details and actions

- Emergency Fund detail contains its factual history, `Transfer to EF`, and `Withdraw from EF`.
- Goal detail contains factual balance, lifetime target, lifetime remaining, factual movement history where currently available, and the existing contribution/withdrawal capability where currently supported.
- `Add goal` belongs in the Goals detail view.
- EF or Goal commitment editing remains under Commitments, even if the Savings detail links to it for convenience.

## 9. Notifications, records, and corrections

- Notifications open from the fixed header bell.
- Correction is not a generic top-level action.
- The user first opens records/history, selects the specific record, then chooses `Correct record`.
- Existing correction validation, audit behavior, and original-record preservation remain unchanged.

## 10. Removed primary-dashboard structures

The phone landing experience removes these structures from the single primary page:

- scroll-anchor behavior masquerading as tabs;
- the repeated four-card `Current commitments` block;
- the full EF chart;
- the full Goals list;
- the full Fixed obligations list;
- the standalone `What would you like to do?` action directory;
- duplicate actions repeated in unrelated sections.

The underlying capabilities are relocated contextually; they are not removed.

## 11. State handling

All current read-model states and meanings must survive the redesign, including:

- normal live data;
- cached/stale data;
- `target_not_set`;
- `salary_boundary_not_set`;
- `awaiting_salary_receipt`;
- `degraded_correction_data`;
- unavailable commitment totals or accounts;
- empty obligations and empty Goals;
- negative Available;
- network or refresh failure.

The Position warning summary owns cross-application state. Affected tabs also show a local unavailable or degraded label beside the affected value.

## 12. Desktop and laptop behavior

Desktop uses the same four-domain information architecture and terminology. It may show more detail beside the landing summaries when space permits, but it must not restore contradictory groupings or a standalone action directory.

The desktop layout is responsive presentation of the same model, not a separate application.

## 13. Accessibility and interaction

- Primary navigation uses tab or navigation semantics with an exposed selected state.
- Every action has a visible text label or an accessible name.
- Keyboard focus moves predictably into and out of drawers/detail views.
- Escape closes dismissible drawers without submitting changes.
- Focus is returned to the control that opened a drawer.
- Status is never communicated by color alone.
- Touch targets are at least 44 by 44 CSS pixels where practical and never below the existing application standard.
- The bottom navigation must not cover content or focused controls.
- Reduced-motion preference disables nonessential transitions.

## 14. Implementation constraints

- Reuse the existing API responses and write handlers.
- Reuse existing drawers/forms unless a focused detail wrapper is required.
- Do not change calculation or validation code to make the layout easier.
- Do not change an existing acceptance assertion.
- Add new UI tests from `07_PHONE_UI_ACCEPTANCE_MATRIX_2026-08-24.md` before or with implementation.
- No database migration or dependency addition is authorized by this specification.
- No merge, production deployment, Cloudflare configuration change, or production data write is authorized by this specification.

## 15. Approval and change control

This specification records the owner-approved mockup structure. Any change to the four primary tabs, the Position placement of payment preview and balance update, the contextual action map, or the no-scroll contract requires a new owner decision before implementation diverges.
