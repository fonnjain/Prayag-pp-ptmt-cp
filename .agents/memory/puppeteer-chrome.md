---
name: Puppeteer Chrome auto-install
description: Puppeteer Chrome binary is not auto-downloaded by pnpm install; must be explicitly installed; partial-download trap; and monitoring app API URL pattern.
---

## Puppeteer Chrome install

The `puppeteer` npm package is installed but the Chrome binary is NOT downloaded automatically in this Replit environment (no postinstall TTY). Running the install.mjs script installs it to `/home/runner/.cache/puppeteer/chrome/linux-<ver>/chrome-linux64/chrome`.

**Fix:** `ensureBrowser.ts` in `artifacts/api-server/src/lib/` checks at startup and runs install if missing. Called from `index.ts` in a background callback after `listen()` fires (never before, or healthchecks fail).

**Partial-install trap:** A failed/interrupted download leaves the `linux-<ver>` directory empty. The install script detects the directory and bails with "executable missing". `ensureBrowser.ts` must check for the **actual `chrome` binary** (using `find ... -name chrome`), NOT just `existsSync` on the directory. If the binary is absent, delete any partial directories before re-running install.

**Why:** Puppeteer-core does not auto-download Chrome; the postinstall script silently skips in TTY-less environments. A prior `ensureBrowser.ts` used `existsSync(cacheRoot/chrome)` which reported "already installed" even when the zip was corrupt and the executable was absent.

**require.resolve trap:** `require.resolve("puppeteer/package.json")` fails for workspace-root packages accessed from a leaf artifact under `tsx`. Use the absolute pnpm content-store path instead:
`/home/runner/workspace/node_modules/.pnpm/puppeteer@23.11.1_typescript@5.9.3/node_modules/puppeteer/install.mjs`

## Order Sheet tab naming

The Order Sheet 26-27 uses bare month names (`"July"`, `"Apr"`) rather than `"Jul-26"` format for per-month tabs. `fetchLiveOrderByMonthTab` must try:
1. Year+month match first (e.g. `"Jul-26"`)
2. Bare-month-name fallback (e.g. `"July"` or `"Jul"`) using `MONTH_NAMES[m-1]`
3. Only then fall back to Combined-tab filter

## Monitoring app API URL pattern

From the production-monitoring frontend, API calls must use **absolute paths** (`/api/...`), NOT `${import.meta.env.BASE_URL}/api/...`.

- `import.meta.env.BASE_URL` = `/monitoring/` (the app's preview path)
- `${base}/api/...` = `/monitoring/api/...` which routes to the Vite dev server (wrong)
- `/api/...` = routes correctly to the API server via the Replit proxy

The Orval-generated hooks already use `/api/...` absolute paths — follow the same pattern for any manual `fetch()` calls in the monitoring app.
