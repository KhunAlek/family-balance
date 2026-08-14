# Slice D State — IMPLEMENTATION DEPLOYMENT IN PROGRESS — 2026-08-14

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
- embedded schema, SHA-256 integrity manifest and restore-SQL generator;
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

## Outstanding deployed gates

The following are intentionally not marked accepted until GitHub Actions deploys the staging Worker and records evidence:

1. Wrangler deployment dry-run;
2. staging R2 bucket and signed-session secret bootstrap;
3. same-origin Worker deployment;
4. deployed mobile/desktop startup;
5. real disposable weekly writer;
6. real disposable D1-to-R2 backup and empty-D1 restore;
7. approved-user Google login and controlled staging workflow acceptance.

Production cutover remains a separate explicit authorization after those gates pass.
