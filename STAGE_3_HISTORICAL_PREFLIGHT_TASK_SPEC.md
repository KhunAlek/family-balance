# Stage 3 Task Specification — Deterministic Historical Preflight

## Objective

Starting from candidate `57752793e8bca797e22a3bf5ab1295888e576b9a`, implement a deterministic, read-only preflight that classifies existing material without writing any database row or changing accounting behavior.

## Authorization prerequisite

Do not implement Step 3 unless the owner explicitly accepts the Step 2 schema candidate and authorizes local Step 3 work. Do not run against production or an isolated representative production backup without a separate explicit authorization in that conversation.

## Required inputs

Read repository `AGENTS.md`, the accepted REV1 specification, master staged specification, `STAGE_2_SCHEMA_DECISION_RECORD.md`, `STAGE_2_RESULT.md`, `STAGE_2_EXECUTION_LEDGER.md`, and this task specification. Verify every package hash and inspect relevant files at the exact starting SHA before describing current behavior.

## Authorized local work

- Add a read-only classifier/preflight module, local fixtures, tests, and implementation documentation.
- Classify only from durable request IDs, write tokens, committed revisions, typed parent IDs, foreign keys, or an explicitly reviewed mapping already present in authoritative material.
- Produce stable proposed logical IDs, classification counts, reason codes, evidence fields, and proposed component mappings for unambiguous material.
- Run only local synthetic/fixture-based checks unless the owner separately authorizes representative-backup access.
- Create a local Step 3 candidate commit and complete Step 4 handoff package.

## Forbidden actions

- No database writes, migration, backfill, relationship insertion, accounting/configuration mutation, production or representative-production access, merge, deployment, D1/R2 mutation, Cloudflare configuration change, dependency change, UI/history/read-model implementation, or management mutation.
- Never group by date, amount, description, account, source name, or adjacent row order alone.
- Never turn ambiguity into a guessed relationship.

## Classification contract

Every inspected item must land in exactly one class:

1. unambiguously grouped logical transaction and typed components;
2. immutable balance observation;
3. non-transaction factual, planning, configuration, audit, claim, or receipt material;
4. ambiguous legacy item.

Output must be canonical and deterministic: stable ordering, stable IDs, stable reason codes, explicit durable evidence, and no timestamps or runtime-dependent values. Ambiguous items include the missing durable relationship and remain mutation-disabled. The primary explanation must not expose raw table names; technical evidence may.

## Acceptance cases

1. Repeated runs over identical input are byte-for-byte identical.
2. Input table/row iteration order does not affect output.
3. Every relevant source row is accounted for exactly once without duplicate component ownership.
4. Durable typed parents and explicit foreign keys group complete unambiguous actions.
5. Date/amount/description/account/source-name/adjacency similarity without durable linkage remains ambiguous.
6. Balance observations are classified separately and never proposed as logical components.
7. Planning, configuration, revision claims, request receipts, and management/correction audit are non-transactions.
8. Existing empty Step 2 identity tables do not cause writes or inferred linkage.
9. Preflight performs zero writes: all table rows, schema, total changes, and household revision remain identical before/after success and failure.
10. Step 1 correction safety, Step 2 schema/backup/restore, and complete Slice B/C/D regressions still pass at the exact candidate SHA.

## Required deliverables

- Local Step 3 candidate commit.
- `STAGE_3_PREFLIGHT_DECISION_RECORD.md` defining inventory, evidence hierarchy, stable IDs, classification/reason schema, ordering, and zero-write proof.
- `STAGE_3_RESULT.md` and contemporaneous `STAGE_3_EXECUTION_LEDGER.md`.
- Step 4 task specification, exact fresh-chat prompt, manifest, and ZIP with all controlling/evidence documents.

## Stop boundaries

Stop only for an unresolved material classification rule, conflicting owner worktree change, unavailable required evidence, or a required authorization gate. Ask exactly one focused owner question when a material decision is necessary. A status update is not a stopping boundary.

