---
name: Upload period semantics
description: Rules for associating uploaded planning inputs with a planning month.
---

An upload's explicit YYYY-MM planning period is authoritative. Legacy uploads without one are resolved from the filename; last-month pending and Plumbing FG Stock filenames refer to the source month and therefore map to the following planning month. Monthless DATA files use their upload timestamp only as a backward-compatible fallback.

**Why:** Filename-only selection let monthless shared DATA files and previous-month source filenames make September readiness and plan execution consume August inputs.

**How to apply:** Readiness and every live plan-building path must select uploads by resolved period, never by kind plus newest timestamp alone. Keep old rows resolvable while requiring new upload flows to send the selected planning month.