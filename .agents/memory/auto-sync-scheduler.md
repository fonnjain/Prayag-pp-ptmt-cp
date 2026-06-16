---
name: Work-hours auto-sync scheduler
description: The backend auto-pull scheduler — its purpose, the human-gate boundary it must never cross, and its deployment dependency.
---

# Auto-sync scheduler (api-server)

An in-process timer auto-pulls ALL sources for BOTH divisions for the current
calendar month at fixed IST work hours (`Asia/Kolkata`), then runs and persists
the data sanity check. Started at server boot; opt out with `DISABLE_SCHEDULER=1`.

**Hard boundary (do not cross):** auto-sync pulls data and records the sanity
verdict ONLY. It must NEVER acknowledge sanity warnings or build a plan.
**Why:** the buffer multiplier is always user input and warnings must be
human-reviewed before planning; auto-acknowledging/auto-building would silently
bypass that gate. **How to apply:** keep any scheduler extension to pull +
runSanity + persist verdict; acknowledge/build stay route-only (human action).

**Deployment dependency:** reliable only on the always-on **Reserved VM** (one
long-lived process). On autoscale it scales to zero and won't fire when idle —
harmless, degrades to manual-only. This is why the deployment was moved to a
Reserved VM.

**Cross-instance safety:** a Postgres session advisory lock wraps each sync so
that even if multiple instances are ever live (autoscale), exactly one performs
the pull per slot. In-memory flags alone only protect a single process.

**No-change sync timestamp + sanity batch identity:** "last synced / as of" must
reflect the last CHECK, not the last data change. A `UNIQUE(division, data_type,
plan_month, content_hash)` constraint on `import_batches` forbids inserting a
duplicate-hash "nothing changed" row, so on no-change the pull UPDATEs the
existing batch's `pulled_at` (keeping counts, verdict, and the `acknowledged`
flag). **Consequence:** the most-recently-pulled row can have a SMALLER id than a
changed row from the same pull, so `max(id)` is NOT a valid "latest batch".
Resolve the latest batch ONCE via `getLatestBatchId` (`ORDER BY pulled_at DESC,
id DESC`) and use that single id for sanity findings persistence, the verdict
update, AND retrieval — otherwise findings attach to one row while the verdict /
`getLatestSanity` read another, showing empty/stale findings. **How to apply:**
never reintroduce `max(id)` for sanity batch selection in the pull route or
scheduler.
