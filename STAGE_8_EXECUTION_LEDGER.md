# Stage 8 Execution Ledger

## Intake and exact-baseline inspection

repository rules, package inventory, SHA, and dirty state — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` — read `../AGENTS.md`; isolated `unzip -l`; `shasum -a 256`; `git rev-parse HEAD`; `git status --short` — expected SHA matched; all 22 manifested documents matched; 23 archive entries were present; pre-existing modified stage ledgers and untracked owner/package artifacts identified and preserved

authority and package review — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` — read all package documents, including REV1, master specification, Steps 2–7 decisions/results/ledgers, Step 7 protocol decision, and Step 8 task — owner accepted Step 7 and authorized local Step 8; replacement, other families, production/representative access, merge, deployment, configuration, dependency changes, and Step 9 implementation remain forbidden

exact-SHA behavior inspection — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` — exact-SHA reads of typed payment/allocation/balance-effect writers and migrations, identity schema, canonical/history/Balance-history readers, Step 7 protocol and receipts, Worker auth/routes, legacy correction gates, backup/restore, SQLite D1 adapter, current consumers, and relevant tests — persisted one-off versions reconstruct from one parent, positive exact-sum allocations, and at most one typed balance effect; Step 7 provided zero-write preview, semantic replay, revision/terminal stale checks, one-claim atomic batches, rollback, and disabled public family callbacks; portable-v2 already inventories all factual, identity, audit, receipt, revision, and schema objects

## Implementation and verification

one-off family implementation — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` plus scoped worktree changes — added persisted-identity eligibility, complete-field correction validation, deletion reasons, last-active restore, 10-minute latest-operation undo, later-household-activity dependency refusal, exact per-account preview impacts, immutable typed replacements, balance effects, and canonical permitted actions; wired only one-off callbacks into authenticated Worker routes — replacement and every other family remain disabled; old components and observations remain immutable; no consumer outside transaction/Balance history was switched

required schema gate discovery — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` plus scoped worktree changes — focused one-off test — delete and restore succeeded, but undo of restore rolled back with `Lifecycle must match the terminal version operation`; existing trigger could not represent an `undone` terminal version returning to deleted lifecycle

additive migration authorization — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` plus scoped worktree changes — owner explicitly authorized the required local additive migration — authorization limited to local Step 8 migration and its recovery coverage

narrow lifecycle migration — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` plus scoped worktree changes — added `0014_one_off_management_lifecycle.sql` replacing only the lifecycle trigger — deleted lifecycle accepts `undone` only when the new operation undoes the latest restore and that restore's prior version was deleted; all other lifecycle/operation combinations retain fail-closed behavior

focused Steps 1–8 gate — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` plus scoped worktree changes — bundled Node `v24.19.0`; one-off protocol, Balance history, Transaction history, canonical model, preflight, identity, backup, and legacy correction suites — 47 passed, 0 failed

complete pre-candidate Slice B/C/D regression — `2c539dd6c1f1abe3a06654388c13ec9ae7072f13` plus scoped worktree changes — bundled Node `v24.19.0`; `node --test cloudflare/slice-b/test/*.test.mjs cloudflare/slice-c/test/*.test.mjs cloudflare/slice-d/test/*.test.mjs` — 293 passed, 0 failed

## Candidate and exact-candidate verification

candidate creation — `50bd2750dc353768c0fe8f5b2f40bd2e7f143e65` — staged exactly the Step 8 ledger, authorized migration, family implementation, shared-protocol/read-model wiring, and focused tests; `git diff --cached --check`; `git commit -m "Add one-off payment management candidate"`; `git rev-parse HEAD` — one local candidate commit created with nine files; owner/package work remained excluded; no merge, deployment, configuration, or external access occurred

focused exact-candidate gate — `50bd2750dc353768c0fe8f5b2f40bd2e7f143e65` — exact-SHA assertion plus bundled Node over Steps 1–8 focused suites — 48 passed, 0 failed

complete exact-candidate regression — `50bd2750dc353768c0fe8f5b2f40bd2e7f143e65` — exact-SHA assertion plus bundled Node over all Slice B/C/D tests — 294 passed, 0 failed
