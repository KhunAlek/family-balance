# Stage 14 Salary Management Design

## Status and authority

**Status:** proposed design only; not yet accepted for implementation.

**Evidence SHA:** `fea362e4cb9c5ec52c9e377a2526de49185d4d6a` (`Add EF and Goal movement management candidate`).

The owner explicitly accepted Step 13 at this SHA on 13 September 2026 for the purpose of producing this design. This document does not authorize schema or code changes, migration, historical attachment, representative or production-data access, external D1/R2 mutation, factual repair, configuration or dependency changes, merge, deployment, replacement, or Step 15.

Salary correction, deletion, restoration, and undo remain disabled until this design is explicitly accepted and a separately authorized implementation candidate passes the complete invariant family.

## Exact-SHA findings

At the evidence SHA:

1. `planIncomeReceipt` creates one `income_receipts` row and one linked `balance_history` row per non-zero Alex/Olga allocation. The receipt points to its exact cash-effect row through `source_balance_row_id`. It then calls `planSalaryReceiptTransition` when the source is not an active typed other-income source.
2. A source is treated as salary when its current `income_definitions.pay_day` is not `Variable`. `salary_cycle_sources` records source membership by cycle start, but not the receipt that established that membership.
3. A qualifying receipt advances the active salary cycle when its source was already received in the active cycle or its date reaches/passes the recorded `next_salary_date`. A second, different salary source before that boundary joins the existing cycle. On advance, missing closed weekly snapshots are calculated from the pre-reset snapshot; then `current_cycle_start` becomes the receipt date, `next_salary_date` and Variables target become `NULL`, EF commitment is reset to its configured/default amount, and Goal cycle commitments become zero.
4. Reporting uses immutable factual rows in `reporting_salary_cycles`; transaction/report assignment is derived by the latest boundary not after the business date.
5. The canonical terminal read model can reconstruct persisted `salary_receipt` versions from receipt and cash-effect components, but salary is excluded from `persistedActions`, so all management actions remain disabled. Historical grouping can propose a salary identity only from durable write-token and revision-claim evidence; ambiguous rows remain disabled.
6. Existing salary receipts have no typed parent equivalent to `other_income_receipt_parents`. Consequently there is no durable object that asserts the complete split, source/class, original cycle membership, cycle-advance decision, or reporting-boundary consequence as one action.
7. `weekly_snapshots` is keyed by household and week start and has no update path in salary transition. Missing rows use `INSERT`; existing rows are skipped. Balance observations are separately immutable.
8. Portable backup v2 includes receipts, balance history, salary state, cycle sources, reporting cycles, weekly snapshots, logical identity/version/component tables, audits, request receipts, and revision claims. It has no salary-specific relationship table to round-trip yet.
9. Worker transaction-management routing dispatches one-off, other-income, obligation, KTB, and fund families, but has no salary eligibility/replacement builder. Authentication is required before the Worker reaches these routes, and the shared protocol also requires actor identity, stable request ID, base revision, and terminal version ID.

## Design principles

- Accounting facts, commitments, and planning remain separate.
- A salary management operation changes only the selected logical transaction and the projections that are deterministically caused by terminal salary facts.
- Original receipt rows, cash-effect rows, identity versions, audits, request receipts, balance observations, reporting observations, and frozen weekly snapshots are never updated or deleted.
- Every active salary version is complete and reconstructable from one typed parent plus exact receipt and cash-effect relationships.
- Cycle and reporting consequences are calculated on the server from all authoritative terminal salary versions and preserved historical boundary evidence. The client never supplies before-values or computed effects.
- `next_salary_date` is never inferred. A management operation preserves the recorded value only when it still belongs to the unchanged active cycle; whenever the active cycle start changes, the result is `NULL` unless an independently recorded value already exists for that exact cycle.
- If there is not exactly one authoritative projection, eligibility fails with zero writes.

## Typed salary receipt model

Add one narrow immutable table, provisionally `salary_receipt_parents`, only after separate migration authorization. Each row represents one complete salary action version and contains:

- immutable parent ID and household ID;
- Bangkok business date;
- qualifying salary source;
- total satang;
- exactly one or two positive allocations, represented through existing `income_receipts` rows;
- the cycle start to which this version belongs;
- whether this version opened that cycle;
- the immediately preceding cycle start when it opened a cycle, nullable only for the first known cycle;
- the recorded `next_salary_date` observed before the transition, including an explicit null;
- no copied balance totals, commitment totals, or weekly values.

The parent is a relationship/evidence record, not a parallel accounting ledger. Its child receipt IDs remain the amount authority. Each child receipt must have the same household, source, business date, and parent; distinct supported destination accounts; a positive safe-integer satang amount; and one exact `source_balance_row_id`. Child amounts must sum exactly to the parent total. Each cash-effect row must be same-household and uniquely referenced by its receipt.

Every newly created salary receipt also creates one logical transaction, one `salary_receipt` version, receipt components with role `receipt`, and matching balance-effect components with role `cash_effect`. The version reaches its typed parent deterministically through its receipt set. No existing row is attached by migration or guessed from date, amount, source, ordering, or adjacency.

## Source membership

Qualification for a new or corrected version is evaluated against the income-source classification valid for its effective business date. Current `income_definitions.pay_day` alone is insufficient for historical correction if classification could have changed.

Therefore implementation must either prove an existing immutable source-version interval covers the date or refuse `SALARY_SOURCE_HISTORY_UNAVAILABLE`. It must not manufacture source history. A correction may select only a source proven to be salary on that date; changing salary to other income is replacement and remains disabled.

`salary_cycle_sources` becomes a deterministic projection of active terminal salary versions assigned to each cycle, not independently editable evidence. A source is present once per cycle even if multiple active receipts exist. Deleted and superseded versions do not contribute membership.

## Salary and reporting cycle projection

The server reconstructs cycle state by replaying only complete active terminal typed salary receipts in ascending `(business_date, committed_revision, logical_transaction_id)` order, anchored by preserved factual reporting boundaries and any accepted pre-management current-cycle evidence. Replay uses the existing transition rules:

1. The first qualifying receipt with no current start opens a cycle on its receipt date.
2. At or before the current start, a receipt can add source membership only when the date equals the start; earlier dates are refused for management because replay would require historical reconstruction beyond the anchor.
3. A new source received after the start but before the recorded boundary joins the active cycle.
4. A source already received, or any qualifying source at/after an explicitly recorded boundary, opens a new cycle on its receipt date.

Replay must yield exactly one ordered cycle/membership result and agree with every preserved reporting boundary and frozen snapshot interval. It may append a newly caused current reporting boundary during an authorized commit, but it never renames or deletes an existing factual reporting boundary as a side effect of salary management. If a correction/deletion would require doing so, refuse `PRESERVED_REPORTING_BOUNDARY_CONFLICT`.

Transaction History period assignment is then derived from the resulting factual reporting boundaries by the existing latest-boundary-on-or-before-date rule. Preview lists every transaction whose reporting assignment would change. If any item would lose an assignment, refuse.

The existing direct salary-cycle correction flow is not merged into salary receipt management. It remains a separate revision-bound reporting correction path and cannot be used to make an otherwise ambiguous receipt mutation eligible.

## Cash and reconciliation

For correction, create new immutable receipt and balance-effect rows representing the full intended allocation. For deletion, create a terminal deleted version whose new cash effects exactly negate the prior active allocation. For restoration, recreate the last complete active meaning using new immutable factual rows and effects. Undo creates another complete version that reproduces the exact prior terminal meaning.

For every operation:

- per-account cash change is `new terminal allocation - old terminal allocation`;
- combined cash change is the exact sum of account changes;
- the newest cash-effect observation starts from the latest usable recorded balance and applies only that delta;
- no existing balance observation is edited;
- canonical balances and history count only active terminal salary effects and do not double-apply effects already represented by a selected observation;
- reconciliation reports the immutable observation separately from the transaction delta and names any unresolved chain.

If receipt-to-effect cardinality, household, source, date, account uniqueness, amount sum, observation linkage, or terminal ownership is incomplete or conflicting, refuse. Legacy salary rows without one proved complete logical identity remain visible but mutation-disabled.

## Commitments and current planning state

Preview computes before/after current-cycle commitments using the same terminal consumers used by the dashboard:

- outstanding fixed obligations and their existing terminal payment completion;
- EF cycle commitment and qualifying terminal contributions;
- Goal cycle commitments and qualifying terminal contributions;
- Available to spend as current spending-account balances minus total outstanding commitments;
- Variables target as planning only, never a cash reserve.

When replay leaves the active cycle start unchanged, current commitment configuration is preserved and completion is recomputed from terminal facts. When replay deterministically opens a new active cycle, missing old-cycle weeks are frozen first from the pre-reset state, then current-only planning resets exactly as creation does: `next_salary_date=NULL`, Variables target `NULL`, EF commitment to the configured/default amount, and Goal cycle commitments to zero.

When removal or correction would move the active cycle start backward, the operation is eligible only if replay identifies one prior cycle unambiguously, no preserved reporting boundary conflicts, and no frozen snapshot would need alteration. Current-only planning cannot be reconstructed historically from later mutable state, so such an operation is refused with `CURRENT_PLANNING_RESET_NOT_REVERSIBLE` unless the exact pre-transition planning values were durably recorded by the salary parent/operation evidence. Implementation must store those explicit pre/post planning values for new managed transitions; it must not infer them for history.

At an expired recorded boundary without a qualifying receipt, Available and the old-cycle commitment breakdown stay live, while forward guidance remains `awaiting_salary_receipt`. Management must preserve this behavior.

## Frozen weekly snapshots

Frozen snapshots are append-only observations. Salary management may insert only missing closed weeks caused by a newly established forward transition, using the complete pre-reset snapshot. It may never update, delete, replace, relabel, or supersede a frozen row.

Before declaring eligibility, preview enumerates all preserved frozen rows whose interval or values would differ under the proposed terminal salary history. Any such row causes `FROZEN_WEEKLY_SNAPSHOT_CONFLICT`; the operation commits zero writes. Preserved rows are shown in preview even when unchanged.

Deletion, restoration, and undo do not “unfreeze” weeks. A restored transition may reuse already frozen observations only when their interval is identical and no value rewrite is required.

## Operation rules

### Correction

May change business date, positive Alex/Olga allocation, and salary source within the salary class. It creates a full new terminal version. It is refused if replay is ambiguous, a preserved reporting/freeze conflict exists, historical source validity is unavailable, later dependent salary management exists, or current planning cannot be reconstructed exactly.

### Deletion

Means entered by mistake and never erases rows. It creates exact reversing cash effects and a deleted terminal version. It is refused when the receipt established a boundary or membership needed by later facts and replay cannot produce one unambiguous preserved result.

### Restoration

Restores the last complete active salary meaning, not user-supplied new values. It revalidates source/date qualification, current cash effect, cycle replay, reporting, freezes, and planning against current authoritative state. It creates new factual/effect rows; it never reactivates old rows in place.

### Undo

Available for ten minutes only for the latest household revision and only when no dependent activity exists. It reproduces the prior terminal meaning as a new version and reruns all salary-specific checks. Expiry, later revision, cycle/reporting dependency, or freeze conflict refuses with zero writes.

### Replacement

Salary-to-other-income, other-income-to-salary, or any other kind replacement remains disabled.

## Preview contract

The guarded preview is read-only and returns:

- complete before and proposed terminal receipt meaning;
- exact Alex and Olga cash changes and combined change;
- before/after qualifying source membership by cycle;
- before/after active cycle start and the recorded `next_salary_date` result;
- planning reset or return details and all commitment changes;
- reporting boundaries before/after, assignment changes, and affected payments;
- preserved and newly proposed weekly snapshots;
- reconciliation state;
- dependent-activity findings;
- eligibility, stable refusal codes, base revision, terminal version ID, and undo expiry where relevant.

The commit accepts only logical transaction ID, operation, intended semantic values/reason, stable request ID, preview base revision, and terminal version ID. It reloads all authority and recomputes the result.

## Authentication, gates, atomicity, and audit

- Worker authentication remains mandatory before preview or commit; commit also requires a non-empty authenticated actor email.
- Until implementation acceptance, canonical `salary_receipt` actions stay false and Worker routing must return a salary-specific disabled refusal rather than falling through another family builder.
- Commit uses the shared semantic request receipt and revision-claim protocol in one D1 batch.
- Same request ID plus same semantics returns the original response; same ID plus different semantics fails.
- Stale revision, stale terminal version, failed eligibility, or any SQL failure writes nothing.
- One successful operation writes all new facts, components, version, terminal pointer, audit, request receipt, cycle/reporting/planning projections, and exactly one household revision atomically.
- Audit records actor, UTC time, reason, prior/resulting version, request/write identities, exact cash impact, membership/cycle/reporting/commitment consequences, preserved freezes, and refusal-independent reconstruction evidence.

## Backup and isolated restore

The portable backup format must add the salary parent/relationship table and any explicit transition-evidence fields as one complete optional schema family, with fail-closed inventory validation. It must retain all existing salary-related tables and identity/audit/request/revision tables.

Verification rejects partial salary schema, missing tables, broken row counts/hashes, orphan parents/children/effects, incomplete logical components, or projection disagreement. The isolated restore tool must restore in foreign-key dependency order and then prove byte-stable canonical serialization plus semantic equivalence of:

- active/deleted terminal salary transactions and audit chains;
- permitted/refused operations and refusal codes;
- per-account and combined cash;
- cycle source membership and active cycle state;
- `next_salary_date`, including null;
- commitments and `awaiting_salary_receipt` state;
- reporting boundaries and transaction/payment assignments;
- immutable weekly snapshots and balance observations;
- replay/idempotency responses and household revision.

No external backup or restore is authorized by this design.

## Required test matrix before implementation acceptance

### Creation and typing

- Alex-only, Olga-only, and split salary receipts create one parent, exact children/effects, one logical ID/version, and correct cycle consequence.
- Zero, negative, unsafe satang, duplicate account, mismatched sum/source/date/household, missing effect, or duplicate ownership fails atomically.
- Salary classification is valid on the business date; current-name coincidence does not adopt historical rows.

### Cycle and source behavior

- first receipt, second distinct source before boundary, repeated source, receipt exactly at boundary, receipt after boundary, same-day ordering, missing boundary, and expired boundary scenarios;
- `next_salary_date` becomes null on advance and is never inferred;
- reporting boundary and source membership are exact and deterministic;
- ambiguous historical anchor or source validity refuses.

### Management family

- correction for date, allocation, and same-class source; invalid correction;
- deletion of non-advancing and advancing receipts;
- restoration from deleted state;
- undo inside/outside ten minutes and with/without later activity;
- every operation preserves logical ID, appends immutable facts/version/audit, and advances revision once;
- salary replacement stays disabled.

### Planning, freezes, and reconciliation

- unchanged-cycle commitment recomputation;
- forward transition freezes all and only missing closed weeks before reset;
- frozen rows and balance observations are byte-identical after every operation;
- any required frozen-row rewrite refuses;
- Available may be negative and remains live at `awaiting_salary_receipt` while forward guidance is unavailable;
- exact per-account cash delta, combined cash, canonical balance, Balance history reconciliation, and no double application.

### Canonical/history/reporting

- only active terminal salary versions affect money-in totals and cash consumers;
- deleted/superseded/audit rows are audit-visible only;
- deterministic ordering and serialization survive refresh;
- correction lists every reporting assignment/payment move; orphan assignment refuses;
- legacy incomplete/ambiguous salary items stay visible and disabled.

### Protocol and recovery

- unauthenticated preview/commit and missing actor are zero-write failures;
- stable replay, request-ID conflict, stale revision, stale terminal pointer, competing same-base requests, forced failure rollback, and lost-response retry;
- portable backup integrity, partial-schema rejection, isolated restore, canonical byte equivalence, and post-restore eligibility/replay equivalence.

### Regression gate

- focused salary suite;
- existing salary-cycle, weekly-freeze, reporting-correction, transaction-history, balance-history, planning, backup, authentication, and shared management suites;
- full Slice B/C/D suite at the exact implementation candidate SHA.

## Implementation acceptance gates

Implementation may begin only after explicit owner acceptance of this design. Any additive migration requires separate owner authorization. Enabling salary mutation requires a candidate SHA and observed passing results for the full matrix above, followed by explicit owner acceptance. External migration, representative/production access, merge, deployment, replacement, and Step 15 remain separate gates.
