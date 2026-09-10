---
name: Plumbing scheduler reality
description: External Plumbing Pass 2 availability, persistence evidence, and fallback boundary
---

The Plumbing Pass 2 adapter is a direct authenticated request to the plant scheduler, not a local implementation of machine scheduling. A minimal development probe on 2026-09-08 reached the configured host successfully and returned HTTP 200 with the expected scheduler payload. The application has no alternate capacity host or proxy and no local fallback when this call fails; the plan-run route returns `PLUMBING_SCHEDULER_FAILED` instead.

**Why:** A machine-app report that the endpoint is unavailable is not sufficient evidence against this integration; the configured host and request contract must be checked directly.

**How to apply:** Treat `plan_schedule_results` as evidence that an actual external scheduling call completed. Treat `category_capacity` and `plumbing_machine_capacity` as local supporting data, not as proof that external Pass 2 ran or as an automatic replacement for it.