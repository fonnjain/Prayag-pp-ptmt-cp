---
name: Browser auth and machine routes
description: Shared browser sessions must not intercept the existing API-key machine endpoints.
---

Browser authentication is enforced at the API boundary, but machine-to-machine routes must be explicitly bypassed before session enforcement so their own Bearer API-key middleware remains authoritative.

**Why:** A blanket session guard would break plant-live ingestion and corrective machine updates, which are intentionally independent of browser accounts.

**How to apply:** When adding protected API routes, classify browser and machine callers first; keep only the documented API-key paths outside the session guard and validate their credentials in their route middleware.