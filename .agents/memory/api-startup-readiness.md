---
name: API startup readiness
description: Startup behavior that prevents first-page clients from racing migrations and seeding.
---

The API may bind its port before migrations and seed data finish so platform healthchecks can pass, but database-backed routes must return a clear retryable not-ready response until initialization succeeds. Bootstrap must retry transient migration/seeding failures with bounded backoff; client queries should also retry with bounded exponential backoff.

**Why:** A browser can open the dashboard immediately after a process restart, and the database can briefly terminate a connection during startup. A one-shot bootstrap failure leaves every DB-backed route at 503 until the process is restarted.

**How to apply:** Keep `/api/` and `/api/healthz` available during warm-up, gate other `/api` routes behind an in-memory readiness flag set only after migrations and seeding succeed, retry bootstrap failures in the background, and configure React Query retry/backoff at the shared client. Do not make the frontend wait on a tab change to recover.