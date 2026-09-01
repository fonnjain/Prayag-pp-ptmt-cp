---
name: Month selection semantics
description: Rules for automatic month fallback versus explicit month selection across Planning and Monitoring.
---

No month in the URL is eligible for automatic fallback from the current month to the newest available month at or before it. A month present in the URL is an explicit choice, including the current month, and must remain selected even when unavailable; the UI shows a neutral empty state instead of silently falling back.

**Why:** A silent fallback can present correct figures under the wrong month, while treating an expected empty month as a red system failure makes it impossible to distinguish missing inputs from a broken source.

**How to apply:** Keep the shared month state URL-backed across both apps and segments. Use `isFallback` only for the no-query automatic-fallback path; use `isMonthAvailable` for explicit empty-state gating. Preserve real request/source errors as named error states.