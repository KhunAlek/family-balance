# Family Cash Flow — Slice A staging state — 2026-08-14

Branch: `staging-startup-repair-20260814`

Production `main` has not been modified.

## Status

**SLICE A — ACCEPTED / COMPLETE**

Accepted on 2026-08-14 after both required real Google-account tests passed in addition to the full automated transport/browser suite.

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

Both staging Wrangler configs use that live deployment as `UPSTREAM_URL`.

## Frontend wiring

Staging frontend uses one centralized endpoint:

`https://family-cash-flow-staging-bridge.abystrov66.workers.dev/api/apps-script`

`assets/v24/v24_1_app1.js` defines `API_ENDPOINT`.

`assets/v24/v24_1_app2.js` calls `fetch(API_ENDPOINT, ...)`.

Direct browser fetch to Apps Script is removed from the loaded staging transport. No iframe/form transport is used. The repaired direct `assets/v24/v24_1_app4.js` loading path remains.

## Separate live staging host

Repository: `KhunAlek/family-balance-staging`

GitHub Pages URL: `https://khunalek.github.io/family-balance-staging/`

The site is published from `main` / repository root and contains the validated staging `index.html` and `assets/` copied from `KhunAlek/family-balance` branch `staging-startup-repair-20260814`.

A live-host GitHub Actions probe verified that the public staging page is reachable, the published `app1.js` contains the Cloudflare Worker endpoint, `app2.js` calls `fetch(API_ENDPOINT, ...)`, and no direct browser `fetch('https://script.google.com...')` remains.

## Automated acceptance evidence — PASS

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

## Human Google-account acceptance evidence — PASS

### Approved account — PASS

On 2026-08-14 the account owner opened the real public staging site at `https://khunalek.github.io/family-balance-staging/`, signed in through Google Identity Services using authorized account `abystrov66@gmail.com`, and the household dashboard loaded successfully with current household data through the staging Cloudflare bridge.

Screenshot evidence was supplied in the project chat showing the fully loaded dashboard (Weekly Variables, Planning position, Emergency Fund, Fixed obligations, Goals, and Account balances all populated).

The backend source allowlist contains two authorized Google accounts:

- `abystrov66@gmail.com`
- `harlyhanz@gmail.com`

### Unauthorized account — PASS

On 2026-08-14 the account owner opened the real public staging site in a separate/private browser context and authenticated with a Google account outside the two-account allowlist.

The application rejected the account with the exact visible message:

`This Google account is not authorized for Family Cash Flow.`

The dashboard did not open. Screenshot evidence was supplied in the project chat showing the auth gate and rejection message.

## Slice A acceptance conclusion

All Slice A mandatory criteria are satisfied:

- a real deployed Cloudflare Worker endpoint exists;
- browser traffic uses the Worker bridge rather than relying on GitHub Pages → Apps Script CORS;
- no iframe/form transport is used;
- invalid-token handling settles to structured JSON;
- no permanent loading state remains on tested mobile/desktop viewports;
- an approved Google account reaches the dashboard;
- an unauthorized Google account is rejected;
- production `main` has not been changed by Slice A.

**Slice B may now begin.**
