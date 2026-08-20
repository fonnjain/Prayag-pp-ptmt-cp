---
name: Corrective capacity basis
description: Calendar basis used by corrective feasibility after Sunday analysis.
---

For corrective feasibility, align Cap/Day samples to positive non-Sunday production days and multiply them by calendar Mon–Sat remaining days. Worked Sundays remain included in production totals and pace metrics, but are not projected into future corrective capacity. This is calendar-basis alignment, not a guarantee that capacity falls: with `sorted[floor(n × 0.9)]`, removing a low Sunday can raise p90 at sample-size boundaries, and p90-to-mean threshold crossings can also change capacity.

**Why:** A forward-looking corrective run cannot know which future Sundays will actually be worked; adding observed future Sundays retrospectively produces an unimplementable estimate. The current p90 ladder is retained because seeded values and the documented ≥5-day rule depend on it; changing percentile semantics needs a separate golden-data decision.

**How to apply:** Keep capacity samples and the remaining-day denominator on the same calendar basis unless a separately configured Sunday-working policy is introduced. Report unexpected capacity increases as estimator/rank effects, not as evidence that the calendar basis is inconsistent.