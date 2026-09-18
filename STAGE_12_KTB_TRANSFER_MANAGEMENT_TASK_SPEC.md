# Stage 12 Task Specification — KTB Transfer Management

## Objective

Starting from Step 11 candidate `9ac1b819b80b8297ddb284a5f778a6a42509aef6`, enable correction, deletion, last-active restoration, and ten-minute undo for KTB-to-KTB transfers only after proving one durable typed parent links both account effects and every operation preserves combined KTB neutrality.

## Authorization prerequisites

Do not implement Step 12 unless the owner explicitly accepts the Step 11 candidate and separately authorizes local Step 12 work. Any additive migration, representative-copy access, external migration, merge, or deployment requires separate explicit authorization.

## Required intake and scope

Read repository rules and the full Step 12 package. Verify hashes, exact SHA, dirty state, transfer creation writers, both cash effects, terminal/current consumers, Steps 7–11 semantics, canonical/history/reconciliation, Worker gates, backup/restore, and tests. Use only durable typed evidence; do not backfill guessed relationships. Preserve one logical transaction ID. Implement correction/delete/restore/undo with exact source/destination/amount/date validation, source and destination inequality, account sufficiency, combined-KTB neutrality, stale/replay/race/rollback/audit invariants, and portable restore agreement.

## Forbidden scope

No payment/income replacement, salary management/replacement, obligation changes, EF/Goal management, observation mutation, factual repair, unapproved consumer switch, dependency/configuration change, production/representative access, external migration, merge, deployment, or Step 13 implementation.

## Required evidence

Prove valid and invalid creation, both transfer directions, correction of date/amount/direction, delete/restore/undo, exact retry, request conflict, concurrency, rollback, insufficient cash, combined neutrality, canonical/history/audit, reconciliation/current consumers, disabled-family gates, and portable restore. Run focused Steps 1–12 and full Slice B/C/D under bundled Node, create one local candidate commit, and deliver result, execution ledger, and Step 13 handoff.
