# Stage 7 Task Specification — Shared Management Protocol

## Objective

Starting from candidate `ca37a16c7c24f090f68baa12c5ee7333e2aecba3`, implement the shared transaction-management protocol: read-only authoritative previews, stale validation, semantic request receipts, atomic immutable version/audit replacement infrastructure, replay, concurrency, and rollback. Every transaction kind must remain mutation-disabled in Step 7.

## Authorization prerequisite

Do not implement Step 7 unless the owner explicitly accepts the Step 6 candidate and authorizes local Step 7 work. Production or representative-copy access, migration execution, deployment, and enabling any transaction family require separate authorization.

## Required intake

Read repository `AGENTS.md`, REV1, the master staged specification, Steps 2–6 decisions/results/ledgers, and this task. Verify package hashes, exact starting SHA, and dirty state. Inspect exact-SHA revision claims, receipts, atomic D1 batch behavior, identity triggers, canonical/history readers, Worker auth/routing, current disabled mutation gates, backup/restore, and all relevant tests before describing behavior.

## Authorized local work

- Define stable preview and commit protocol contracts over canonical logical transaction IDs.
- Implement SELECT-only previews with correlation IDs and zero writes.
- Implement shared internal infrastructure for base-revision and terminal-version validation, semantic payload hashing, stable request IDs, immutable audit/version/component assembly, exact replay, concurrency exclusion, and atomic rollback using local synthetic fixtures.
- Keep every transaction kind commit action disabled and server-rejected; no financial component writer is enabled in this stage.
- Extend portable backup/restore only if the accepted Step 7 design requires a narrow additive request-receipt structure and the owner explicitly authorizes its local migration candidate.
- Add tests, decision/result/ledger documents, one local candidate commit, and the Step 8 handoff package.

## Forbidden actions

No production or representative-copy access, production D1/R2 mutation, backfill, guessed identity/classification persistence, factual repair, observation invalidation, enabled transaction-family mutation, balance-history mutation, current dashboard/Available/commitment/report/salary-cycle/weekly/accounting/reconciliation consumer switch, dependency or Cloudflare configuration change, merge, deployment, or Step 8 implementation.

## Acceptance cases

1. Preview reloads canonical authority and writes nothing on success or failure.
2. Commit protocol requires stable request ID, semantic payload, base revision, and terminal version.
3. Stale revision/version and expired eligibility fail before financial writes.
4. Same request ID plus same semantics returns the original response; changed semantics is rejected.
5. Two distinct writers from one revision cannot both commit.
6. Forced failure rolls back claim, version, components, audit, receipt, terminal pointer, and revision.
7. Every transaction kind remains mutation-disabled with stable refusal reasons and zero writes.
8. Refresh and portable restore reconstruct identical protocol state and eligibility.
9. Steps 1–6 and complete Slice B/C/D regressions remain passing.

## Stop boundaries

Stop only for a material unresolved protocol/schema rule, conflicting owner change, unavailable required evidence, or required authorization gate. Ask exactly one focused question when needed.
