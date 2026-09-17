# Stage 3 Execution Ledger

## Intake and exact-baseline inspection

repository discovery and intake — `57752793e8bca797e22a3bf5ab1295888e576b9a` — `find . -name .git -type d -prune -print`; `git rev-parse HEAD`; `git status --short --branch` — checkout located under `family-balance-goal-withdrawal`; expected starting SHA matched exactly; pre-existing modified Stage 1/2 ledgers and untracked specification/result/package artifacts identified and preserved

package inventory and integrity — `57752793e8bca797e22a3bf5ab1295888e576b9a` — isolated `unzip -l`, extraction, `shasum -a 256`, and comparison with `STAGE_3_PACKAGE_MANIFEST.txt` — seven manifested documents matched their SHA-256 values; all seven documents plus manifest were present

requirements review — `57752793e8bca797e22a3bf5ab1295888e576b9a` — read repository `AGENTS.md` and every package document from isolated extraction — Step 2 schema/decision accepted as local authority; read-only local classifier/tests/docs/candidate authorized; representative/production access, writes, migrations, backfill, repair, UI/API, mutation, dependency, deployment, merge, and Step 4 implementation forbidden

exact-baseline repository inspection — `57752793e8bca797e22a3bf5ab1295888e576b9a` — `git show 57752793e8bca797e22a3bf5ab1295888e576b9a:<path>` and exact-checkout review across migrations `0001`–`0013`, all typed factual tables, write protocol, request receipts, typed payments, other income, correction safety, portable backup/restore, SQLite adapter, and relevant tests — durable typed one-off parent/allocation and typed balance-effect links exist; income receipt IDs and balance foreign keys exist; obligation and Ledger cash counterpart links do not; Step 2 identity tables are empty after upgrade; backup inventory is complete and dependency ordered; current writes use revision claims and atomic batches

## Implementation and pre-candidate verification

decision and classifier implementation — `57752793e8bca797e22a3bf5ab1295888e576b9a` plus scoped worktree changes — added `STAGE_3_PREFLIGHT_DECISION_RECORD.md` and `historical-preflight.mjs` — complete portable inventory, durable IDs/evidence, stable reasons/order, exact coverage, explicit ambiguity, observation separation, canonical newline-terminated JSON, and SELECT-only execution implemented without migration/API/UI/write-path changes

focused acceptance implementation — `57752793e8bca797e22a3bf5ab1295888e576b9a` plus scoped worktree changes — added `historical-preflight.test.mjs`; bundled Node `v24.19.0`; `node --test cloudflare/slice-d/test/historical-preflight.test.mjs` — 6 tests passed, 0 failed; repeated/reversed input determinism, exact coverage, typed grouping, observation separation, similarity ambiguity, zero writes on success/failure, and malformed inventory failure passed

synthetic fixture report — `57752793e8bca797e22a3bf5ab1295888e576b9a` plus scoped worktree changes — ran preflight against the fully migrated repository fixture and inspected counts/serialization — 148 source rows classified as 5 unambiguous logical transactions with 11 proposed components, 69 balance observations, 55 non-transaction items, and 13 ambiguous legacy items; serialized size 23,876 bytes; production inference not made

focused Step 1/2/preflight gate — `57752793e8bca797e22a3bf5ab1295888e576b9a` plus scoped worktree changes — bundled Node `v24.19.0`; `node --test cloudflare/slice-d/test/historical-preflight.test.mjs cloudflare/slice-d/test/transaction-identity.test.mjs cloudflare/slice-d/test/backup.test.mjs cloudflare/slice-c/test/correction.test.mjs cloudflare/slice-c/test/correction-edge.test.mjs` — 19 tests passed, 0 failed; preflight, schema/restore, and Step 1 correction refusal/zero-write cases passed

complete Slice B/C/D pre-candidate regression — `57752793e8bca797e22a3bf5ab1295888e576b9a` plus scoped worktree changes — bundled Node `v24.19.0`; `node --test cloudflare/slice-b/test/*.test.mjs cloudflare/slice-c/test/*.test.mjs cloudflare/slice-d/test/*.test.mjs` — 265 tests passed, 0 failed

edge-case coverage tightening — `57752793e8bca797e22a3bf5ab1295888e576b9a` plus scoped worktree changes — reviewed invalid typed-group accounting and added one-source-row-per-ambiguity behavior/test — malformed typed parent plus allocation remains two separately inventoried ambiguous items; no source-row count can be hidden inside one ambiguity entry

## Candidate verification and handoff

candidate creation — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — staged exactly `STAGE_3_PREFLIGHT_DECISION_RECORD.md`, this ledger through pre-candidate verification, classifier, and focused tests; `git diff --cached --check`; `git commit -m "Add deterministic historical preflight candidate"`; `git rev-parse HEAD`; `git status --short` — local candidate commit created with four files; pre-existing modified/untracked owner artifacts remained excluded; no merge or deployment performed

focused candidate acceptance — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — `test "$(git rev-parse HEAD)" = bd369e00b16116c4be2ea70ea325efe6ac96747a && /Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test cloudflare/slice-d/test/historical-preflight.test.mjs cloudflare/slice-d/test/transaction-identity.test.mjs cloudflare/slice-d/test/backup.test.mjs cloudflare/slice-c/test/correction.test.mjs cloudflare/slice-c/test/correction-edge.test.mjs` — 19 tests passed, 0 failed under Node `v24.19.0`

complete candidate regression — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — `test "$(git rev-parse HEAD)" = bd369e00b16116c4be2ea70ea325efe6ac96747a && /Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test cloudflare/slice-b/test/*.test.mjs cloudflare/slice-c/test/*.test.mjs cloudflare/slice-d/test/*.test.mjs` — 265 tests passed, 0 failed under Node `v24.19.0`

result and Step 4 handoff authoring — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — created `STAGE_3_RESULT.md`, `STAGE_4_CANONICAL_READ_MODEL_TASK_SPEC.md`, and `STAGE_4_FRESH_CHAT_PROMPT.md` — documented implemented-candidate verdict, exact fixture-only evidence, limitations, representative-backup gate, and a self-contained read-only Step 4 scope without beginning Step 4

Step 4 package assembly and verification — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — assembled master/REV1, Step 2 evidence, Step 3 decision/result/ledger, Step 4 task/prompt, and SHA-256 manifest in an isolated temporary directory; ran `shasum -a 256 -c STAGE_4_PACKAGE_MANIFEST.txt`; created and re-listed `transaction-history-step-4-package.zip` — all ten manifested documents matched and all eleven expected package files were present; ZIP is a local handoff artifact only
