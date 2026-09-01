---
name: API listen-before-browser-and-migrations
description: app.listen must be the very first thing in startup; migrations and Chrome install must NOT block it or healthchecks fail in production
---

## Rule
Bind a bare liveness server before importing the Express app and its full route graph. After the port is bound, load the app, hand traffic to it, run migrations + seeding in sequence, then Chrome in background.

## Why
On a cold production deploy:
- Evaluating the bundled CommonJS route graph can take ~23 seconds before application code reaches `app.listen()`, even when migrations and warm-ups are already after listen.
- `runMigrations()` + `ensureSeedData()` take ~60 seconds (cold DB schema setup + row seeding).
- `ensureBrowser()` with `execSync` blocks the event loop for ~100s during Chrome download.
- If importing the app or either startup operation runs before the bare listener, the server is not bound during that window.
- Replit healthcheck probes `GET /api` repeatedly; "connection refused" or event-loop freeze → HTTP 500. Deployment never passes its health gate.

The bare listener returns honest `{"status":"starting"}` for `/api` and `/api/healthz`, and 503 for other paths until the app is loaded. The loaded health handlers still expose the build SHA and DB hostname; neither health route queries application tables.

## How to apply
In `index.ts`:
```ts
let realHandler: RequestListener | null = null;
const server = createServer((req, res) => {
  if (!realHandler) {
    if (req.url?.startsWith("/api/healthz") || req.url === "/api") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "starting" }));
    }
    res.writeHead(503);
    return res.end("starting");
  }
  realHandler(req, res);
});

server.listen(port, "0.0.0.0", () => {
  void loadApplication();
});

// loadApplication dynamically imports and installs createApp() after bind.
// DB setup follows app loading — routes return API_NOT_READY until complete.
await runMigrations();
await ensureSeedData();

// Chrome install non-blocking — PDF generation available once done
ensureBrowser().catch((err) => logger.warn({ err }, "Background browser setup failed"));
```

Also ensure `ensureBrowser` uses async `exec()` not `execSync` so even if Chrome needs installing, the event loop stays free.

Chrome caches at `~/.cache/puppeteer/chrome/`; subsequent deploys skip it via `existsSync` check.
