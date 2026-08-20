---
name: Monitoring payload caching lesson
description: Expensive Drive-backed monitoring payloads need a shared SWR cache with generation-based invalidation
---

**Rule:** Endpoints that rebuild plan/monitoring payloads from Drive workbooks (~24–45 s cold) must share one cached getter — never let a second endpoint call the raw compute function and bypass an existing route cache.

**Why:** The Plumbing dashboard endpoint bypassed the plan route's cache and looked broken in production (24 s first hits).

**How to apply:** cache with TTL + in-flight dedupe + stale-while-revalidate; invalidate after each workbook sync using a **generation counter** so a computation already in flight when the sync lands cannot repopulate the cache with pre-sync data; pre-warm at startup in parallel with the full sync (don't chain behind its rate-limit sleeps).
