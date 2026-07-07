---
name: Puppeteer Chrome auto-install
description: Puppeteer Chrome binary is not auto-downloaded by pnpm install; must be explicitly installed; and monitoring app API URL pattern.
---

## Puppeteer Chrome install

The `puppeteer` npm package is installed but the Chrome binary is NOT downloaded automatically in this Replit environment (no postinstall TTY). Running `npx puppeteer browsers install chrome` from the api-server directory installs it to `/home/runner/.cache/puppeteer/chrome/`.

**Fix:** `ensureBrowser.ts` in `artifacts/api-server/src/lib/` checks if the chrome dir exists at startup and runs the install if missing. Called from `index.ts` after `ensureSeedData()`.

**Why:** Puppeteer-core (the underlying package) does not auto-download Chrome; it needs an explicit browser install step. In CI/Replit environments the postinstall script silently skips TTY-required steps.

## Monitoring app API URL pattern

From the production-monitoring frontend, API calls must use **absolute paths** (`/api/...`), NOT `${import.meta.env.BASE_URL}/api/...`.

- `import.meta.env.BASE_URL` = `/monitoring/` (the app's preview path)
- `${base}/api/...` = `/monitoring/api/...` which routes to the Vite dev server (wrong)
- `/api/...` = routes correctly to the API server via the Replit proxy

The Orval-generated hooks already use `/api/...` absolute paths — follow the same pattern for any manual `fetch()` calls in the monitoring app.
