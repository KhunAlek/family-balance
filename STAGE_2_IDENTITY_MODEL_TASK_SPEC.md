# Stage 2 Task Specification — Identity Model Design and Additive Migration Candidate

## Objective

Starting from candidate `7574ce7f5e4b9e87131fe68254fdee42c6a0f0cc`, produce an explicit schema decision record and a local additive migration candidate for the smallest durable logical-transaction identity, immutable version/component relationships, lifecycle/terminal pointer, and management-audit model required by the accepted specification.

Stage 2 must preserve all existing accounting facts and behavior. It must not classify or backfill guessed historical relationships, enable transaction-management UI or mutations, run against production or representative production data, or begin deterministic historical preflight implementation.

## Authorization prerequisite

Do not implement this stage unless the owner explicitly accepts the Transaction History and Correction specification as implementation authority and authorizes Stage 2 local work in the new conversation. Step 1 candidate acceptance and deployment are separate gates.

## Expected starting state

- Repository: Family Cash Flow (`family-balance-goal-withdrawal`).
- Expected SHA: `7574ce7f5e4b9e87131fe68254fdee42c6a0f0cc`.
- Step 1 candidate has a salary-only legacy correction allowlist and zero-write rejection coverage for disabled families.
- Re-verify all statements from exact files at the starting SHA; do not rely on this summary.

## Controlling documents

Read the repository `AGENTS.md` and every file in the Step 2 ZIP. The accepted owner decision in the new chat is highest authority, followed by `AGENTS.md`, the accepted REV1 requirement, the master staged specification, this task, and existing accepted records.

## Authorized local work

- Inspect exact-SHA schema, migrations, write protocol, backup/restore, tests, and read models.
- Write the schema decision record before migration code.
- Edit local migrations, application code needed only for schema/backup compatibility, tests, and implementation documentation.
- Run local tests and isolated in-memory/fresh-schema/upgrade/backup-restore checks.
- Create a local Stage 2 candidate commit and Step 3 handoff package.

## Forbidden actions

- No merge, deployment, D1/R2 environment mutation, Cloudflare configuration change, dependency addition/upgrade, production or representative-production migration run, production repair, or historical rewrite.
- No guessed relationship backfill, historical classifier/preflight implementation, transaction-history UI, correction/delete/restore/undo behavior, or other later-stage work.
- Do not weaken Step 1 server/UI gates.

## Required decision record

Before migration code, document:

- table and column names, keys, foreign keys, and indexes;
- logical transaction lifecycle values and authoritative terminal-pointer semantics;
- immutable version numbering and component relationship rules;
- typed component kinds/identities/roles without duplicating accounting amounts;
- management operation types, actor/time/reason/request/hash/revision/write-token fields;
- creation evidence nullability for historical rows;
- trigger strategy preventing update/delete of committed identity, version, component, and audit structures;
- transaction boundaries and insertion order for future atomic writes;
- exact backup inventory and restore dependency order;
- fresh-schema and upgrade compatibility;
- how ambiguous legacy facts remain unlinked and mutation-disabled.

If the accepted requirement does not resolve a material choice, stop and ask exactly one focused owner question before migration code.

## Minimum schema semantics

Names may differ only when the decision record explains the mapping:

- `logical_transactions`: logical ID, household, lifecycle status (`active`/`deleted`), terminal version ID, nullable creation evidence.
- `logical_transaction_versions`: version ID, logical ID, positive monotonic version number, kind, effective Bangkok business date, committed revision, creation/management operation reference.
- `logical_transaction_components`: version ID, typed component kind, typed component identity, role; committed relationships are immutable and old components are never retargeted.
- `transaction_management_audit`: operation ID/type, logical ID, prior/result version IDs, mandatory actor for new operations, committed UTC timestamp, reason code/optional explanation, stable request ID, semantic payload hash, preview/base and committed revisions, write token, audit-display impact summary.

Typed factual tables remain accounting authority. The identity layer must not become a second amount/balance source.

## Acceptance cases

1. Fresh database applies all migrations and exposes the exact reviewed schema, constraints, indexes, and triggers.
2. Upgrade from the Stage 1 schema is additive: every pre-existing factual/configuration/audit row is byte-for-byte preserved and foreign-key checks pass.
3. No existing row is guessed into a logical transaction, version, component, or management audit relationship.
4. Valid synthetic identity/version/component/audit creation succeeds only in the documented order.
5. Invalid household references, duplicate version numbers, invalid lifecycle/kind/role values, terminal pointers to the wrong transaction, and incomplete mandatory new-operation identity are rejected.
6. Update/delete attempts against committed versions, component links, and management audits are rejected; tests prove no partial effects.
7. Future atomic insertion can create identity, version, components, audit, terminal pointer, receipt/claim/revision linkage in one batch without enabling any endpoint.
8. Existing dashboard, Available, commitments, reports, salary transition, frozen weeks, and all current financial writes remain unchanged.
9. Portable backup inventory includes every new table/column in dependency order; isolated restore reproduces the new schema and synthetic relationships exactly.
10. Step 1 disabled correction preview/commit/catalog/UI behavior still passes.

## Required verification

- Use the bundled Node runtime that supports `node:sqlite`; record its exact version and path.
- Run focused schema/constraint/trigger/backup/restore tests.
- Run fresh-schema and Stage 1-to-Stage 2 upgrade tests.
- Run complete Slice B/C/D suites.
- Inspect the final diff for accounting duplication, guessed backfill, mutable audit/relationship data, endpoint enablement, configuration/dependency changes, and later-stage scope creep.
- Log continuously as `action — exact SHA — exact command/check — observed result`.

## Required deliverables

- Local Stage 2 candidate commit.
- `STAGE_2_SCHEMA_DECISION_RECORD.md`.
- `STAGE_2_RESULT.md`.
- `STAGE_2_EXECUTION_LEDGER.md`.
- `STAGE_3_HISTORICAL_PREFLIGHT_TASK_SPEC.md`.
- `STAGE_3_FRESH_CHAT_PROMPT.md`.
- ZIP containing controlling documents, Stage 2 evidence/result, and the complete Step 3 packet with verified SHA-256 manifest.

## Stop boundaries

Continue through the local candidate and handoff package. Stop only for an unresolved material schema/business rule, a required owner authorization gate, conflicting owner changes that cannot be preserved, or required evidence/access that cannot be safely obtained. Ask exactly one focused question when an owner decision is necessary.
