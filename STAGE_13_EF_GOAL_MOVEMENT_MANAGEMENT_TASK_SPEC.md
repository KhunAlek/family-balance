# Stage 13 Task Specification — EF and Goal Movement Management

## Objective

Starting from the owner-accepted Step 12 candidate, enable complete correction, deletion, last-active restoration, and ten-minute undo for EF and Goal movements only after proving a durable typed relationship reconstructs both the fund and KTB effects and preserves contribution-completion semantics.

## Authorization prerequisites

Do not implement Step 13 unless the owner explicitly accepts the Step 12 candidate and separately authorizes local Step 13 work. Any additive migration, representative-copy access, external migration, merge, or deployment requires separate explicit authorization.

## Required intake and scope

Read repository rules and the complete Step 13 handoff. Verify hashes, exact SHA, dirty state, EF/Goal creation writers, fund and KTB effects, contribution-completion consumers, Steps 7–12 protocol and family semantics, canonical/history/reconciliation, Worker gates, backup/restore, and tests. Use only durable typed evidence and do not backfill guessed relationships. Preserve one logical transaction ID and reconstruct both factual sides atomically.

Prove contribution and withdrawal creation, correction of date/amount/direction/KTB account and permitted Goal identity, deletion, restoration, undo, retry, conflict, concurrency, rollback, insufficient cash/fund balance, canonical/history/audit, reconciliation, current-cycle commitment completion, ordinary-withdrawal non-recreation, disabled salary/replacement gates, and portable restore.

## Forbidden scope

No payment/income replacement, salary management/replacement, KTB semantic changes, obligation semantic changes, observation mutation, factual repair, unapproved consumer switch, dependency/configuration change, production/representative access, external migration, merge, deployment, or Step 14 implementation.

## Required verification

Run focused Steps 1–13 and full Slice B/C/D under bundled Node, create one local candidate commit, and deliver result, execution ledger, and Step 14 handoff.
