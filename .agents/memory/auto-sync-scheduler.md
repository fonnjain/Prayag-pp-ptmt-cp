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
