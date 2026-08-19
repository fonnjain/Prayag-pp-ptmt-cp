---
name: Plant monitoring version freeze
description: Rules for historical plan-version hydration and immutable completed-month monitoring.
---

Historical plan-version hydration must only include sources whose effective date belongs to the target month; never redate an out-of-month corrective run to force it into the timeline. Concurrent first reads must share one hydration promise so no request can freeze a partial timeline. Versioned reporting must use the union of every issued version’s items and categories, attribute each actual to the version active on its production date, and identify every governing plan on each weekly card.

**Why:** Legacy corrective data may have an `asOfDate` after its named plan month, and monitoring endpoints make parallel target/timeline reads. Clamping or racing these reads silently attributes production to the wrong version or freezes an incomplete payload. Building reports from only the latest version also drops retired or recategorized production and makes boundary weeks unauditable.

**How to apply:** Validate new effective dates as real UTC calendar dates. For legacy data, fall back to the source creation date only when it is inside the named month; otherwise skip it. Before reading snapshots, await an in-flight hydration for that month and segment. On a closed month, persist the complete monitoring payload once and serve that same payload to all later bundle and weekly requests. Keep retired/reclassified rows in historical reporting and display source labels plus effective dates for all versions intersecting a week.

Completed months retain a final grace day through the 7th of the following month and freeze at 00:00 UTC on the 8th.

**Why:** The business owner explicitly confirmed the 7th must remain available for late actuals.

**How to apply:** Preserve the lifecycle boundary of `<= 7` for grace and an 8th-of-next-month closed timestamp; do not change it without a new business decision.

When legacy plan snapshots share an effective date, the last stored revision governs that date and earlier same-day sources remain attached as superseded provenance.

**Why:** Historical backfill can contain repeat same-day recomputes even though new versions reject duplicate effective dates. Hiding the earlier records makes historical production attribution impossible to audit.

**How to apply:** Do not delete or silently merge duplicate legacy source rows. Canonicalise them only in the returned timeline, retain their kind/source ID/label as superseded provenance, and use the canonical timeline for monitoring attribution.