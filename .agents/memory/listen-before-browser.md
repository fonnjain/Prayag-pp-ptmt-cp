---
name: API listen-before-browser-and-migrations
description: app.listen must be the very first thing in startup; migrations and Chrome install must NOT block it or healthchecks fail in production
---

## Rule
Call `app.listen()` first — before `runMigrations()`, `ensureSeedData()`, AND `ensureBrowser()`. After the port is bound, run migrations + seeding in sequence, then Chrome in background.

## Why
On a cold production deploy:
- `runMigrations()` + `ensureSeedData()` take ~60 seconds (cold DB schema setup + row seeding).
- `ensureBrowser()` with `execSync` blocks the event loop for ~100s during Chrome download.
- If either runs before `app.listen()`, the server is not bound during that window.
- Replit healthcheck probes `GET /api` repeatedly; "connection refused" or event-loop freeze → HTTP 500. Deployment never passes its health gate.

`GET /api` (root health handler) touches no database, so it responds 200 immediately even before migrations complete.

## How to apply
In `index.ts`:
```ts
const app = createApp();

// Bind immediately — healthchecks pass on cold starts right away
await new Promise<void>((resolve) => {
  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "api-server listening");
    resolve();
  });
});

// DB setup after bind — routes work once this completes (~seconds)
await runMigrations();
await ensureSeedData();

// Chrome install non-blocking — PDF generation available once done
ensureBrowser().catch((err) => logger.warn({ err }, "Background browser setup failed"));
```

Also ensure `ensureBrowser` uses async `exec()` not `execSync` so even if Chrome needs installing, the event loop stays free.

Chrome caches at `~/.cache/puppeteer/chrome/`; subsequent deploys skip it via `existsSync` check.
