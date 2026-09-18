# Stage 10 Task Specification — Optional Payment/Other-Income Replacement

## Objective

Starting from Step 9 candidate `557ce519f03e6225c44feffa5b15622bac68e841`, optionally enable only owner-accepted one-off payment ↔ other-income replacement pairs through the shared transaction-management protocol. The same logical transaction ID must continue across the kind change.

## Authorization prerequisites

Do not implement Step 10 unless the owner explicitly accepts the Step 9 candidate, explicitly decides which replacement directions are allowed, and authorizes local Step 10 work. Deferring Step 10 does not block later transaction families. Any additive migration, representative-copy access, production mutation, merge, or deployment requires separate authorization.

## Required intake

Read repository `AGENTS.md`, REV1, the master staged specification, Steps 2–9 decisions/results/ledgers, and this task. Verify package hashes, exact SHA, dirty state, both family writers and complete typed relationships, canonical/history readers, shared protocol, family eligibility/dependency rules, Worker gates, backup/restore, current consumers, and relevant tests at the exact SHA.

## Local scope only when granted

- Record the owner-approved replacement direction or directions before code changes.
- Preserve one logical transaction ID while appending a complete terminal version of the accepted destination kind.
- Revalidate the complete destination-kind payload, source/category eligibility, Bangkok date, allocations, balances, stale state, dependency rules, audit reason, and semantic retry contract.
- Atomically append destination facts, balance effects, version/components, audit, receipt, pointer, lifecycle, and revision without rewriting prior facts.
- Prove preview impact, both account directions, retry, race exclusion, rollback, undo, history/audit visibility, and portable restore for every accepted pair.

## Forbidden scope

No unapproved replacement pair; no salary replacement or salary management; no obligation, transfer, EF, or Goal management; no backfill, guessed classification, factual repair, observation mutation, consumer switch, dependency/configuration change, production/representative access, merge, deployment, or Step 11 implementation.

## Stop boundaries

Stop for a missing Step 9 acceptance, unresolved replacement direction or semantics, required additive migration without explicit authorization, conflicting owner work, unavailable evidence, or another authorization gate. Ask exactly one focused question.
