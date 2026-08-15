# Slice B State — 2026-08-14

Status: **ACCEPTED / COMPLETE**

## Acceptance evidence

- Locked deterministic fixture inventory remains 5 numeric + 5 branch fixtures and passes in CI.
- Financial logic is separated into date, balance, obligation, flow, EF/Goal, planning, weekly-card and read-model modules.
- The normalized source snapshot represents all 102 source rows from `Family_CashFlow_Tool_LIVE_EXPORT_2026-08-14.xlsx` with 0 rejected rows.
- Repeatable local import into two independent empty SQLite databases produced identical reconciliation output.
- Fresh Cloudflare D1 database created in APAC:
  - name: `family-cash-flow-staging-v1`
  - database id: `bde37169-c1f5-42bd-b83d-ae7adfbbe4e2`
- Remote D1 schema/import verification passed:
  - Balance Check rows: 69
  - obligations: 8
  - obligation payments: 8
  - goals: 1
  - ledger movements: 3
  - weekly snapshots: 8
  - financial write claims: 0
  - correction audit rows: 0
  - latest balances: Alex 2,285 THB / Olga 11,455 THB as of 2026-08-12
  - EF balance: 137,231 THB
  - remaining obligations: 14 THB
- Exact 2026-08-14 read-model reconciliation passed, including:
  - Weekly Variables available: 1,587 THB
  - Active Variables plan: 28,000 THB
  - Spent this cycle: 19,008 THB
  - Remaining Variables: 8,992 THB
  - One-off safe from KTB: 1,661 THB displayed (1,661.48 calculation)
  - EF contribution capacity: 242 THB displayed (242.13 calculation)
  - Goal capacity: 0 THB
  - Combined KTB: 13,740 THB
- Staging Worker version `91c98cff-f06c-413d-b15f-273b94f7698a` has `env.DB` bound to `family-cash-flow-staging-v1`.
- Authenticated `dashboard` reads are computed from D1 after legacy Apps Script session validation. All non-dashboard actions still use Apps Script.
- Deployed transport/browser regression passed after D1 binding: health, invalid token, CORS/preflight, disallowed origin, mobile and desktop startup, and browser transport.
- Human staging refresh on `https://khunalek.github.io/family-balance-staging/` rendered the expected D1 values without divergence.

## Slice B acceptance mapping

- all deterministic fixtures pass: **PASS**
- live import reconciles named read outputs: **PASS**
- staging dashboard renders Cloudflare-computed read data: **PASS**
- unexplained read divergence: **NONE**
- Cloudflare financial writes remain disabled: **PASS**

## Production isolation

At Slice B acceptance, `staging-startup-repair-20260814` is ahead of `main` and 0 commits behind. The merge base and current `main` SHA remain `5df6a84f47e904e6909870b438313f5b10c62e22`. No Slice A/B migration commit has been applied to `main`.

## Next

Proceed to Slice C: D1 revision-claim protocol, required financial writes, race/failure tests, and auditable correction path. Production cutover remains unauthorized.
