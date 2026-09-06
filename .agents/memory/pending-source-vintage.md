---
name: Pending source vintage in manual comparisons
description: Manual September plans can use an older pending snapshot than the app's current planning source.
---

When comparing a manual plan with an app plan, verify the pending snapshot's source month before treating quantity differences as missing data or over-counting. In the September 2026 PTMT comparison, every non-zero manual last-month-pending value matched July, while the app used August; the variance was source vintage, not a roster or formula defect.

**Why:** A manual plan can remain numerically consistent with its own older snapshot even after orders are fulfilled or new orders arrive in the app's newer snapshot.

**How to apply:** Report both strict code-level matches and non-zero-value matches, identify the source month used by each plan, and do not raise a completeness question until the source vintages are aligned.