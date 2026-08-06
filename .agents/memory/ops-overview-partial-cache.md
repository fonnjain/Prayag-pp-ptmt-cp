---
name: Ops overview partial-read caching
description: Live-Sheets aggregates must not be cached when any per-tab read fails
---
The ops overview endpoint aggregates order value across monthly tabs of a live order sheet. Per-tab read failures used to be silently swallowed and the partial total cached 5 min — producing nonsense like Combined < Plumbing and flaking the NC10 regression check.

**Why:** a poisoned 5-min cache turns a transient Sheets quota hiccup into minutes of wrong numbers; the suite failed once and passed on re-run, eroding trust.

**How to apply:** any endpoint that aggregates multiple live-sheet reads must track a `partialRead` flag and skip caching when set. On the suite side, live-data checks in the "New checks" section use `fetchJson` (retries 429/5xx) and `evaluateWithRetry` (one re-evaluation before recording a failure) — reuse these for new endpoint-level checks.
