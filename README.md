# Family Cash-Flow Tool

Private cash-flow coverage dashboard. Static single-page site, reads/writes via the Google Apps Script Web App.

## Deploy (GitHub Pages)

1. Commit `index.html` to this repo's default branch (root, or a `/docs` folder — either works, just match the setting in step 2).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**. Pick the branch and folder you used in step 1, then **Save**.
3. GitHub will publish to an unlisted `https://khunalek.github.io/family-balance/` URL (shown on that same Pages settings page once it's live — first publish can take a minute or two).

No build step, no dependencies to install — it's a single HTML file that fetches everything from the Apps Script Web App at load time.

## Notes

- All calculations happen server-side in Apps Script; this page only displays and submits data.
- If a fetch fails (e.g. no signal), the page falls back to the last successful load cached in the browser's `localStorage`, with a "may be outdated" banner.
- The weekly Balance Check form is the only input on the page and requires the PIN set in the Config tab.
