# Family Cash Flow — Transaction History and Correction Specification REV1

**Date:** 11 September 2026  
**Status:** Proposed replacement specification; not owner-accepted  
**Repository baseline reviewed:** `6f08eb03f9cda40ea2cb357dd4e69a09a3747164`  
**Business timezone:** `Asia/Bangkok`  
**Replaces if accepted:** `14_TRANSACTION_HISTORY_AND_CORRECTION_SPECIFICATION_2026-09-11.md`

## 1. Purpose

Replace the record-oriented **Correct a record** page with a household-oriented transaction history where Alex or Olga can find and understand logical financial transactions and, where proven safe, correct, delete, restore, or undo them.

The implementation must prevent the observed failure mode in which a user selected a balance row intending to correct who paid, but the application changed the balance observation while preserving unrelated payment metadata.

This revision separates the work into independently accepted safety, read-only, ordinary-transaction, and salary-management slices. No mutation family becomes available merely because its history row can be displayed.

This specification does not authorize implementation, migration, deployment, production mutation, or production repair. Each remains a separate owner-authorized step.

## 2. Authority and compatibility

If accepted, this specification controls transaction history, transaction correction, deletion, restoration, replacement, undo, and transaction-related reconciliation presentation.

Existing authoritative rules remain in force unless this document explicitly changes behavior in that scope:

- accounting facts, commitments, and planning remain separate;
- business dates use Bangkok dates;
- money is stored as integer satang;
- expected income never counts before receipt;
- Available may be negative and is never clamped;
- Variables target is planning only and never reserves cash;
- EF and Goal commitment completion follows authoritative logical contributions;
- later ordinary withdrawals do not recreate completed commitments;
- a salary transition freezes missing weekly snapshots before resetting current-only planning state;
- frozen weekly snapshots and balance observations are immutable;
- every financial mutation uses a revision claim and one atomic D1 batch;
- server validation is authoritative;
- backups and isolated restores round-trip every added field and relationship.

This document supersedes the earlier phone correction rule only within this scope. Correction remains contextual: a user first selects a logical transaction.

## 3. Definitions

**Logical transaction:** one household financial action, regardless of the number of factual rows required to represent it.

**Component:** an existing typed factual row participating in a logical transaction, such as a payment, allocation, cash effect, receipt, Ledger movement, or obligation payment.

**Version:** one complete authoritative factual meaning of a logical transaction.

**Terminal version:** the latest authoritative version after applying correction, deletion, restoration, replacement, and undo operations.

**Balance observation:** an immutable dated statement of one or both KTB balances. It is not a transaction.

**Management operation:** an audited correction, deletion, restoration, replacement, or undo. It is not household income, spending, or an internal transfer.

**Ambiguous legacy item:** historical facts that cannot be grouped into one logical transaction using durable evidence.

**Dependent activity:** later activity whose safe interpretation relies on the current terminal version, including later management operations, salary-cycle transitions, obligation allocation changes, or other relationships identified by the transaction-family invariant.

## 4. Explicit non-goals

The implementation must not introduce:

- generic event sourcing;
- a generic effect or correction graph;
- a generic migration framework;
- a universal transaction table duplicating all factual tables;
- editable or deletable balance observations;
- editable or deletable frozen weekly snapshots;
- permanent erasure of financial or audit facts;
- bulk correction, deletion, or restoration;
- fuzzy historical grouping by dates, amounts, descriptions, or row adjacency;
- a special recovery subsystem;
- production repair, migration, deployment, or Cloudflare configuration changes without separate authorization.

## 5. Delivery stages and authorization gates

The work is delivered in this order:

1. safety patch;
2. additive identity/audit schema and deterministic historical preflight;
3. read-only Transaction history and Balance history;
4. one-off payment management;
5. other-income management;
6. fixed-obligation payment management;
7. KTB transfer management;
8. EF and Goal movement management;
9. separately reviewed salary-receipt management;
10. additive migration, deployment, and any production repair as separate owner-authorized operations.

Each stage has its own candidate SHA and acceptance verdict. Passing a later read-only stage does not authorize mutation. A transaction kind remains mutation-disabled until its complete invariant family passes.

## 6. Immediate safety patch

Before transaction-management mutations are implemented:

- remove **Balance / recorded movement** from the correction catalog;
- reject balance correction on the server even when submitted by an older client;
- disable cash-affecting obligation-payment correction until it reconstructs the complete payment and cash effects;
- disable EF/Goal movement correction until it reconstructs both the fund and KTB effects;
- retain salary-cycle correction only through the existing revision-bound reporting preview;
- show a plain-language mutation-disabled explanation and a safe alternative.

The safe alternative may suggest recording a new balance observation or waiting for transaction management. It must not suggest changing another factual transaction to force reconciliation.

The safety patch does not repair or rewrite existing production facts.

## 7. User and permission model

Alex and Olga have equal permission to view all household transactions and, for enabled transaction kinds, correct, delete, restore, and undo them.

Authenticated actor identity is separate from financial account identity. The actor is the signed-in email; `Alex` and `Olga` are paid-from or received-into accounts. The application must never infer the account from the actor.

Every committed management operation records:

- authenticated actor;
- Bangkok-effective business date where applicable;
- UTC timestamp;
- operation reason and optional explanation;
- stable commit request ID;
- semantic payload hash;
- preview/base revision;
- committed revision;
- write token.

Historical creation actor or timestamp may be unavailable. The UI says **Not recorded** rather than inventing it.

## 8. Information architecture

### 8.1 Transaction history

The application adds a first-class **Transaction history** destination showing logical household transactions.

Included financial kinds, as their delivery stages become accepted:

- one-off payment;
- fixed-obligation payment;
- salary receipt;
- other-income receipt;
- KTB-to-KTB transfer;
- EF contribution or withdrawal;
- Goal contribution or withdrawal.

Management operations appear only inside a transaction's audit chain and audit-aware search results. They are never counted as financial transactions or as money in/out.

Excluded from Transaction history:

- balance observations;
- planning targets and commitments;
- configuration changes;
- frozen weekly snapshots;
- raw revision claims, receipts, and technical audit rows.

### 8.2 Balance history

Balance observations appear in a separate **Balance history** view. They are immutable and have no ordinary edit, delete, restore, replacement, or undo controls.

If a discrepancy was caused by a transaction, the UI links to Transaction history. If the observation itself is factually invalid, the UI instructs the user to record a new observation. Any future invalid-observation workflow requires a separate specification.

### 8.3 Periods

Transaction history opens on the current salary cycle when its recorded boundary is available. The selector offers:

1. Current salary cycle;
2. Previous salary cycle;
3. Custom date range;
4. All history.

Custom endpoints are inclusive Bangkok business dates. The active period and Bangkok timezone are visible.

When a current boundary is unavailable, the application does not infer one. It explains the unavailable boundary and offers Custom date range and All history.

### 8.4 Search and filters

The initial read-only release supports:

- free text over description, payee/source, category name, and account name;
- category multi-select;
- transaction-kind filter;
- account filter;
- exact amount;
- minimum and maximum amount fields;
- clear-all.

Actor and management-operation filters appear only when **Show corrections and deleted records** is enabled.

Amount filters apply to the logical transaction total in satang. Locale formatting affects display only. Minimum and maximum endpoints are inclusive.

The result count, money-in total, and money-out total cover the complete filtered set. Internal transfers and management operations are excluded from money-in/out totals.

Free-form expressions such as `>1000` and `450–550` are deferred. They may be added later without changing stored or query semantics.

### 8.5 Ordering and pagination

Transactions are ordered by:

1. business date descending;
2. committed revision descending;
3. logical transaction ID descending.

Pagination uses an opaque cursor bound to the query, filters, and household revision at which the first page was created. Later pages use that same revision snapshot or return a stale-query response requiring restart. They must not silently mix revisions, duplicate, omit, or truncate transactions.

Search, count, and totals apply to the complete revision-bound result set, not only loaded rows.

## 9. Logical transaction identity and components

New multi-row financial actions receive one durable logical transaction ID at creation. Every participating factual row is linked directly or is deterministically reachable from one typed parent.

The additive schema may introduce narrowly scoped structures equivalent to:

- `logical_transactions`: identity, household, kind, lifecycle status, business date, creation evidence, and terminal version;
- `logical_transaction_components`: logical ID, typed component identity, and component role;
- `transaction_management_audit`: immutable operation relationship and summarized impact.

Existing typed factual tables remain accounting authority. The identity layer must not duplicate amounts or balances as an alternative accounting source.

A component relationship is immutable after commit. Correcting a transaction creates a new complete version with new components; it does not retarget old components.

## 10. Historical adapter and preflight

Before migration or historical mutation, a read-only preflight classifies existing material into:

1. unambiguously grouped logical transaction and its components;
2. immutable balance observation;
3. non-transaction factual, planning, or configuration record;
4. ambiguous legacy item.

Durable grouping evidence is limited to request IDs, write tokens, committed revisions, typed parent IDs, foreign keys, and an explicitly reviewed mapping.

Matching date, amount, description, account, source name, or adjacent row order is never sufficient evidence.

Ambiguous items remain separately visible and mutation-disabled. The explanation identifies the missing relationship without exposing raw internal table names in the primary UI.

The preflight reports counts and stable identities by classification and makes zero writes. Zero ambiguity is not required for safe display, but every mutable historical transaction must be unambiguous.

## 11. Authoritative transaction read model

Each logical transaction exposes:

- logical transaction ID;
- kind and lifecycle status;
- terminal business date;
- description, payee, or source;
- category where applicable;
- total amount in satang;
- direction: money in, money out, or internal movement;
- source and destination accounts and allocations;
- typed component identities and roles;
- creation actor and timestamp, or explicit unavailability;
- terminal version and committed revision;
- permitted management actions and refusal reasons;
- reconciliation impact state;
- audit summary.

The default list includes only active terminal logical transactions. Originals, reversals, intermediate versions, deleted transactions, and management operations appear only when audit visibility is enabled.

All financial totals, dashboard state, reports, previews, reloads, backups, and restores use the same terminal interpretation. No correction may appear in audit while being ignored by another authoritative consumer.

## 12. Transaction detail

Selecting a transaction shows:

- complete current factual meaning in household language;
- date, amount, category, description, and allocations;
- obligation, EF, Goal, salary-cycle, and reporting consequences where applicable;
- reconciliation state;
- complete ordered audit chain;
- permitted contextual actions;
- an expandable technical section containing component IDs, revisions, request IDs, and write tokens.

The primary actions for active eligible items are **Correct transaction** and **Delete transaction**. Deleted eligible items offer **Restore transaction**. A recent eligible management operation offers **Undo**.

## 13. Correction workflow

### 13.1 Guided selection

The first step asks **What needs correcting?** and offers only fields supported by that transaction kind:

- Date;
- Amount or allocation;
- Paid-from or received-into account;
- Category;
- Description or source;
- More than one detail.

A single-detail choice shows only the selected field. **More than one detail** shows the complete permitted form.

### 13.2 Kind-specific rules

A correction cannot silently change transaction kind.

**One-off payment:** date, amount/allocation, paid-from account, category, and description. Allocation components must be positive satang, use supported accounts, and sum exactly to the transaction total. Removing an account removes its component; zero-valued components are not stored.

**Other income:** receipt date, amount/allocation, received-into account, and source within the same income class. The selected source must have been valid on the corrected receipt date. Allocations follow the same sum and zero rules.

**Fixed-obligation payment:** payment date, amount/allocation, paid-from account, occurrence, and note. Payment status is derived from terminal payments versus the occurrence amount; it is not independently editable.

**KTB transfer:** date, amount, source, and destination. Source and destination must differ. Combined KTB remains unchanged.

**EF/Goal movement:** date, amount, direction, KTB account, and Goal identity where permitted. The complete fund and KTB sides are reconstructed together.

**Salary receipt:** handled only by the separately accepted guarded salary flow.

Changing between fundamentally different kinds uses an explicitly supported **Replace transaction** operation. Unsupported kind pairs are refused.

Inactive historical categories, sources, obligations, and Goals remain displayable. They are selectable in correction or restoration only when kind-specific server rules prove that selection valid for the effective business date.

### 13.3 Authoritative preview

Every management operation begins with a read-only server preview calculated from current authoritative state.

The preview receives a client correlation ID but stores nothing. It returns:

- preview revision;
- terminal transaction/version identity;
- values before and after;
- per-account cash restored or removed;
- combined household-cash change;
- obligation occurrence impact;
- EF/Goal factual and commitment impact;
- salary/reporting impact where applicable;
- per-account reconciliation difference;
- warnings and refusal reasons;
- an expiry timestamp when the operation has time-based eligibility.

The preview makes zero writes. The final commit has a separate stable commit request ID and includes the preview revision and terminal version identity.

If authoritative state or the terminal version changed, commit fails stale with zero writes and requires a new preview.

### 13.4 Commit semantics

Within one atomic D1 batch, the server:

1. validates the stable commit request ID and semantic payload;
2. claims the preview/base revision;
3. reloads and verifies the terminal logical transaction;
4. validates the fields and complete kind invariant;
5. reverses every effect of the terminal version;
6. creates one complete typed replacement version;
7. links all new components to the logical transaction;
8. writes one immutable management audit operation;
9. stores the request receipt and original success response;
10. advances the household revision exactly once.

Original facts and intermediate versions remain immutable. Only the terminal active version participates in balances, spending totals, commitment completion, reports, and subsequent management.

## 14. Delete transaction

**Delete transaction** means that the logical transaction was entered by mistake. It never physically deletes factual, audit, or request-receipt rows.

The reason defaults to **Entered by mistake**. Other reasons are:

- Duplicate entry;
- Wrong household;
- Test entry;
- Other.

**Other** requires an explanation. An explanation is optional for the other reasons.

Deletion reverses every effect of the terminal version, creates immutable audit evidence, marks the logical transaction deleted, and stores one idempotent receipt in the same batch.

Deletion is refused when the complete transaction cannot be identified or reversed safely.

Consequences include:

- payment deletion restores exact account allocations;
- fixed-obligation payment deletion recalculates the occurrence from terminal payments;
- income deletion removes exact receiving allocations;
- KTB-transfer deletion reverses both sides and preserves combined KTB;
- contribution deletion removes factual contribution and recalculates current-cycle completion;
- withdrawal deletion restores factual fund balance but never invents contribution completion;
- unsafe salary deletion is refused or handled by the accepted guarded salary flow.

Deleted items are hidden by default and visible through audit visibility. Audit-visible deleted and reversal rows never enter money-in/out totals.

## 15. Restore transaction

The initial implementation supports only **Restore last active version**.

Restore creates a new complete version and new audited financial effects. It never removes deletion evidence or reactivates old components in place.

Restoring an earlier original version is deferred. A user who needs different values restores the last active version and then uses correction, with separate previews and audit entries.

Restore is refused if the last active version is unavailable, ambiguous, invalid under authoritative invariants, or unsafe because of dependent activity.

Repeated commits with the same request ID and semantic payload return the original successful response without duplicate effects.

## 16. Undo

After correction, deletion, restoration, or supported replacement, the UI offers Undo for 10 minutes from the committed UTC timestamp.

The server, not the client timer, determines eligibility. Undo is permitted only when:

- the operation remains the logical transaction's latest management operation;
- the household revision and terminal version match the previewed state;
- no dependent activity makes reversal unsafe;
- the immediately preceding authoritative state is unambiguous and valid.

Undo creates a new audited operation and complete new version. It never erases history. When refused, the UI explains the blocking dependency and directs the user to a new correction or guarded workflow.

## 17. Replace transaction

Replacement is enabled only for explicitly implemented and accepted kind pairs. The initial supported pair is:

- one-off payment to other-income receipt;
- other-income receipt to one-off payment.

Other pairs, including salary replacements, remain disabled until separately specified and accepted.

A replacement atomically:

1. reverses and closes the terminal source transaction;
2. validates and creates the complete typed target transaction;
3. records one immutable replacement relationship;
4. stores one request receipt;
5. advances the household revision once.

If either side fails, neither side commits. The replacement must satisfy every creation invariant of its target kind.

## 18. Reconciliation and balance observations

Balance observations are immutable. No transaction-management operation rewrites one.

Current position uses the latest usable confirmed observation for each account plus subsequent terminal authoritative transactions. When an observation contains only one account, reconciliation is computed only for that account; combined reconciliation is unavailable unless both account positions are authoritative.

When historical transaction management conflicts with a later observation, the system:

- preserves the observation;
- records the management operation;
- previews and exposes the exact per-account difference;
- exposes a combined difference only when both accounts are authoritative;
- never silently adjusts another fact;
- suggests recording a new balance observation when appropriate.

History, dashboard, reports, and previews must use the same reconciliation interpretation.

## 19. Fixed obligations

An occurrence's factual paid amount is the sum of terminal authoritative payments assigned to it.

- zero paid means unpaid;
- more than zero but less than the occurrence amount means partial;
- the occurrence amount or more means paid/final, with any overpayment shown explicitly rather than discarded.

Deleting a payment recalculates the occurrence. Restoring reapplies the last active allocation. Correcting occurrence assignment previews both the old and new occurrences.

No independently editable status field may contradict terminal payment facts.

## 20. EF and Goal rules

Authoritative terminal contributions in the current salary cycle determine completed commitment amounts.

- deleting a contribution removes it from completed amount and may reopen outstanding commitment;
- restoring it may complete the commitment again;
- correcting amount or direction recalculates completion from terminal movements;
- deleting a withdrawal restores factual fund balance but does not count as a contribution;
- restoring an ordinary withdrawal reduces factual fund balance and does not recreate completed commitment;
- Goal lifetime targets remain planning/reference data and are not edited through transaction management.

Every EF/Goal movement version contains both the fund movement and corresponding KTB effect. Neither side may commit alone.

If a relevant chain cannot be resolved, `degraded_correction_data` remains fail-closed and names affected accounts.

## 21. Salary receipts

Salary-receipt correction, deletion, restoration, replacement, and undo are excluded from ordinary transaction management until a separate salary-management candidate is accepted.

The guarded preview must show:

- exact account changes;
- changes to qualifying salary-receipt membership;
- active-cycle boundary impact;
- commitment return/reset impact;
- reporting-cycle assignment changes;
- payments moving between reporting cycles;
- frozen weekly snapshots that remain preserved;
- any ambiguity requiring refusal.

Frozen snapshots are never unfrozen or rewritten. The operation never infers `next_salary_date`. If one unambiguous authoritative result cannot be reconstructed, the mutation is refused with zero writes.

## 22. Audit presentation and immutability

**Show corrections and deleted records** is off by default.

When enabled, detail and audit-aware search show the complete ordered chain:

- Created;
- Corrected;
- Deleted;
- Restored;
- Replaced;
- Undone.

Each operation shows actor, UTC time rendered for Bangkok, reason, before/after summary, financial impact, and committed revision. Raw JSON, internal table names, component IDs, request IDs, and write tokens appear only in an expandable technical section.

Audit records, request receipts, revision claims, and component relationships are immutable. Application endpoints must not update or delete them.

Audit-visible non-terminal facts and management operations never participate in financial totals.

## 23. Idempotency, concurrency, and failure behavior

Read-only previews receive correlation IDs and perform zero writes.

Commits receive client-generated stable request IDs. The server stores a canonical semantic payload hash and original successful response atomically with all effects.

- same request ID and same semantic payload returns the original success;
- same request ID and different payload is rejected;
- a lost-response retry never duplicates effects;
- two different requests from one base revision cannot both commit;
- stale revision, stale terminal version, or expired eligibility commits nothing;
- forced SQL failure rolls back claim, components, audit, receipt, and revision;
- refresh reconstructs identical terminal transactions and financial state;
- network/service errors retain entered values and report the safe error category;
- the client never claims success without server confirmation.

## 24. API boundaries

Authenticated same-origin read actions:

- transaction-history query;
- transaction detail;
- balance-history query;
- correction preview;
- deletion preview;
- restoration preview;
- undo preview;
- supported replacement preview.

Authenticated same-origin mutation actions:

- correction commit;
- deletion commit;
- restoration commit;
- undo commit;
- supported replacement commit.

Reads perform zero writes. Mutations accept logical transaction IDs and intended new values only. They never accept arbitrary SQL identities, client-supplied before-values, computed financial effects, or lifecycle status.

The server reloads authoritative state and computes every effect.

## 25. Migration and historical treatment

Migration is additive. It may add only the narrow logical identity, component relationship, lifecycle, audit, and request-receipt structures required here.

It must not rewrite, recategorize, delete, or attach guessed relationships to existing factual rows.

Before migration authorization:

- run the read-only preflight against a representative restored production backup;
- report counts and identities for every classification;
- review every proposed mutable historical mapping;
- prove ambiguous items remain displayable and mutation-disabled;
- prove no classification changes Accounting, Available, commitments, reports, or frozen snapshots.

## 26. Backup and restore

The existing portable backup includes every added table, column, identity, component relationship, lifecycle status, audit operation, and request receipt in dependency order.

An isolated restore reproduces:

- identical terminal transactions;
- identical default and audit-visible history;
- identical balances and reconciliation differences;
- identical obligation state;
- identical EF/Goal balances and commitment completion;
- identical salary/reporting assignment;
- identical idempotent replay responses;
- identical mutation eligibility and refusal reasons.

No new recovery subsystem is authorized.

## 27. Phone, desktop, and language behavior

Phone is the primary surface. Search, filters, detail, guided correction, preview, confirmations, restore, and Undo fit without horizontal scrolling. Financial consequences appear before technical details.

Desktop uses identical terminology, ordering, permissions, and financial behavior. It may show filters and detail side by side.

All controls, errors, warnings, refusal reasons, and dynamic messages are available in English and Russian. Persisted names, categories, identifiers, accounts, dates, and monetary values are never translated or changed by locale switching.

## 28. Acceptance matrix

### 28.1 Safety and read-only history

| ID | Scenario | Required result |
|---|---|---|
| SAFE-01 | Old client submits balance correction | Rejected before revision claim; zero writes |
| SAFE-02 | Open legacy correction catalog | Balance observations absent; unsafe transaction families disabled |
| TH-01 | Valid current salary cycle | Current cycle selected; terminal transactions newest first |
| TH-02 | Boundary unavailable | No inferred range; explanation plus custom/all choices |
| TH-03 | Inclusive Bangkok custom range | Only transactions within both endpoints returned |
| TH-04 | Category, kind, account, text, and amount filters | Exact logical results returned from server |
| TH-05 | Revision-bound paginated query | No duplicates, omissions, silent truncation, or mixed revisions |
| TH-06 | Filtered totals | Full result set counted; transfers/audit operations excluded |
| TH-07 | Split transaction | One logical row; allocations complete in detail |
| TH-08 | Ambiguous legacy facts | Separate read-only items with precise explanation |
| TH-09 | Default history | Only active terminal versions visible |
| TH-10 | Audit visibility | Complete chain visible; totals unchanged |
| BH-01 | Balance history | Observations separate and immutable; partial accounts explicit |

### 28.2 Shared management protocol

| ID | Scenario | Required result |
|---|---|---|
| MP-01 | Preview | Authoritative complete impact returned; zero writes |
| MP-02 | Stale revision or terminal version | Commit rejected; fresh preview required; zero writes |
| MP-03 | Same ID and same payload retry | Original response returned; one effect set |
| MP-04 | Same ID and different payload | Rejected; original remains authoritative |
| MP-05 | Two writers at same revision | Exactly one commits |
| MP-06 | Forced SQL failure | Claim, effects, relationships, audit, receipt, revision all roll back |
| MP-07 | Refresh after success | Identical terminal version, totals, and permitted actions |
| MP-08 | Both users | Equal permission; correct actor recorded; account not inferred |

### 28.3 One-off payments and income

| ID | Scenario | Required result |
|---|---|---|
| PI-01 | Correct payment date | Original preserved; complete replacement participates once |
| PI-02 | Change Alex payment to Olga | Alex restored, Olga deducted, combined cash unchanged |
| PI-03 | Correct split allocation | Components sum exactly; account effects reconcile atomically |
| PI-04 | Correct amount/category/description | Accounting, reports, history, and audit agree |
| PI-05 | Re-correct | Only newest terminal version participates |
| PI-06 | Delete payment | Exact allocation restored; deleted item hidden by default |
| PI-07 | Restore payment | Last active version recreated once with new effects |
| PI-08 | Correct other-income receipt | Exact receiving allocation and source/date rules enforced |
| PI-09 | Delete/restore income | Exact allocations reverse/reapply once |
| PI-10 | Replace payment with other income | Source reverses and valid target commits in one batch |
| PI-11 | Invalid replacement target | Neither side commits |

### 28.4 Obligations, transfers, EF, and Goals

| ID | Scenario | Required result |
|---|---|---|
| OB-01 | Correct obligation payment amount/account | Payment and KTB effects agree; status derived |
| OB-02 | Move payment to another occurrence | Both occurrence impacts previewed and reconstructed |
| OB-03 | Delete partial payment | Outstanding increases exactly; status recalculates |
| KT-01 | Correct/delete KTB transfer | Both sides update; combined KTB unchanged |
| SG-01 | Correct contribution smaller | Fund, KTB, completion, and outstanding agree |
| SG-02 | Contribution to withdrawal | Original/reversal do not double-count; terminal controls |
| SG-03 | Withdrawal to contribution | Terminal contribution counts once |
| SG-04 | Delete/restore contribution | Factual and commitment effects recalculate exactly |
| SG-05 | Delete/restore withdrawal | Fund and KTB effects reverse; no invented completion |
| SG-06 | Withdrawal after completed contribution | Commitment remains completed |
| SG-07 | Unresolved chain | Fail closed with affected accounts; zero unsafe mutation |

### 28.5 Undo, reconciliation, salary, backup, and UI

| ID | Scenario | Required result |
|---|---|---|
| UN-01 | Undo within 10 minutes with no dependency | New audited version restores preceding state |
| UN-02 | Undo expired or dependent | Refused with reason; zero writes |
| RC-01 | Historical change before later observation | Observation unchanged; exact available differences shown |
| RC-02 | Partial observation | Only authoritative account difference shown; combined unavailable |
| RC-03 | New observation after correction | Position re-anchors without rewriting history |
| SC-01 | Salary management disabled before acceptance | Mutation refused; read-only detail remains available |
| SC-02 | Guarded salary preview | Complete boundary, commitment, reporting, and freeze impact shown |
| SC-03 | Ambiguous salary result | Refused; no inferred next salary date; zero writes |
| SC-04 | Salary affects frozen weeks | Frozen snapshots unchanged and explicitly reported |
| BR-01 | Portable backup and isolated restore | Terminal, audit, reconciliation, eligibility, and replay identical |
| UI-01 | Phone workflow | No horizontal scroll; consequences precede technical detail |
| UI-02 | English/Russian switch | Meaning and financial values unchanged; persisted names untranslated |

## 29. Required evidence and verdict rules

For every candidate SHA, the execution ledger records:

`action — exact SHA — exact command/check — observed result`

Evidence includes:

1. schema review and representative-copy migration dry run;
2. deterministic historical preflight report;
3. valid, invalid, mutation, retry, race, reversal, re-correction, deletion, restore, undo, ordering, pagination, serialization, and read-model tests;
4. obligation, EF, Goal, salary-cycle, weekly-freeze, reporting, dashboard, and Available regression suites;
5. production regression suite;
6. phone and desktop browser tests in English and Russian;
7. portable backup, isolated restore, and post-restore equivalence;
8. adversarial review of the complete invariant family for each enabled transaction kind;
9. explicit evidence that disabled kinds remain server-rejected;
10. separate owner authorization gates for migration, deployment, and production repair.

Green tests alone are not an acceptance verdict. A stage is complete only when its applicable matrix and evidence are reviewed against the exact candidate SHA and the owner explicitly accepts that stage.

## 30. Production incident boundary

Read-only evidence recorded on 11 September 2026 showed two successful `balance_history` correction audits for original balance row `131`, at base revisions `92` and `93`. Both preserved original one-off metadata identifying Alex as the paying account; the latest replacement recorded Alex balance as zero.

This evidence motivates the safety patch and logical-transaction design. It does not authorize a repair.

Any repair requires a separately reviewed factual before/after plan, proof of its effect on balances, commitments, reports, reconciliation, and backup/restore, and explicit owner authorization immediately before production mutation.
