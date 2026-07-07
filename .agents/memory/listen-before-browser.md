---
name: API listen-before-browser
description: ensureBrowser (puppeteer Chrome install) must not block app.listen or production healthchecks fail
---

## Rule
Always call `app.listen()` before `ensureBrowser()`. Never await browser setup before binding the port.

## Why
`ensureBrowser()` runs `execSync("npx puppeteer browsers install chrome")` which downloads ~100MB of Chrome. This takes ~100 seconds. If it runs before `app.listen()`, the server is not bound for the entire install duration. Replit healthchecks probe the path continuously; "connection refused" is reported as HTTP 500. The deployment never passes its health gate.

## How to apply
In `index.ts`:
```ts
await runMigrations();
await ensureSeedData();
const app = createApp();
app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "api-server listening");
  // background — PDF generation becomes available once Chrome is ready
  ensureBrowser().catch((err) => logger.warn({ err }, "Background browser setup failed"));
});
```
Chrome still installs on first deploy; subsequent deploys skip it (existsSync check). PDF routes should handle the case where Chrome isn't ready yet (they already catch puppeteer launch errors).
