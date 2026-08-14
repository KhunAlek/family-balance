# Slice D State — AUTOMATED STAGING GATES PASSED; USER ACCEPTANCE PENDING — 2026-08-14

## Protected production boundary

Production `main` remains at `5df6a84f47e904e6909870b438313f5b10c62e22`. No production cutover has been authorized or performed.

## Implemented on the migration branch

- same-origin Worker static-assets runtime;
- same-origin `/api/*` with no CORS bridge or Apps Script runtime call;
- Google Identity Services ID-token sign-in;
- server-side RS256 signature, issuer, audience, authorized-party, expiry, issue-time, subject, verified-email and allowlist validation;
- signed `HttpOnly`, `Secure`, `SameSite=Strict` application session cookie;
- logout and session-expiry handling;
- Monday 04:00 Bangkok weekly snapshot schedule using the Slice-C revision-claim transaction;
- daily 03:00 Bangkok portable D1 JSON export to staging R2;
- environment-specific timestamped keys and 35-day retention;
- application-schema-only portable format (`family-cash-flow-d1-portable-v2`), excluding D1-owned `_cf_*` metadata;
- SHA-256 integrity over both schema and table data, plus restore-SQL generator;
- disposable real D1/R2 backup-and-empty-D1 restore workflow;
- D1 Time Travel bookmark check;
- updated local and deployed mobile/desktop acceptance automation.

## Local automated evidence

- Slice D auth/runtime/scheduler/backup tests: 11 passed;
- locked Slice B financial tests: 12 passed;
- accepted Slice C write/correction/concurrency tests: 33 passed;
- frontend and Worker syntax checks: passed;
- all workflow YAML: parsed successfully;
- legacy Apps Script/session-storage/nested-loader dependency scan of the final runtime: clean;
- portable backup restored into a completely empty local SQLite database with zero foreign-key violations.

## Deployed automated evidence

- staging branch at the completed proof: `bd4f51d02a53405bd43cd324e31056a38cb66d9d`;
- deployed Slice D runtime commit: `b8066667efe19dfee455f38439c49b82107bf3ff`;
- staging health: `{"ok":true,"service":"family-cash-flow","runtime":"slice-d","appsScriptDependency":false}`;
- [Cloudflare staging direct deploy — passed](https://github.com/KhunAlek/family-balance/actions/runs/31817983039);
- [Slice D final runtime tests — passed](https://github.com/KhunAlek/family-balance/actions/runs/31817983050);
- [Slice D deployed same-origin test — passed](https://github.com/KhunAlek/family-balance/actions/runs/31817983146);
- [staging mobile/desktop browser startup — passed](https://github.com/KhunAlek/family-balance/actions/runs/31818221545);
- [real disposable D1 → R2 → empty-D1 restore proof — passed](https://github.com/KhunAlek/family-balance/actions/runs/31818221585).

The real disposable proof recorded all of the following in one run:

1. two completely new remote D1 databases and a new R2 bucket;
2. locked Slice B data imported into the source D1;
3. D1 Time Travel bookmark availability;
4. a real Slice D weekly write using the revision claim (`revision = 1`, one snapshot written);
5. a real portable R2 backup containing all 16 application tables;
6. SHA-256 verification of schema and data;
7. restore into the completely empty second D1 database with normal D1 foreign-key enforcement enabled;
8. zero `PRAGMA foreign_key_check` rows;
9. exact reconciliation of key source and restored counts/revision;
10. successful deletion of all disposable Worker, R2 and D1 resources.

## Outstanding acceptance gate

Automated Slice D staging gates are complete. The remaining acceptance work requires an approved real Google account in an interactive browser:

1. confirm Google sign-in at `https://family-cash-flow-staging-bridge.abystrov66.workers.dev`;
2. confirm session refresh and sign-out;
3. exercise the approved controlled staging read/write/correction workflows on mobile and desktop;
4. record user acceptance or any defects.

If Google reports an unauthorized origin, add the staging Worker origin to the existing Google OAuth web client before repeating the sign-in test.

Production `main` is still `5df6a84f47e904e6909870b438313f5b10c62e22`. Production cutover remains a separate explicit authorization after real-user acceptance passes.
