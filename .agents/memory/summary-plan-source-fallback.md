---
name: Summary plan source fallback
description: Source precedence and unsafe fallback behavior for the planning Summary screen
---

The Summary, Category, and operational monitoring surfaces now use only the newest finalized Production run; when none exists they return/show a neutral state and identify any finalized Temporary run as unfitted.

**Why:** Summary is intended to show what can actually be made; Temporary demand or live computation must not silently appear as the production-facing result when no finalized Production plan exists.

**How to apply:** Preserve explicit source/run labeling and use a neutral empty state when no finalized Production run exists; keep Temporary reruns, capacity fitting, and finalization as separate Plan Runs actions.