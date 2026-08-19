---
name: Plant monitoring version freeze
description: Rules for historical plan-version hydration and immutable completed-month monitoring.
---

Historical plan-version hydration must only include sources whose effective date belongs to the target month; never redate an out-of-month corrective run to force it into the timeline. Concurrent first reads must share one hydration promise so no request can freeze a partial timeline.

**Why:** Legacy corrective data may have an `asOfDate` after its named plan month, and monitoring endpoints make parallel target/timeline reads. Clamping or racing these reads silently attributes production to the wrong version or freezes an incomplete payload.

**How to apply:** Validate new effective dates strictly. For legacy data, fall back to the source creation date only when it is inside the named month; otherwise skip it. Before reading snapshots, await an in-flight hydration for that month and segment. On a closed month, persist the complete monitoring payload once and serve that same payload to all later bundle and weekly requests.