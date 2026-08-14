# Family Cash Flow — Slice A staging state — 2026-08-14

Branch: `staging-startup-repair-20260814`

Production `main` has not been modified.

## Deployed bridge

Worker: `family-cash-flow-staging-bridge`

Workers.dev origin: `https://family-cash-flow-staging-bridge.abystrov66.workers.dev`

Routes:

- `GET /health`
- `POST /api/apps-script`
- `OPTIONS /api/apps-script`

The Worker is deployed directly from GitHub Actions with Wrangler 4 because Cloudflare's native Workers & Pages Git installation reports an internal installation error and does not receive repository push events.

GitHub Actions secret used for deployment: `CLOUDFLARE_API_TOKEN` (value is not stored in the repository).

The bridge accepts only origin `https://khunalek.github.io`, has a fixed Apps Script upstream, caps request bodies at 64 KiB before buffering, does not intentionally log request bodies/tokens/sessions, and emits `Cache-Control: no-store`.

## Apps Script upstream

The package's v53 deployment ID (`AKfycbzJHbXZPiYPCfYGmG3CYd9dryXk0r8clMYgGsV73T7KzHEwshxBP_z5RjX700EBMOTBAg`) was re-probed on 2026-08-14 and now returns HTTP 401 / Google Drive HTML directly from `script.google.com`; it is therefore not usable as the Slice A upstream.

The immediately preceding deployment was independently re-probed and is live:

`https://script.google.com/macros/s/AKfycbwtgB7WGkR-XRe19xda5xWmxPg4d_uymyu7wk-Vc0HEQpWdOHTuJ48pj1BIADZ8nOqLUA/exec`

With the same intentionally invalid Google access token it redirects normally to `script.googleusercontent.com` and returns the expected structured response:

`{"ok":false,"error":"Google sign-in could not be verified."}`

Both staging Wrangler configs now use that live deployment as `UPSTREAM_URL`.

## Frontend wiring

Staging frontend uses one centralized endpoint:

`https://family-cash-flow-staging-bridge.abystrov66.workers.dev/api/apps-script`

`assets/v24/v24_1_app1.js` defines `API_ENDPOINT`.

`assets/v24/v24_1_app2.js` calls `fetch(API_ENDPOINT, ...)`.

Direct browser fetch to Apps Script is removed from the loaded staging transport. No iframe/form transport is used. The repaired direct `assets/v24/v24_1_app4.js` loading path remains.

## Automated acceptance evidence

All automatable Slice A deployment tests are green against the real deployed Worker:

- Worker `/health` returns `{ok:true,service:"family-cash-flow-staging-bridge"}`.
- Allowed-origin invalid-token POST returns exactly `{ok:false,error:"Google sign-in could not be verified."}`.
- Allowed-origin CORS is present.
- `OPTIONS` preflight succeeds with HTTP 204.
- Proxy response is `no-store`.
- Disallowed origin is rejected with HTTP 403 and no allow-origin header.
- Chromium browser CORS transport succeeds from the `https://khunalek.github.io` origin.
- Mobile 390x844 startup: loading cleared, auth gate visible, Google login visible, no app error.
- Desktop 1440x900 startup: same.

Successful deployed A3 run: GitHub Actions run `31802147012`, rerun job `94772537050`.

Browser screenshots artifact from the successful run: `slice-a-deployed-browser-screenshots`, artifact ID `9219729893`.

## Remaining Slice A acceptance work

Two mandatory checks cannot be synthesized because they require real Google Identity Services credentials from human Google accounts:

1. An approved account must complete Google sign-in and reach the dashboard through the Worker.
2. An unauthorized Google account must be rejected.

The current public `https://khunalek.github.io/family-balance/` site is production/main, so it must not be repointed or modified for this test. A separate GitHub Pages staging repository/site under the same `https://khunalek.github.io` origin is required before asking the account owner to perform these two checks.

No D1 work or Slice B work should start until these two Slice A checks are completed and Slice A is accepted.
