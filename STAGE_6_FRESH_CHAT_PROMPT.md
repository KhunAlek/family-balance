# Fresh Chat Prompt — Step 6 Immutable Balance History

Copy the text below into a fresh ChatGPT coding chat and upload the accompanying Step 6 ZIP.

---

Work in the Family Cash Flow repository and implement **Step 6: Immutable Balance History** from the uploaded package.

The expected starting repository SHA is:

`7d8d1b897cc3d8ac64bd78660e8b4243d0f2edc8`

First read repository `AGENTS.md` and every uploaded package document. Verify the package manifest, exact starting SHA, and dirty-worktree state. Inspect all relevant committed balance storage/read ordering, typed transaction-effect links, partial-observation authority, reconciliation/current-position consumers, Worker routing/auth, canonical transaction and history modules, portable backup/restore, and tests at that exact SHA before describing current behavior.

I accept the Step 5 candidate and `STAGE_5_HISTORY_DECISION_RECORD.md` as implementation authority for local Step 6 work. I authorize you to implement and test a read-only immutable Balance history server query using local synthetic/repository fixtures, create a local candidate commit, produce the complete Step 6 result and execution ledger, and package all documents and the prompt required for a fresh chat to implement Step 7. [Owner: explicitly state here whether read-only phone/desktop English/Russian UI is also authorized; if omitted, keep Step 6 server-only.]

I do not authorize production or representative-copy access; database writes; migrations; backfill; identity/classification persistence; factual repair or observation invalidation; transaction-management mutation; balance-history mutation; changing current dashboard, Available, commitments, reports, salary-cycle, weekly, accounting, or reconciliation consumers; dependency or Cloudflare configuration changes; D1/R2 mutation; merge; deployment; or Step 7/later work.

Keep immutable balance observations separate from transaction-created balance effects. Preserve Alex-only, Olga-only, and combined authority exactly; never invent an unrecorded counterpart or combined value. Link reconciliation effects to canonical logical transactions only through durable typed evidence, and never double-apply effects already incorporated in an observation. Keep all mutation controls absent. Make ordering/pagination deterministic and every success/failure path zero-write.

Proceed continuously through implementation, verification, candidate commit, result, ledger, and Step 7 ZIP. Stop only for a genuine unresolved material rule, conflicting owner change that cannot be preserved, unavailable required evidence, or a required authorization gate. Ask exactly one focused question if a material rule is unresolved.

At the exact candidate SHA, run focused Step 6 balance-history/partial-authority/linkage/reconciliation/order/zero-write tests, Step 5 history tests, Step 4 canonical read-model tests, Step 3 preflight tests, Step 2 schema and portable backup/restore tests, Step 1 correction safety, and the complete Slice B/C/D regressions under the bundled Node runtime. Log as work proceeds using `action — exact SHA — exact command/check — observed result`.

Deliver an **implemented candidate**, not an accepted or deployed stage. Report the candidate SHA, exact checks, limitations, and next owner gate. Running any preflight/read model/history query against an isolated representative production backup remains separately gated.

---

