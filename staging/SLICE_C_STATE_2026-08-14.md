# Slice C State — ACCEPTED — 2026-08-14

## Status

**Slice C is accepted.** D1 is the staging financial write authority behind the authenticated Cloudflare Worker path. Production `main` was not changed during Slice C.

## Deployed staging runtime

- Worker: `family-cash-flow-staging-bridge`
- Worker URL: `https://family-cash-flow-staging-bridge.abystrov66.workers.dev`
- Accepted Slice-C Worker version: `ec980fe7-f3a6-4850-b8a3-51670f33927a`
- D1 database: `family-cash-flow-staging-v1`
- Public staging frontend: `https://khunalek.github.io/family-balance-staging/`
- Apps Script remains only for the temporary legacy authentication/session bridge; financial dashboard reads, previews and writes are D1-backed.

## Concurrency and atomicity proof

Disposable real Cloudflare Worker + real D1 integration run `31811040069` completed successfully and deleted its disposable resources afterward.

Proved on real D1:

- two concurrent payments: exactly one commit, one stale-writer rejection
- balance update vs payment: exactly one commit, one stale-writer rejection
- EF transfer vs payment: exactly one commit, one stale-writer rejection
- forced mid-batch failure rolls back claim and all business mutations
- account overdraft rejection creates no claim
- one-off preview creates no claim or mutation
- final payment recalculates from authoritative state after intervening write
- explicit EF withdrawal persists correctly
- permitted backdated obligation payment preserves submitted date
- audited correction commits on real D1
- 31 Aug salary receipt freezes missing old-cycle weekly cards atomically and records new-cycle salary-source membership

## Authenticated staging acceptance

User performed two non-monetary acceptance actions on the real staging UI:

1. 14 Aug 2026 balance update: Alex 2,285 THB; Olga 11,455 THB.
2. Audited correction of that exact balance record with unchanged values and reason `Slice C acceptance test`.

Direct D1 verification run `31812265606` passed with:

- household revision: **2**
- financial write claims: **2**
- claimed base revisions: **0 and 1**
- correction audits: **1**
- correction actor: `abystrov66@gmail.com`
- correction reason: `Slice C acceptance test`
- original `Cloudflare` balance row preserved
- higher-precedence `Correction` replacement row added
- audit `before_json` points to the original Cloudflare row
- audit `after_json` points to the correction replacement and references the original balance row ID
- latest authoritative balance: **14 Aug 2026 — Alex 2,285 THB; Olga 11,455 THB**
- no money changed during acceptance
- balance rows: 71
- ledger rows: 3
- obligation payment rows: 8
- weekly snapshot rows: 8
- active salary-source rows: 2

## Final regression gate

All final post-acceptance runs passed on commit `9725507350482ecf8a105848019b47d27538fe52`:

- Slice C write protocol: `31812348758` — PASS
- Slice B financial regression/import reconciliation: `31812348779` — PASS
- Worker API contract: `31812348771` — PASS
- staging mobile/desktop startup: `31812348785` — PASS
- deployed Worker transport/CORS/browser proof: `31812348813` — PASS

Live public staging correction UI smoke run `31811767158` also passed.

## Locked Slice-C design

- concurrency authority: D1 revision claim, unique `(household_id, base_revision)`
- business mutations + claim + revision increment execute in one D1 `batch()` transaction
- stale writers settle without duplicate financial writes
- previews are zero-write operations
- correction path is explicit and audited; no D1-console editing is an accepted correction workflow
- balance corrections preserve the original row and add a higher-precedence replacement
- ledger corrections reverse and replace rather than silently rewriting history
- salary-cycle correction carries active salary-source membership when moving the cycle boundary
- salary receipt freezes missing closed weekly cards before advancing the cycle

## Next slice

Slice D remains outstanding:

- final same-origin Cloudflare application runtime
- Google Identity plus secure signed `HttpOnly`, `Secure`, `SameSite` application session
- remove Apps Script from final runtime after acceptance
- scheduled weekly snapshot on Cloudflare
- daily portable D1 backup to R2 and restore drill
- deployed acceptance suite
- explicit production cutover authorization only after all Slice-D gates pass

No production cutover has been authorized or performed.
