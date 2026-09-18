# Fresh Chat Prompt — Step 5 Read-Only Transaction History

Copy the text below into a fresh ChatGPT coding chat and upload the accompanying Step 5 ZIP.

---

Work in the Family Cash Flow repository and implement **Step 5: Read-Only Transaction History** from the uploaded package.

The expected starting repository SHA is:

`9871da3f65240cc565d609cbf4b66162890c5479`

First read repository `AGENTS.md` and every uploaded package document. Verify the package manifest, exact starting SHA, and dirty-worktree state. Inspect all relevant committed Worker routing/auth, recorded salary/reporting boundaries, household revisions, canonical terminal read model, frontend/i18n architecture if UI is authorized, current accounting/reporting consumers, portable backup/restore, and tests at that exact SHA before describing current behavior.

I accept the Step 4 candidate and `STAGE_4_READ_MODEL_DECISION_RECORD.md` as implementation authority for local Step 5 work. I authorize you to implement and test a read-only Transaction history server query using local synthetic/repository fixtures, create a local candidate commit, produce the complete Step 5 result and execution ledger, and package all documents and the prompt required for a fresh chat to implement Step 6. [Owner: explicitly state here whether read-only phone/desktop English/Russian UI is also authorized; if omitted, keep Step 5 server-only.]

I do not authorize production or representative-copy access; database writes; migrations; backfill; identity/classification persistence; factual repair or reinterpretation; transaction-management mutation; balance-history mutation; changing current dashboard, Available, commitments, reports, salary-cycle, weekly, or accounting consumers; dependency or Cloudflare configuration changes; D1/R2 mutation; merge; deployment; or Step 6/later work.

Use the canonical Step 4 DTO as the sole transaction semantics source. Implement recorded current/previous salary-cycle periods, inclusive Bangkok custom dates, All history, the accepted filters, complete-set counts and money-in/money-out totals, stable ordering, audit visibility, and opaque query-bound pagination. The cursor must contain the household revision and canonical query hash; a query or revision mismatch must return a stable stale/invalid response requiring restart, not a cross-request snapshot. Deleted, superseded, reversal, management, ambiguous, balance-observation, and internal-movement rows must never contaminate financial totals. Keep ambiguity visible only in audit mode and mutation-disabled. Every success/failure path must make zero writes and output deterministically.

Proceed continuously through implementation, verification, candidate commit, result, ledger, and Step 6 ZIP. Stop only for a genuine unresolved material rule, conflicting owner change that cannot be preserved, unavailable required evidence, or a required authorization gate. Ask exactly one focused question if a material rule is unresolved.

At the exact candidate SHA, run focused Step 5 history/cursor/filter/total/zero-write tests, Step 4 canonical read-model tests, Step 3 preflight determinism/coverage/zero-write tests, Step 2 schema and portable backup/restore tests, Step 1 correction safety, and the complete Slice B/C/D regressions under the bundled Node runtime. Log as work proceeds using `action — exact SHA — exact command/check — observed result`.

Deliver an **implemented candidate**, not an accepted or deployed stage. Report the candidate SHA, exact checks, limitations, and next owner gate. Running any preflight/read model/history query against an isolated representative production backup remains separately gated.

---
