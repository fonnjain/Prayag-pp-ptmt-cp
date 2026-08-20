---
name: API startup readiness
description: Startup behavior that prevents first-page clients from racing migrations and seeding.
---

The API may bind its port before migrations and seed data finish so platform healthchecks can pass, but database-backed routes must return a clear retryable not-ready response until initialization succeeds. Client queries should retry with bounded exponential backoff.

**Why:** A browser can open the dashboard immediately after a process restart. If the first requests race initialization and are exhausted after one retry, navigating to another tab remounts the page and hides the startup race by issuing fresh requests later.

**How to apply:** Keep `/api/` and `/api/healthz` available during warm-up, gate other `/api` routes behind an in-memory readiness flag set only after migrations and seeding succeed, and configure React Query retry/backoff at the shared client. Do not make the frontend wait on a tab change to recover.