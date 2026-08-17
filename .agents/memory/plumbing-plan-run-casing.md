---
name: Plumbing plan run casing
description: POST /plan/runs silently produces 0 items when segment="PLUMBING"; must use title-case "Plumbing".
---

## Rule
When creating a Plumbing plan run via `POST /plan/runs`, the `segment` field must be `"Plumbing"` (title-case), not `"PLUMBING"` (all-caps).

**Why:** `GET /plan` normalises internally (`segment.toLowerCase() === "plumbing" → "Plumbing"`), but `POST /plan/runs` passes the segment value straight to `buildPlanItems()` without normalisation. Using `"PLUMBING"` causes `buildPlanItems` to find no matching items and silently creates a plan run with 0 items and grandMaxTotal=0.

**How to apply:** Any API call that creates or filters plan runs for the Plumbing segment must use `"Plumbing"`. Applies to `POST /plan/runs`, `POST /corrective/replan` (segment field), and any direct DB queries — the DB stores the value as written.
