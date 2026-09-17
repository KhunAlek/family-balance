# Family Cash Flow — Transaction History and Correction Staged Implementation Specification

**Prepared:** 11 September 2026  
**Business timezone:** Asia/Bangkok  
**Initial repository baseline:** `6f08eb03f9cda40ea2cb357dd4e69a09a3747164`  
**Requirement source:** `15_TRANSACTION_HISTORY_AND_CORRECTION_SPECIFICATION_REV1_2026-09-11.md`  
**Requirement status:** Proposed; owner acceptance is required before it becomes implementation authority.

## 1. Purpose

This document converts the proposed Transaction History and Correction specification into a sequence that ChatGPT can implement safely across fresh chats. Each chat completes one bounded stage, records evidence against an exact candidate SHA, and creates the complete handoff packet and prompt for the next chat.

The process must preserve factual accounting and must not deploy, migrate production data, repair production data, change Cloudflare configuration, merge branches, or add dependencies without explicit owner authorization in the conversation where that action would occur.

## 2. Controlling rules

Every implementation chat must:

1. Read `AGENTS.md`, this master specification, the stage packet, and the requirement source before changing code.
2. Record the starting SHA and dirty-worktree state.
3. Treat existing unrelated changes as owner work and preserve them.
4. Maintain an execution ledger while work proceeds using:

   `action — exact SHA — exact command/check — observed result`

5. Work continuously through implementation, tests, review, and documentation. Do not stop for status updates or step-by-step confirmation.
6. Stop only for:
   - an unresolved material business rule;
   - a required authorization gate;
   - missing evidence or access that cannot be safely worked around;
   - conflicting owner changes that cannot be preserved.
7. Ask exactly one focused question when an owner decision is genuinely required.
8. Never edit an acceptance test merely to make implementation pass. Tests may change only when the accepted requirement changes the intended behavior, and the ledger must explain the authority and old/new expectation.
9. Inspect the entire invariant family before calling a mutation stage fixed: creation, invalid creation, mutation, retry, concurrency, reversal, correction, ordering, serialization, restore, and read-model reconstruction as applicable.
10. Create a local candidate commit after all applicable checks pass. Do not merge or deploy it.
11. Produce the next-stage handoff even when the current stage reveals follow-up defects. Unresolved defects must be classified as blocking or explicitly deferred by scope.

## 3. Authority hierarchy

Use this order when sources conflict:

1. Explicit owner decisions in the current conversation.
2. Repository `AGENTS.md` instructions.
3. An owner-accepted Transaction History and Correction specification.
4. The current stage packet.
5. Existing acceptance matrices and decision records that remain authoritative.
6. Existing implementation behavior and tests as evidence, not authority.

If item 3 has not been owner-accepted, Step 1 may still implement the separately authorized safety patch, but later feature stages must stop for acceptance before introducing new product behavior.

## 4. Permanent financial invariants

- Accounting facts, commitments, and planning remain separate.
- Business dates use Asia/Bangkok.
- Money is stored as integer satang.
- Expected income does not count before receipt.
- Available may be negative and is never clamped.
- Variables target is planning only and never reserves cash.
- EF and Goal contribution completion follows authoritative logical contributions.
- Ordinary withdrawals do not recreate completed commitments.
- Salary transition freezes missing weekly snapshots before resetting current-only planning.
- Frozen weekly snapshots and balance observations are immutable.
- Each financial mutation claims one revision and commits through one atomic D1 batch.
- Server validation is authoritative.
- Backup and isolated restore must round-trip every new field and relationship.
- No stage may silently rewrite historical accounting.

## 5. Standard stage lifecycle

### 5.1 Intake

- Verify all packet files and record their SHA-256 hashes.
- Read exact repository files at the starting SHA before describing current behavior.
- Confirm the stage's authorization boundary.
- Create or resume the stage execution ledger.

### 5.2 Implementation

- Add failing acceptance coverage for the authorized requirement.
- Implement the smallest coherent change.
- Run focused tests after each meaningful change.
- Inspect all call paths, including older clients and direct server requests.
- Preserve existing financial semantics outside the stage.

### 5.3 Verification

- Run focused tests.
- Run all relevant slice suites with a Node runtime that supports `node:sqlite`.
- Run static UI/i18n contract tests where UI or messages change.
- Inspect the final diff for scope creep, missing server validation, unsafe fallback, mutation without receipt, and accidental historical rewriting.
- Record exact commands and observed results.

### 5.4 Candidate and handoff

- Create a local candidate commit.
- Record the exact candidate SHA.
- Re-run the required acceptance checks at that SHA.
- Write the stage verdict without using “complete,” “accepted,” or “ready” unless its criteria are actually met.
- Generate the next-stage packet and a self-contained fresh-chat prompt.
- Package the documents into a ZIP.

## 6. Required deliverables from every stage

Each completed stage must produce:

1. `STAGE_<N>_RESULT.md`
   - scope and authorization;
   - starting and candidate SHA;
   - changed files;
   - requirement-to-evidence mapping;
   - known limitations;
   - verdict and required owner gate.
2. `STAGE_<N>_EXECUTION_LEDGER.md`
3. `STAGE_<N+1>_TASK_SPEC.md`
4. `STAGE_<N+1>_FRESH_CHAT_PROMPT.md`
5. Copies of controlling documents needed by the next chat.
6. A ZIP containing items 1–5.

The next prompt must not depend on hidden chat context. It must state the repository, candidate SHA, authorized actions, forbidden actions, required documents, acceptance criteria, verification commands or discovery instructions, and exact stop boundaries.

## 7. Stage sequence

### Stage 1 — Immediate safety patch

Goal: close the known unsafe correction paths without creating the new transaction system.

- Remove balance observations from the correction catalog.
- Reject balance correction server-side before revision claim.
- Disable cash-affecting obligation-payment correction in UI and server.
- Disable EF/Goal Ledger-movement correction in UI and server.
- Preserve the existing revision-bound salary-cycle reporting correction.
- Remove Goal configuration from the record-correction catalog or route users to the existing appropriate Goal settings surface without changing Goal business behavior.
- Provide plain English and Russian disabled explanations and safe alternatives.
- Prove old-client/direct-request rejection produces zero writes.

Gate: local candidate acceptance, then separate deployment authorization.

### Stage 2 — Identity model design and additive migration candidate

Goal: define the smallest durable logical transaction/version/component/audit model.

- Produce an explicit schema decision record before migration code.
- Add logical transaction, version, component, lifecycle, terminal pointer, and management audit structures.
- Add immutability triggers for committed identity/audit structures.
- Do not backfill guessed relationships.
- Extend portable backup inventory and validation.
- Prove a fresh schema and an upgrade preserve all existing accounting.

Gate: owner approval of schema and separate authorization before any representative-data migration run.

### Stage 3 — Deterministic historical preflight

Goal: classify existing material with zero writes.

- Classify unambiguous logical transactions, observations, non-transactions, and ambiguous legacy items.
- Use only durable evidence.
- Emit stable identities, counts, reasons, and proposed component mappings.
- Prove deterministic output and zero accounting changes.

Gate: authorization to run against an isolated representative production backup.

### Stage 4 — Canonical terminal transaction read model

Goal: provide one authoritative server representation consumed by every later history and management flow.

- Define transaction DTO and permitted-action/refusal contract.
- Resolve terminal versions and components.
- Preserve current dashboard, reports, Available, commitments, and weekly results.
- Fail closed on unresolved chains.

### Stage 5 — Read-only Transaction history

Goal: ship server query, periods, filters, totals, ordering, stale-safe pagination, details, and audit visibility without mutation controls.

Use a cursor containing the household revision and canonical query hash. If the revision differs on a later page, return a stale-query response; do not maintain cross-request database snapshots.

### Stage 6 — Immutable Balance history

Goal: separate actual observations from transaction-created balance effects and present partial-account authority accurately.

- No mutation controls.
- Reconciliation links point to logical transactions.
- Never double-apply transaction effects already incorporated into a selected observation.

### Stage 7 — Shared management protocol

Goal: build preview, stale validation, semantic request receipts, atomic version replacement, audit, replay, concurrency, and rollback infrastructure with all transaction kinds still mutation-disabled.

### Stage 8 — One-off payment correction/delete/restore/undo

Goal: enable the first complete transaction family using existing typed payment IDs, allocations, and linked balance effects.

Replacement to another kind remains disabled.

### Stage 9 — Other-income correction/delete/restore/undo

Goal: introduce any missing durable receipt parent needed for split allocations and enable complete other-income management.

### Stage 10 — Optional payment/other-income replacement

Goal: enable only the accepted payment ↔ other-income pairs. This stage may be explicitly deferred without blocking later families.

Use one logical transaction ID whose version kind may change only for accepted pairs. Do not close one ID and silently create an unrelated second transaction.

### Stage 11 — Fixed-obligation payment management

Goal: link each payment to its occurrence and exact cash components, derive status from terminal payments, and enable complete correction/delete/restore/undo.

### Stage 12 — KTB transfer management

Goal: add a typed transfer parent linking both KTB effects and prove combined KTB neutrality for every operation.

### Stage 13 — EF and Goal movement management

Goal: link fund and KTB effects, preserve contribution-completion rules, and fail closed on unresolved chains.

### Stage 14 — Separately guarded salary management

Goal: create and review a salary-specific design before enabling salary receipt mutation. Frozen snapshots remain immutable and `next_salary_date` is never inferred.

### Stage 15 — Full backup/restore equivalence

Goal: prove terminal transactions, audit history, reconciliation, eligibility, receipts, balances, commitments, salary/reporting assignment, and refusal reasons survive isolated restore.

Backup support should be added alongside every schema stage; this stage performs the complete cross-family equivalence verdict.

### Stage 16 — Phone, desktop, English, and Russian completion

Goal: perform full interaction and visual verification across all enabled transaction families.

### Stage 17 — Adversarial closeout

Goal: review every accepted invariant family, run the full regression and production-equivalent suites, document unresolved risks, and prepare separate migration, deployment, and repair authorization packets.

This stage does not itself authorize migration, deployment, merge, Cloudflare configuration changes, or production repair.

## 8. Minimal schema contract for Stage 2

Names may differ, but the semantics must be explicit:

### `logical_transactions`

- `logical_transaction_id`
- `household_id`
- `lifecycle_status`: active or deleted
- `terminal_version_id`
- creation evidence fields, nullable where historically unavailable

### `logical_transaction_versions`

- `version_id`
- `logical_transaction_id`
- `version_number`
- `kind`
- terminal business date
- committed revision
- creation/management operation reference

Amounts remain in typed accounting components rather than becoming an alternative accounting source.

### `logical_transaction_components`

- `version_id`
- typed component kind
- typed component identity
- role

The relationship is immutable. Old components are never retargeted.

### `transaction_management_audit`

- operation ID and type
- logical transaction ID
- prior and resulting version IDs
- actor email
- committed UTC timestamp
- reason code and optional explanation
- commit request ID and semantic payload hash
- preview/base and committed revisions
- write token
- summarized impact suitable for audit display

## 9. Explicit interpretation decisions

These decisions remove implementation ambiguity:

- Current salary-cycle period is `[current_cycle_start, next_salary_date)`. The next salary date is excluded.
- Custom history endpoints are inclusive Bangkok dates.
- Previous salary cycle uses adjacent factual reporting boundaries; if unavailable, the option is unavailable with an explanation.
- Amount filters use the positive absolute logical transaction total.
- The terminal pointer stored on the logical transaction is authoritative and updated in the same atomic batch as a new version.
- Management operations have a committed UTC timestamp. The resulting transaction version carries the effective Bangkok business date.
- Actor identity is mandatory for new management operations. Do not store `unknown`; historical missing actor displays as “Not recorded.”
- Audit-visible deleted, superseded, reversal, and management rows never affect financial totals.
- Undo dependency checks are defined per transaction family, not through a generic dependency graph.
- Balance observations are anchors, not transaction components. Transaction effects already reflected in an observation are not applied a second time.
- Goal target, rank, target date, status, and cycle-commitment configuration are not transaction-management fields.

## 10. Definition of a stage verdict

- **Implemented candidate:** code and applicable checks pass at an exact candidate SHA, but owner acceptance or deployment may remain outstanding.
- **Accepted:** the owner explicitly accepts the candidate in the current conversation.
- **Deployed:** a separately authorized deployment has completed and its production verification is recorded.
- **Blocked:** a concrete unresolved rule, access problem, or authorization gate prevents further safe progress.

Never collapse these verdicts into one optimistic “done.”

