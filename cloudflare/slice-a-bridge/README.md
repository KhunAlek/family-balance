# Slice A staging transport bridge

This Worker is a **staging transport proof**, not the final Family Cash Flow runtime.

Purpose:

- prove that a Cloudflare Worker can call Apps Script v53 server-side;
- return the Apps Script response to the browser with explicit CORS headers;
- eliminate the proven GitHub Pages → Apps Script browser redirect/CORS failure;
- keep the upstream fixed so the Worker cannot become an open proxy.

Routes:

- `GET /health` — Worker health only;
- `POST /api/apps-script` — fixed proxy to Apps Script v53;
- `OPTIONS /api/apps-script` — CORS preflight.

Security constraints:

- only the configured `ALLOWED_ORIGIN` is accepted;
- `UPSTREAM_URL` is fixed in Worker configuration and cannot be supplied by the caller;
- request bodies are capped at 64 KiB, including when `Content-Length` is absent;
- responses are `no-store`;
- access tokens/session payloads are never intentionally logged;
- production financial logic remains in Apps Script during this transport proof.

This directory is deliberately dependency-free. The included Node test validates route behavior, proxying, and the bounded-body guard without requiring Cloudflare credentials.

Deployment policy for this project: use Cloudflare's Git integration / Workers Builds or an already-connected Cloudflare tool. Do not ask the user to use Terminal or Wrangler manually.
