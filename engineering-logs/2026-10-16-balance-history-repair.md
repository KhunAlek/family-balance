# Balance history display repair

Owner authorized implementation, merge and deployment on 16 October 2026 (Bangkok).

- inspect frontend/backend contract — 1e9cd258c6fb3f9ace3f8927ab84563ae9fcecaf — effect DTOs have no balances; frontend incorrectly labels them Partial accounts.
- inspect repository instructions — 1e9cd258c6fb3f9ace3f8927ab84563ae9fcecaf — no tracked AGENTS.md found.

## Scope

Add display-only transaction summaries from existing canonical links. Preserve partial observation authority, transaction ordering, pagination, reconciliation, accounting and mutation rules. No schema change. Split income effects display only their own receipt accounts. Deleted links are visibly inactive; unlinked effects never invent financial amounts. Expose existing authoritative transaction details through a View transaction button.

## Validation commands

`node --test cloudflare/slice-b/test/*.test.mjs cloudflare/slice-c/test/*.test.mjs cloudflare/slice-d/test/*.test.mjs`

`node cloudflare/slice-d/tools/release-assets.mjs verify`

Browser harness uses actual history JS/HTML/styles and synthetic data at 360, 691 and 1440 pixels. It checks partial/combined observations, signed transfers, deleted and unlinked records, no horizontal overflow and linked-transaction navigation. No production data is modified by the harness.

- regression command above — cfddf6ecf8c1c0c067dc09ab5960e615429df74f — 388 passed, 0 failed.
- add split fixture test — ceef3b040f2af7e47e4902ef05b14699d5621cc1 — 388 passed, 1 failed because fixture attempted to UPDATE an immutable recorded allocation. Rebuilt the synthetic split input in memory; existing acceptance assertions and database guards unchanged.
- `CHROMIUM_EXECUTABLE=/tmp/chrome134/chrome-headless-shell-linux64/chrome-headless-shell node cloudflare/slice-d/tools/verify-balance-history-browser.cjs` — ceef3b040f2af7e47e4902ef05b14699d5621cc1 — passed at 360, 691, 1440 pixels; 360-pixel screenshot visually inspected.
- `node cloudflare/slice-d/tools/release-assets.mjs verify` — ceef3b040f2af7e47e4902ef05b14699d5621cc1 — all 69 assets match lock.
