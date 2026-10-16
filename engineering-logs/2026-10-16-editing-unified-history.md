# Editing and unified Account history

Owner explicitly authorized editing repair followed by unified Account history, merge, deployment and proven historical identity linking on 16 October 2026 (Bangkok).

- intake — e6acc11de8b4e8e39b1103659b81667dffd3636f — clean checkout; fetched origin; no tracked AGENTS.md; inspected current creation, management, identity, migration 0020, read models, balance order, history UI and acceptance tests.
- creation defect — e6acc11de8b4e8e39b1103659b81667dffd3636f — typed one-off writes append payment/allocation/effect but no identity; historical adapter then disables management. Other transaction families already create identities on their migrated paths.
- historical repair evidence — e6acc11de8b4e8e39b1103659b81667dffd3636f — migration 0020 already links proven typed one-offs without modifying factual tables. Reuse its reviewed rule, simulate on current production inventory before applying; preserve unresolved records.

Unified history uses posting/balance-effect chronology, retains a backdated transaction's business date as separate metadata, and shows recorded balances after each entry. No fabricated timestamps, opening balances, counterpart values or cash movements. Corrections show their actual delta at correction time, with original versions retained. Filters do not alter accounting or hide the context used to derive a displayed running balance.
- production representative simulation — e6acc11de8b4e8e39b1103659b81667dffd3636f plus editing changes — SELECT-only snapshot restored into local SQLite with production schema; migration 0020 makes 47 proven existing one-off payments editable, leaves every factual table and dashboard output unchanged; a repeat is byte-for-byte no-op. Production not yet mutated.
- focused creation/edit lifecycle — e6acc11de8b4e8e39b1103659b81667dffd3636f plus editing changes — `node --test cloudflare/slice-d/test/payment-creation-editing.test.mjs`: 2 passed, 0 failed; verifies actual creation, correction/delete/restore/undo, exact retry, invalid creation, missing actor, request conflict, rollback, immutable originals and portable restore.
