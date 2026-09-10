---
name: Approved capacity overrides
description: How approved PTMT rates enter Pass 2 when historical p90 evidence is unavailable.
---

## Rule
When a PTMT category has an approved operating rate but no usable daily-production history, persist the rate in `category_capacity.override_capacity`. Pass 2 selects that override while the zero `p90_per_day` and `suggested_capacity` remain an honest record of missing observed evidence.

**Why:** Seeded rows for special categories can exist with zero historical capacity. Treating those zeros as the approved rate creates configuration-driven cannot-be-made quantities that look like machine constraints.

**How to apply:** Verify the exact PTMT category name and segment first. Use an explicit override for the approved rate, then rerun Pass 2. Do not fabricate p90/comparison history or assign a capacity row to intentionally unclassified categories.