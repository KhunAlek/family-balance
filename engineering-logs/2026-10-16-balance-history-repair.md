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

## Final verification and production integration

- full regression command above — 880bc46240bfff215bd5bbc6aae1e2c9de2f28bb — 389 passed, 0 failed, 0 skipped.
- `node /tmp/fcf-real-data.mjs` — 880bc46240bfff215bd5bbc6aae1e2c9de2f28bb — SELECT-only production inventory: 254 entries, 161 observations, 93 effects; latest page contained 70 effects, 69 canonical linked summaries, all with safe-integer account changes. Every D1 result reported changed_db=false.
- fast-forward integrate main with expected-head lease — 880bc46240bfff215bd5bbc6aae1e2c9de2f28bb — GitHub main advanced from 1e9cd258c6fb3f9ace3f8927ab84563ae9fcecaf.
- upload through Cloudflare REST API — runtime sources identical at ceef3b040f2af7e47e4902ef05b14699d5621cc1 and 880bc46240bfff215bd5bbc6aae1e2c9de2f28bb — candidate cd7dc23b-5425-48ab-ae9f-6e2eb79d6c45 uploaded as 102 native ES modules with existing locked dependency modules and 69 locked static assets. No Wrangler operation, new dependency, schema migration or D1/R2 write.
- candidate preview URL — 880bc46240bfff215bd5bbc6aae1e2c9de2f28bb — HTTP 403; no preview-access setting changed. Local browser validation and production-source read validation were available.
- activate owner-authorized candidate through REST deployments endpoint — 880bc46240bfff215bd5bbc6aae1e2c9de2f28bb — cd7dc23b-5425-48ab-ae9f-6e2eb79d6c45 receives 100% production traffic; prior version 67f0ea42-0289-4639-87b3-713532e55685 retained.
- `node /tmp/fcf-verify.mjs` — 880bc46240bfff215bd5bbc6aae1e2c9de2f28bb — all 69 production assets exactly match SHA-256 lock and valid MIME types; /health HTTP 200 with expected slice-d response; unauthenticated /api/auth/session HTTP 401; financial revision unchanged at 219, verification SELECT changed_db=false.

Production verification uses exact byte hashes. JavaScript MIME permits application/javascript and text/javascript, consistent with the existing release verifier. The first custom MIME check rejected the standard text/javascript variant; its exact-hash checks had succeeded. The corrected custom checker follows the existing MIME acceptance rule.

Browser verification uses synthetic data, not an authenticated production session. The production data check executes the exact repaired read model over SELECT-only production data. One unlinked record on the latest page remains explicitly unavailable; no relationship or amount was fabricated.
