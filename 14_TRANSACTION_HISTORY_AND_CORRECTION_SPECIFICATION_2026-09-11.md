# Family Cash Flow — Transaction History and Correction Specification

**Date:** 11 September 2026  
**Status:** Owner-accepted implementation specification (accepted 11 September 2026); implementation, migration, deployment, and production repair remain separately authorized steps  
**Repository baseline reviewed:** `6f08eb03f9cda40ea2cb357dd4e69a09a3747164`  
**Business timezone:** `Asia/Bangkok`

## 1. Purpose

Replace the record-oriented **Correct a record** page with a household-oriented transaction history where either household user can find, understand, correct, delete, restore, or undo a logical financial transaction safely.

The implementation must solve the observed failure mode: a user selected a “Balance / recorded movement” row intending to correct who paid, but the form exposed only balance and date fields. The write succeeded as a balance replacement while preserving the original payment metadata, so the result appeared not to save and produced misleading financial state.

This specification changes the correction experience from editing database-shaped records to managing household transactions. It does not authorize deployment, production mutation, historical rewriting, or unrelated architecture.

## 2. Authority and compatibility

This specification controls transaction history, correction, deletion, restoration, replacement, and undo behavior. Existing authoritative rules remain in force unless this document explicitly changes the behavior in that scope.

In particular:

- accounting facts, commitments, and planning remain separate;
- business dates use Bangkok dates;
- money is stored as integer satang;
- expected income never counts before receipt;
- Available may be negative and is never clamped;
- EF and Goal commitment completion follows authoritative logical contributions;
- later ordinary withdrawals do not recreate completed commitments;
- salary-cycle transition freezes missing weekly snapshots before resetting current-only planning state;
- frozen weekly snapshots and recorded balance observations are never rewritten;
- all financial mutations use the existing revision-claim protocol and one atomic D1 batch;
- server validation is authoritative;
- backups and isolated restores must round-trip all added fields and relationships.

This document supersedes the earlier phone rule only where it made correction available from a record-oriented history. Correction remains contextual: the user must select a logical transaction before acting on it.

## 3. Explicit non-goals

The implementation must not introduce:

- a generic event-sourcing system;
- a generic correction or effect graph;
- a generic migration framework;
- a recommendation engine;
- editable historical balance observations;
- editable frozen weekly snapshots;
- permanent erasure of financial or audit facts;
- a universal transaction table that duplicates every existing factual table merely for architectural uniformity;
- bulk correction or bulk deletion;
- production repair, deployment, or data migration without separate owner authorization.

## 4. User and permission model

Alex and Olga have equal permission to:

- view all household transactions;
- correct any transaction;
- delete any transaction;
- restore a deleted transaction;
- undo their own or the other user’s latest eligible transaction-management action;
- view the complete audit history.

Every mutation records the authenticated actor, Bangkok-effective business date where relevant, UTC timestamp, reason, request ID, base revision, committed revision, and write token.

## 5. Information architecture

### 5.1 Transaction history

The application adds a first-class **Transaction history** destination. It shows logical household transactions rather than raw database rows.

Included transaction kinds:

- one-off payments;
- fixed-obligation payments;
- salary receipts;
- other-income receipts;
- KTB-to-KTB transfers;
- EF contributions and withdrawals;
- Goal contributions and withdrawals;
- transaction replacements, deletions, restorations, and undo operations when audit visibility is enabled.

Excluded from ordinary transaction history:

- balance checks;
- planning targets and commitments;
- configuration changes;
- frozen weekly snapshots;
- raw revision claims and technical audit rows.

### 5.2 Balance history

Balance checks appear in a separate **Balance history** view as immutable dated observations.

The ordinary UI must not offer edit, delete, restore, or undo actions for a balance check. If a discrepancy is caused by a transaction, the UI directs the user to Transaction history. Any future invalid-observation workflow requires separate specification and authorization.

### 5.3 Default period

Transaction history opens on the current salary cycle. The period selector offers:

1. Current salary cycle;
2. Previous salary cycle;
3. Custom date range;
4. All history.

The active period is always visible. An unavailable current boundary must not produce an invented date range; the UI explains that the boundary is unavailable and offers custom/all-history views.

### 5.4 Search and filters

The history supports:

- free-text search over description, payee/source, category name, and account name;
- category multi-select;
- exact amount, amount range, greater-than, and less-than expressions;
- transaction-kind filter;
- account filter;
- user/actor filter for transaction-management actions;
- status filter when audit visibility is enabled;
- clear-all action.

Amount search applies to the logical transaction total, not an individual technical component. Examples accepted by the UI are `500`, `450–550`, `>1000`, and `<250`. The server parses and validates the expression; locale formatting must never alter the stored value or query semantics.

The result count and totals of money in and money out are shown for the filtered set. Internal transfers are not counted as household income or spending in those totals.

### 5.5 Ordering and pagination

Transactions are ordered by business date descending, then committed revision descending, then stable logical transaction ID. The interface may paginate or incrementally load, but it must not silently truncate results. Search and totals cover the entire filtered result set, not only loaded rows.

## 6. Logical transaction model

### 6.1 Principle

One household action is displayed and managed as one logical transaction even when it created multiple factual rows.

Examples:

- a split payment across Alex and Olga is one transaction;
- an EF-funded payment remains separate household actions if the user explicitly recorded an EF withdrawal and then a payment;
- a KTB transfer with its balance effect is one transaction;
- a Goal withdrawal with its KTB credit is one transaction;
- a salary receipt split across accounts is one receipt transaction when created by one request.

### 6.2 Identity

New transactions must receive a durable logical transaction ID at creation. All component rows created in the same atomic action must be linked to that ID or be deterministically reachable from an existing typed parent row.

Historical rows are exposed through a deterministic, reviewed adapter for the known existing transaction types. Historical grouping must use durable evidence already present, such as request ID, write token, revision, typed parent identity, or an explicit reviewed mapping. It must not guess from matching dates, amounts, descriptions, or adjacent row order.

If historical components cannot be grouped unambiguously, the history shows them as separate read-only legacy items and does not allow transaction-level mutation. The UI explains why. Ambiguity must never increase Available or silently combine facts.

### 6.3 Read model

Each logical transaction exposes at least:

- logical transaction ID;
- kind and status;
- business date;
- description/payee/source;
- category where applicable;
- total amount;
- direction: money in, money out, or internal movement;
- source and destination accounts;
- component identities;
- creation actor and timestamp when available;
- current authoritative version;
- whether correction, deletion, restoration, replacement, or undo is currently permitted;
- reconciliation impact state;
- audit summary.

The read model returns only the terminal authoritative version in the default list. Originals, reversals, intermediate replacements, and deleted versions become visible through **Show corrections and deleted records**.

## 7. Transaction detail

Selecting a history item opens a detail view containing:

- the complete current factual meaning in household language;
- date, amount, category, description, and affected accounts;
- obligation, EF, Goal, or salary-cycle consequences where applicable;
- component entries in a secondary technical-detail section;
- reconciliation status;
- audit history;
- permitted contextual actions.

The primary actions are **Correct transaction** and **Delete transaction**. Deleted items instead offer **Restore transaction**. An eligible recent action offers **Undo**.

## 8. Correction workflow

### 8.1 Guided field selection

The first step asks **What needs correcting?** and offers:

- Date;
- Amount;
- Paid-from or received-into account;
- Category;
- Description;
- More than one detail.

Single-detail choices show only the necessary field. **More than one detail** shows the complete editable form for that transaction kind.

### 8.2 Editable fields

The editable fields are limited by transaction kind. A correction may not silently change the transaction kind.

- Payment: date, amount/allocation, paid-from account, category, description, obligation occurrence and payment status where applicable.
- Income: receipt date, amount/allocation, received-into account, and source where the selected source remains the same income class.
- KTB transfer: date, amount, source, and destination; source and destination must remain different.
- EF/Goal movement: date, amount, direction, destination/source KTB account, and Goal identity where permitted by invariant checks.

Changing between fundamentally different kinds uses **Replace transaction**, not ordinary correction. Examples include payment to income, KTB transfer to payment, or salary to other income.

### 8.3 Impact preview

No correction commits on the first confirmation action. The server returns an authoritative preview calculated from the current revision. The preview states in plain language:

- values before and after;
- money restored to or removed from each KTB account;
- change to household cash, if any;
- obligation reopening/completion impact;
- EF or Goal factual balance impact;
- EF or Goal current-cycle commitment impact;
- salary-cycle/reporting impact where applicable;
- reconciliation difference created or resolved;
- warnings or reasons the correction is not permitted.

The final save must include the preview revision. If financial state changed, save fails as stale and requires a fresh preview.

### 8.4 Persistence semantics

The original facts are preserved. The correction creates the minimum typed reversal/replacement evidence required by the affected transaction family and one immutable audit record. All components, audit evidence, request receipt, revision claim, and revision update commit atomically.

Re-correction acts only on the terminal authoritative version. Intermediate replacements never participate in balances, spending totals, or commitment completion.

## 9. Delete transaction

### 9.1 User meaning

**Delete transaction** means “this household transaction was entered by mistake.” It does not physically delete factual or audit rows.

The reason selector defaults to **Entered by mistake** and also offers:

- Duplicate entry;
- Wrong household;
- Test entry;
- Other.

An optional explanation is available. Selecting **Other** requires an explanation.

### 9.2 Accounting meaning

Deletion atomically records a typed reversal of every financial effect, marks the logical transaction deleted, and writes immutable audit evidence. The deleted item disappears from the default history and is visible under **Show corrections and deleted records**.

Deletion must not be available when the system cannot identify and reverse the complete logical transaction safely.

### 9.3 Consequences

- Payment deletion restores cash to the exact paying accounts/allocation.
- Fixed-obligation payment deletion reopens the affected obligation by the deleted amount and restores its prior factual payment status.
- Income deletion removes cash from the exact receiving accounts/allocation.
- KTB transfer deletion reverses both sides and preserves combined KTB.
- EF/Goal contribution deletion removes the contribution from factual fund balance and may reopen its current-cycle commitment.
- EF/Goal withdrawal deletion restores the amount to factual fund balance.
- Deleting an ordinary withdrawal does not invent contribution completion.
- A deletion that would produce an impossible or ambiguous salary-cycle state follows the guarded salary flow or is rejected.

## 10. Restore and undo

### 10.1 Restore

Restore defaults to **Restore last active version**. **Restore original version** is available as an explicit alternative.

Restore creates new audited financial effects; it never removes the deletion audit or reactivates old rows in place. Repeated restore requests with the same request ID return the original successful result without duplicate effects.

### 10.2 Undo

After a successful correction, deletion, restoration, or replacement, the UI offers a short-lived **Undo** action. Eligibility is determined by the server, not only by a client timer.

Undo creates a new audited operation that restores the immediately preceding authoritative state. It never erases history. If later dependent financial activity makes undo unsafe, the server refuses it and directs the user to a new correction or guarded workflow.

## 11. Replace transaction

When transaction kind must change, **Replace transaction** performs one atomic operation:

1. reverse/delete the terminal authoritative transaction;
2. validate and create the correctly typed replacement;
3. record a single relationship in immutable audit evidence;
4. commit one request receipt and one household revision.

If either side fails, neither side commits. The replacement must pass every creation rule of its target transaction kind. This relationship is specific to the operation and must not become a generic correction graph.

## 12. Reconciliation and balance observations

Balance observations are immutable. Correcting, deleting, restoring, replacing, or undoing a transaction never rewrites a later balance check.

Current position is derived from the latest usable confirmed balance observation plus subsequent terminal authoritative transactions. When a historical transaction change conflicts with a later observation, the system:

- preserves the observation;
- records the transaction-management action;
- exposes the resulting reconciliation difference;
- warns before commit with the exact difference;
- never silently adjusts another transaction or balance check;
- suggests recording a new balance check when appropriate.

The history and dashboard must use the same authoritative transaction interpretation. A correction cannot appear in audit history while being ignored by current balances, commitments, reports, or restoration.

## 13. Fixed obligations

Deleting a fixed-obligation payment reopens the occurrence by the deleted amount. Restoring it reapplies its original allocation and payment status. Correcting amount, occurrence, or status recalculates the affected occurrence from terminal authoritative payments only.

An occurrence with no remaining terminal payment is unpaid. Partial and final semantics must remain explicit. A correction may not silently move a payment between obligations without previewing both occurrences.

## 14. EF and Goal rules

Authoritative terminal contributions in the current salary cycle determine completed commitment amounts.

- Deleting a contribution removes it from completed amount and may reopen outstanding commitment.
- Restoring a contribution may complete the commitment again.
- Correcting contribution amount or direction recalculates completion from terminal authoritative movements only.
- Deleting a withdrawal restores factual fund balance but does not count as a contribution.
- Restoring an ordinary withdrawal reduces factual fund balance and does not recreate a previously completed commitment.
- Goal lifetime target remains planning/reference data and is not edited through transaction correction.

If a relevant correction chain cannot be resolved, existing `degraded_correction_data` fail-closed behavior remains mandatory and names the affected accounts.

## 15. Salary receipts

Salary receipt correction, deletion, restoration, replacement, and undo use a guarded flow because salary can advance the cycle and freeze reporting history.

The preview must show:

- account changes;
- whether the qualifying salary receipt set changes;
- whether the active cycle boundary changes;
- commitments that would return or reset;
- reporting-cycle assignment changes;
- any payments moving between reporting cycles;
- frozen weekly snapshots that remain preserved.

Frozen weekly snapshots are never unfrozen or rewritten. If the system cannot reconstruct one unambiguous result from authoritative evidence, it refuses the operation and explains the unresolved decision. It must never infer a next salary date.

## 16. Audit presentation

**Show corrections and deleted records** is off by default. When enabled, the history and detail view show the complete ordered chain using household language:

- Created;
- Corrected;
- Deleted;
- Restored;
- Replaced;
- Undone.

Each entry shows actor, time, reason, before/after summary, financial impact, and revision. Raw JSON, internal table names, and write tokens belong in an expandable technical section, not the primary UI.

Audit records and committed request receipts are immutable. Application mutation endpoints must not update or delete them.

## 17. Idempotency, concurrency, and failure behavior

Every preview/save operation receives a client-generated stable request ID. The server stores a semantic payload hash and the original successful response atomically with the financial effects.

- Same request ID and same semantic payload returns the original success.
- Same request ID and different semantic payload is rejected.
- A lost response followed by retry never duplicates effects.
- Two different requests from the same base revision cannot both commit.
- A stale preview never commits.
- SQL failure rolls back the entire operation.
- Refresh after success reconstructs the same terminal transaction and financial state.
- Network or service errors retain the entered form and present the actual safe error category; the UI must not claim success without confirmation.

## 18. API boundaries

The Worker exposes authenticated same-origin actions for:

- transaction history query;
- transaction detail;
- correction preview and commit;
- deletion preview and commit;
- restoration preview and commit;
- undo preview and commit;
- replacement preview and commit;
- balance-history query.

Read actions perform zero writes. Mutation actions accept only logical transaction IDs, never arbitrary client-supplied SQL identities or before-values. The server reloads authoritative state and computes all effects.

## 19. Migration and historical treatment

Any migration is additive. It may add narrowly scoped transaction identity, component-link, status, or audit fields/tables required by this specification. It must not rewrite or recategorize existing factual rows.

Before deployment, a read-only preflight must classify every existing row into one of:

1. unambiguously grouped logical transaction;
2. immutable balance observation;
3. non-transaction factual/configuration record;
4. ambiguous legacy item, displayed separately and mutation-disabled.

The preflight reports counts and identities; it does not repair production. Zero ambiguity is not required for safe read-only display, but every mutable historical transaction must be unambiguous.

## 20. Backup and restore

All new tables, columns, identities, component links, statuses, audit evidence, and request receipts must be included in the existing portable backup and dependency-ordered restore.

An isolated restore must reproduce:

- identical terminal logical transactions;
- identical default and audit-visible history;
- identical balances and reconciliation differences;
- identical obligation state;
- identical EF/Goal balances and commitment completion;
- identical salary/reporting assignments;
- identical idempotent replay results.

No special recovery subsystem is authorized.

## 21. Phone and desktop behavior

Phone is the primary interaction surface. Search, filters, transaction detail, guided correction, preview, and destructive-action confirmations must fit without horizontal scrolling. Important monetary consequences appear before technical detail.

Desktop uses the same terminology, ordering, permissions, and workflows. Additional width may expose filters and detail side by side but must not introduce different financial behavior.

All controls and dynamic messages must remain available in English and Russian without translating persisted names, categories, identifiers, or financial values.

## 22. Acceptance matrix

The implementation is not complete until every applicable case below passes against the exact candidate SHA.

| ID | Scenario | Required result |
|---|---|---|
| TH-01 | Open history with valid current salary cycle | Current cycle selected; terminal logical transactions ordered newest first |
| TH-02 | Current boundary unavailable | No inferred range; explanation plus custom/all-history choices |
| TH-03 | Search by category | All and only matching logical transactions returned |
| TH-04 | Search exact amount and range expressions | Server-validated results use logical totals in satang |
| TH-05 | Multi-filter query over paginated data | Count and totals cover full result set; no silent truncation |
| TH-06 | Internal transfer in totals | Shown in history but excluded from household income/spending totals |
| TH-07 | Split payment | One logical transaction with all allocations in detail |
| TH-08 | Ambiguous legacy rows | Separate read-only items; mutation disabled with explanation |
| TH-09 | Default history | Deleted, reversed, and intermediate versions hidden |
| TH-10 | Audit visibility enabled | Complete ordered chain visible with actor, reason, time, and impact |
| TH-11 | Balance history | Balance checks visible separately and have no ordinary mutation actions |
| TC-01 | Correct payment date | Preview then atomic replacement; original preserved |
| TC-02 | Change payment account Alex to Olga | Exact amount restored to Alex and deducted from Olga; combined cash unchanged |
| TC-03 | Correct payment amount/category/description | Typed fact, balance effect, reports, and audit agree after refresh |
| TC-04 | Correct split allocation | All components update atomically; total and account effects reconcile |
| TC-05 | Correct more than one detail | Only submitted permitted fields change |
| TC-06 | Try to change transaction kind in correction | Rejected and directed to Replace transaction |
| TC-07 | Re-correct corrected transaction | Only terminal replacement participates in every read model |
| TC-08 | Invalid amount/date/account/category | Rejected before revision claim; zero writes |
| TC-09 | Stale preview | Rejected; fresh preview required; zero partial effects |
| TD-01 | Delete ordinary payment | Cash restored to original allocation; item hidden by default; audit retained |
| TD-02 | Default deletion reason | Entered by mistake preselected and stored unless changed |
| TD-03 | Duplicate deletion retry | Original success replayed; exactly one reversal/effect set |
| TD-04 | Delete fixed-obligation payment | Occurrence reopens by exact terminal payment amount |
| TD-05 | Delete KTB transfer | Both sides reverse; combined KTB unchanged |
| TD-06 | Delete EF/Goal contribution | Factual balance and current-cycle completion recalculate from terminal facts |
| TD-07 | Delete EF/Goal withdrawal | Fund balance restored; no invented completion |
| TR-01 | Restore last active version | New audited effects recreate last active version exactly once |
| TR-02 | Restore original version | Explicit choice; preview distinguishes it from last active version |
| TR-03 | Restore retry | Same request replays success without duplicates |
| TU-01 | Undo eligible action | New audit operation restores immediately preceding authoritative state |
| TU-02 | Undo after unsafe dependent activity | Refused with explanation; no writes |
| TX-01 | Replace payment with income | Old effects reverse and new typed effects commit in one batch |
| TX-02 | Replacement target invalid | Neither reversal nor replacement commits |
| RC-01 | Historical correction before later balance check | Observation unchanged; exact reconciliation difference shown |
| RC-02 | New balance check after correction | Current position anchors to new observation without rewriting history |
| OB-01 | Delete partial obligation payment | Outstanding increases by deleted amount; status remains factual |
| OB-02 | Correct payment to another occurrence | Both occurrence impacts previewed and reconstructed correctly |
| SG-01 | Contribution corrected to smaller amount | Commitment completion and outstanding recalculate correctly |
| SG-02 | Contribution corrected to withdrawal | Original and reversal do not double-count; terminal replacement controls |
| SG-03 | Withdrawal corrected to contribution | Terminal contribution counts once |
| SG-04 | Later ordinary withdrawal after completion | Commitment remains completed |
| SC-01 | Salary correction with reporting enabled | Guarded preview required and exact reporting movements shown |
| SC-02 | Salary deletion changes qualifying receipt set | Boundary/commitment/reporting impact handled atomically or safely refused |
| SC-03 | Salary change would affect frozen weeks | Frozen snapshots unchanged and explicitly reported |
| SC-04 | Salary result ambiguous | Operation refused; no inferred next salary date; zero writes |
| ID-01 | Same ID/same payload after lost response | Original response returned; one financial effect |
| ID-02 | Same ID/different payload | Rejected; original remains authoritative |
| CC-01 | Two writers at same revision | Exactly one commits; loser receives stale-writer result |
| FL-01 | Forced SQL failure | Claim, effects, audit, request receipt, and revision all roll back |
| SR-01 | Serialization/reload | Browser refresh reconstructs identical terminal transaction and totals |
| BR-01 | Portable backup and isolated restore | All transaction, audit, reconciliation, and replay invariants identical |
| AU-01 | Both household users | Each can correct/delete/restore/undo and actor is recorded accurately |
| AU-02 | Unauthenticated or cross-origin request | Rejected with zero reads of private data and zero writes |
| UI-01 | Phone guided correction | Relevant fields and plain-language preview fit without horizontal scroll |
| UI-02 | English/Russian switch | Meaning and financial values unchanged; persisted names untranslated |

## 23. Required implementation evidence

For the candidate SHA, the execution ledger must record:

`action — exact SHA — exact command/check — observed result`

Evidence must include:

1. schema/migration review and representative-copy dry run;
2. deterministic historical preflight report;
3. valid, invalid, mutation, retry, concurrency, reversal, re-correction, deletion, restore, undo, ordering, serialization, and read-model tests;
4. obligation, EF, Goal, salary-cycle, weekly-freeze, and reporting regression suites;
5. production regression suite;
6. browser tests at phone and desktop widths;
7. portable backup, isolated restore, and post-restore equivalence;
8. one adversarial review of the whole invariant family;
9. separate owner authorization gates for migration, deployment, and any production repair.

Green tests alone are not an acceptance verdict. The implementation is accepted only when the matrix and evidence are reviewed against the exact candidate SHA and the owner explicitly accepts it.

## 24. Production incident note

Read-only production evidence on 11 September 2026 showed two successful `balance_history` correction audits for original balance row `131`, at base revisions `92` and `93`. Both preserved the original one-off metadata identifying Alex as the paying account. The latest replacement recorded Alex balance as zero. This confirms that persistence succeeded while the record-oriented UI did not express the user’s intended transaction correction.

This note is diagnostic evidence only. It does not authorize or prescribe a production data repair. Repair requires a separately reviewed factual before/after plan and explicit owner authorization.
