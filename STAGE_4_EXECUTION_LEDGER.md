# Stage 4 Execution Ledger

## Intake and exact-baseline inspection

repository and worktree intake — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — `git rev-parse HEAD`; `git status --short`; `unzip -l transaction-history-step-4-package.zip` — expected starting SHA matched; pre-existing modified Stage 1/2/3 ledgers and untracked owner/package artifacts identified and preserved

package inventory and integrity — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — isolated extraction and `sha256sum -c STAGE_4_PACKAGE_MANIFEST.txt` — all ten manifested documents matched exactly; manifest present as the eleventh ZIP entry

requirements review — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — read repository `AGENTS.md` and every package document from isolated extraction — Step 3 candidate/decision accepted as local authority; internal read-only model, fixtures, tests, documents, candidate commit, and Step 5 packet authorized; all production/representative-copy access, writes, migrations, backfill, repair, UI/API, mutation, consumer switching, dependency/configuration change, merge, deployment, and Step 5 implementation forbidden

exact-baseline repository inspection — `bd369e00b16116c4be2ea70ea325efe6ac96747a` — `git show bd369e00b16116c4be2ea70ea325efe6ac96747a:<path>` across migrations `0001`, `0006`–`0013`, typed factual writers/readers, accounting/read/reporting consumers, correction gate/catalog, portable backup/restore, Step 2/3 modules, and relevant tests — terminal identity pointer and immutable relationship metadata contain no accounting amounts; one-off and receipt facts have reconstructable typed relationships; obligation and Ledger cash counterparts remain unresolved; Step 1 correction is salary-cycle-only; current financial consumers do not use the Step 2/3 identity layer; portable inventory covers all identity/audit rows

## Implementation and pre-candidate verification

canonical decision and implementation — `bd369e00b16116c4be2ea70ea325efe6ac96747a` plus scoped worktree changes — added `STAGE_4_READ_MODEL_DECISION_RECORD.md` and `cloudflare/slice-d/src/terminal-transaction-read-model.mjs` — internal SELECT-only canonical DTO, terminal-pointer resolution, complete version/component/audit validation, historical adaptation, ambiguity/observation separation, stable refusals, deterministic serialization, and no current-consumer switch implemented

focused acceptance implementation — `bd369e00b16116c4be2ea70ea325efe6ac96747a` plus scoped worktree changes — bundled Node `v24.19.0`; `node --test cloudflare/slice-d/test/terminal-transaction-read-model.test.mjs` — initial run passed 4/5; the crossed-pointer fixture changed the only version's owner and therefore correctly reached `INCOMPLETE_VERSION_CHAIN` before crossed-pointer validation

focused fixture correction and invariant tightening — `bd369e00b16116c4be2ea70ea325efe6ac96747a` plus scoped worktree changes — corrected the synthetic crossed-pointer fixture to retain both complete chains; added full-version reconstruction plus orphan version/component/audit rejection and recursive canonical key ordering — focused read-model suite passed 5/5

combined Step 1–4 gate — `bd369e00b16116c4be2ea70ea325efe6ac96747a` plus scoped worktree changes — `/Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test cloudflare/slice-d/test/terminal-transaction-read-model.test.mjs cloudflare/slice-d/test/historical-preflight.test.mjs cloudflare/slice-d/test/transaction-identity.test.mjs cloudflare/slice-d/test/backup.test.mjs cloudflare/slice-c/test/correction.test.mjs cloudflare/slice-c/test/correction-edge.test.mjs` — 24 passed, 0 failed; canonical resolution/determinism/zero-write/fail-closed behavior, Step 3 coverage, Step 2 schema/restore, and Step 1 correction safety passed

complete Slice B/C/D pre-candidate regression — `bd369e00b16116c4be2ea70ea325efe6ac96747a` plus scoped worktree changes — `/Users/alexanderbystrov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test cloudflare/slice-b/test/*.test.mjs cloudflare/slice-c/test/*.test.mjs cloudflare/slice-d/test/*.test.mjs` — 270 passed, 0 failed under Node `v24.19.0`
