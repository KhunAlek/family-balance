# Stage 4 Task Specification — Canonical Terminal Transaction Read Model

## Objective

Starting from candidate `bd369e00b16116c4be2ea70ea325efe6ac96747a`, implement one authoritative, read-only server representation of terminal logical transactions and explicit legacy classifications. It must be the internal source for later history and management stages without changing current dashboard, reports, Available, commitments, weekly results, or accounting facts.

## Authorization prerequisite

Do not implement Step 4 unless the owner explicitly accepts the Step 3 candidate and authorizes local Step 4 work. Running the preflight against production or a representative production copy remains a separate gate. Do not infer authorization for it from Step 4 authorization.

## Required inputs

Read repository `AGENTS.md`, the accepted REV1 specification, master staged specification, Step 2 schema decision/result/ledger, Step 3 preflight decision/result/ledger, and this task specification. Verify every package hash, exact starting SHA, and dirty-worktree state. Inspect relevant committed schema, typed factual readers, accounting/reporting consumers, correction safety, backup/restore, and tests at that exact SHA before describing current behavior.

## Authorized local work

- Define a canonical internal transaction DTO and explicit validation/refusal contract.
- Resolve existing Step 2 logical identities through their authoritative terminal pointer and immutable component relationships.
- Adapt Step 3 unambiguous and ambiguous classifications into the canonical read representation without persisting them.
- Keep balance observations separate and preserve non-transaction exclusions.
- Add local repository/synthetic fixtures, focused tests, decision/result/ledger documents, one local candidate commit, and the Step 5 handoff package.

## Forbidden actions

- No production or representative-copy access, database writes, migrations, backfill, identity insertion, factual repair/reinterpretation, merge, deployment, D1/R2 mutation, Cloudflare configuration change, dependency change, transaction-history UI or public read API, transaction-management preview/commit, correction/delete/restore/replace/undo enablement, or Step 5 implementation.
- Do not make an ambiguous item mutable or silently omit it.
- Do not use audit-visible superseded/deleted/management rows in financial totals.
- Do not create a second accounting source or recompute current household behavior through the new DTO in this stage.

## Canonical DTO contract

For each unambiguous item, define stable fields for logical ID, kind, lifecycle, terminal business date, terminal version and committed revision, description/source/payee, category where applicable, positive total satang, direction, account allocations, typed component identities/roles, creation evidence or explicit unavailability, audit summary, reconciliation state, and permitted-action/refusal information.

The terminal pointer on `logical_transactions` is authoritative. Every referenced version and component must belong to the same household and logical chain. Existing identity chains must fail closed on missing terminal pointers, cross-transaction references, invalid lifecycle/operation agreement, duplicate component ownership, unsupported kinds/roles, or incomplete typed facts.

Legacy unambiguous groups use the Step 3 proposed read-only identity. Ambiguous items remain separate read-only DTOs with stable reason codes, technical evidence, and all mutations refused. Balance observations never become transaction DTOs.

All new and legacy transaction DTOs must have deterministic ordering and serialization. No current financial consumer is switched to this model during Step 4.

## Acceptance cases

1. Valid single-version and multi-version identity chains resolve exactly one authoritative terminal DTO.
2. Deleted lifecycle resolves for audit visibility but is excluded from default active results and financial totals.
3. Superseded versions and management audit rows remain visible only in the ordered audit chain and never double-count.
4. Typed components reconstruct complete one-off allocations without duplication.
5. Step 3 unambiguous legacy groups map deterministically; ambiguous legacy items remain separate and mutation-disabled.
6. Missing/crossed terminal pointers, invalid chains, missing typed components, duplicate ownership, or unsupported relationships fail closed with stable refusal codes.
7. Balance observations and non-transactions are excluded from transaction DTOs.
8. Repeated and shuffled-input reads serialize byte-for-byte identically.
9. Read-model construction performs zero writes on success and every failure.
10. Existing dashboard, Available, commitments, reports, salary-cycle, weekly-freeze, accounting, Step 1 correction safety, Step 2 schema/portable backup/restore, Step 3 preflight, and complete Slice B/C/D regressions remain unchanged.

## Required deliverables

- Local Step 4 candidate commit.
- `STAGE_4_READ_MODEL_DECISION_RECORD.md`.
- `STAGE_4_RESULT.md` and contemporaneous `STAGE_4_EXECUTION_LEDGER.md`.
- Step 5 task specification, exact fresh-chat prompt, manifest, and ZIP with all controlling/evidence documents.

## Stop boundaries

Stop only for an unresolved material read-model rule, conflicting owner worktree change, unavailable required evidence, or required authorization gate. Ask exactly one focused owner question when a material decision is necessary.
