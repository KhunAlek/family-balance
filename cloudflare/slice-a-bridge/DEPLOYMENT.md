# Slice A staging deployment

Cloudflare Workers Builds must deploy this bridge from branch `staging-startup-repair-20260814`.

The repository-root `wrangler.jsonc` points to `cloudflare/slice-a-bridge/src/index.js`, so no Cloudflare root-directory setting is required.

This staging bridge is intentionally isolated from `main` and exists only to prove the Cloudflare transport path before later migration slices.
