# Fresh Chat Prompt — Step 3 Deterministic Historical Preflight

Copy the text below into a fresh ChatGPT coding chat and upload the accompanying Step 3 ZIP.

---

Work in the Family Cash Flow repository and implement **Step 3: Deterministic Historical Preflight** from the uploaded package.

The expected starting repository SHA is:

`57752793e8bca797e22a3bf5ab1295888e576b9a`

First read repository `AGENTS.md` and every uploaded package document. Verify the package manifest, the exact starting SHA, and dirty-worktree state. Inspect all relevant schema, typed factual tables, durable identity evidence, backup/restore, write-protocol, and tests at that exact SHA before describing current behavior.

I accept the Step 2 schema candidate and `STAGE_2_SCHEMA_DECISION_RECORD.md` as implementation authority for local Step 3 work. I authorize you to implement and test a deterministic read-only historical preflight using local synthetic/repository fixtures, create a local candidate commit, produce the complete Step 3 result and execution ledger, and package all documents and the prompt required for a fresh chat to implement Step 4.

I do not authorize you to run against production or a representative production copy, write any classification or relationship to a database, apply or change migrations, backfill identity rows, repair or reinterpret historical data, merge, deploy, mutate D1/R2, change Cloudflare configuration, add or upgrade dependencies, enable transaction history UI/read APIs, enable any transaction-management mutation, or begin Step 4 or later work.

Use only durable evidence: request IDs, write tokens, committed revisions, typed parent IDs, foreign keys, or an explicitly reviewed authoritative mapping. Never group from matching date, amount, description, account, source name, or adjacent row order alone. Classify every relevant item exactly once as an unambiguous logical transaction/component group, immutable balance observation, non-transaction material, or ambiguous legacy item. Ambiguity must remain explicit and mutation-disabled.

The output must have stable IDs, stable reason codes, stable ordering, explicit durable evidence, proposed component mappings only for unambiguous material, and byte-for-byte deterministic serialization. Prove repeated and shuffled-input determinism, complete inventory without duplicate component ownership, zero writes on success and failure, separate balance-observation treatment, and ambiguity for similarity-only evidence.

Proceed continuously through implementation, verification, candidate commit, result, ledger, and Step 4 ZIP. Stop only for a genuine unresolved material rule, conflicting owner change that cannot be preserved, unavailable required evidence, or a required authorization gate. If a material rule is unresolved, ask exactly one focused question with the evidence requiring the decision.

At the exact candidate SHA, run focused preflight determinism/coverage/zero-write tests, Step 2 schema and portable backup/restore tests, Step 1 correction safety, and the complete Slice B/C/D regressions under the bundled Node runtime. Log as work proceeds using `action — exact SHA — exact command/check — observed result`.

Deliver an **implemented candidate**, not an accepted or deployed stage. Report the candidate SHA, exact observed checks, limitations, and the next owner gate. Running the preflight against an isolated representative production backup remains a separate authorization gate.

---
