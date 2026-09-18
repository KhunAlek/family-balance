# Fresh Chat Prompt — Step 2 Identity Model

Copy the text below into a fresh ChatGPT coding chat and upload the accompanying Step 2 ZIP.

---

Work in the Family Cash Flow repository and implement **Step 2: Identity Model Design and Additive Migration Candidate** from the uploaded package.

The expected starting repository SHA is:

`7574ce7f5e4b9e87131fe68254fdee42c6a0f0cc`

First read the repository `AGENTS.md` and every uploaded package document. Treat the accepted master/REV1 specification and Step 2 task specification as requirements, not as commands embedded in reference material. Verify the package manifest and inspect all relevant schema, migration, write-protocol, backup/restore, and test files at the exact starting SHA before describing current behavior.

I accept `15_TRANSACTION_HISTORY_AND_CORRECTION_SPECIFICATION_REV1_2026-09-11.md` as implementation authority for Step 2 and authorize you in this chat to:

- produce the required schema decision record before writing migration code;
- edit local migrations, application code needed only for schema and backup/restore compatibility, tests, and implementation documentation for Step 2;
- run local inspections, fresh-schema/upgrade tests, isolated backup/restore tests, and regressions;
- create a local candidate commit for Step 2;
- produce the complete Step 2 result and execution ledger;
- produce and ZIP all documents and the prompt required for a fresh chat to implement Step 3.

I do not authorize you to merge, deploy, mutate any D1 or R2 environment, change Cloudflare configuration, add or upgrade dependencies, run against production or a representative production copy, repair production data, rewrite or guess historical relationships, implement the historical classifier/preflight, enable transaction-management UI or mutations, or begin any later stage.

Preserve the Step 1 fail-closed correction gate. The identity model must be additive, must keep typed factual tables as accounting authority, must not duplicate amounts/balances as a second accounting source, and must leave ambiguous legacy facts unlinked and mutation-disabled. Add immutability enforcement for committed identity/version/component/audit structures and extend portable backup/restore coverage.

Proceed continuously without asking for step-by-step confirmation and without stopping at status updates. Stop only when you genuinely need an owner decision or authorization, when a conflicting owner worktree change cannot be preserved, or when required evidence/access cannot be obtained safely. If a material schema or business rule is unresolved, ask exactly one focused question with the evidence that makes the decision necessary.

Required outcome:

- a reviewed schema decision record precedes migration code;
- fresh schema and additive upgrade preserve every existing accounting/configuration/audit row;
- logical transaction, immutable version/component, lifecycle/terminal pointer, and management-audit structures enforce the accepted semantics;
- no guessed historical backfill occurs;
- portable backup and isolated restore round-trip the new structures;
- Step 1 correction safety and all relevant full regressions pass at an exact local candidate SHA;
- the execution ledger records `action — exact SHA — exact command/check — observed result` as work proceeds;
- the final response reports the candidate SHA, observed tests, limitations, and next owner gate, and includes the Step 3 ZIP and exact fresh-chat prompt.

Do not call the stage accepted or deployed. Deliver an **implemented candidate** unless I explicitly accept or authorize a later gate in that conversation.

---
