# Stage 6 Execution Ledger

## Intake and exact-baseline inspection

repository and worktree intake — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` — `git rev-parse HEAD`; `git status --short --untracked-files=all` — expected starting SHA matched; pre-existing modified Stage 1–5 ledgers and untracked owner/package artifacts identified and preserved; UI authorization omitted, so Step 6 is server-only

package inventory and integrity — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` — `unzip -l transaction-history-step-6-package.zip`; `shasum -a 256 transaction-history-step-6-package/*`; manifest comparison — all sixteen manifested documents matched and the manifest was present as the seventeenth entry

requirements review — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` — read repository `AGENTS.md` and every package document — Step 5 candidate/decision accepted for local Step 6 authority; local read-only server query/tests/docs/candidate/Step 7 packet authorized; production/representative access, writes, migrations, repair, mutation, UI, consumer/config/dependency change, merge, deployment, and Step 7 implementation forbidden

exact-baseline inspection — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` — `git show 7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8:<path>` across balance schema/order/readers, typed payment and receipt links, reconciliation/current-position consumers, Worker auth/router, canonical/history modules, backup/restore, migrations, and tests — balance rows mix observations and post-transaction positions; one-off IDs and receipt source-row foreign keys are the only durable balance-effect evidence; current consumers require paired observations and remain independent; canonical/history reads are complete-inventory SELECT-only

## Implementation and pre-candidate verification

Balance history implementation — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` plus scoped worktree changes — added `balance-history.mjs` and authenticated same-origin `balanceHistory` dispatch — separate observation/effect entries, exact partial authority, canonical typed linkage, fail-closed unlinked effects, no-double-apply per-account reconciliation, stable ordering/revision-bound pagination, deterministic serialization, and no mutation controls implemented without changing existing financial consumers

initial focused run — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` plus scoped worktree changes — bundled Node `v24.19.0`; `node --test cloudflare/slice-d/test/balance-history.test.mjs` — 4 passed, 1 failed because the route fixture used an unauthorized test identity; implementation paths passed

route fixture correction — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` plus scoped worktree changes — aligned test identity/signing configuration with the established Worker auth contract — authenticated, unauthenticated, and cross-origin route cases execute against the real signed-session boundary

income-effect boundary review — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` plus scoped worktree changes — inspected receipt reconstruction and added `source_balance_row_id` effect classification — receipt-linked rows remain effects rather than observations; only receipts belonging to a canonical transaction provide a transaction link or reconciliation effect; legacy incomplete evidence stays explicitly unlinked

focused Step 1–6 gate — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` plus scoped worktree changes — bundled Node `v24.19.0`; `node --test` over balance history, transaction history, terminal model, historical preflight, transaction identity, backup, and correction suites — 34 passed, 0 failed before income-link coverage; final focused rerun pending candidate

complete Slice B/C/D pre-candidate regression — `7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8` plus scoped worktree changes — `/Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test cloudflare/slice-b/test/*.test.mjs cloudflare/slice-c/test/*.test.mjs cloudflare/slice-d/test/*.test.mjs` — 281 passed, 0 failed under Node `v24.19.0`
