---
name: Corrective capacity basis
description: Calendar basis used by corrective feasibility after Sunday analysis.
---

For the conservative feasibility policy, derive Cap/Day from positive non-Sunday production days and multiply it by calendar Mon–Sat remaining days. Worked Sundays remain included in production totals and pace metrics, but are not projected into future corrective capacity.

**Why:** A forward-looking corrective run cannot know which future Sundays will actually be worked; adding observed future Sundays retrospectively produces an unimplementable estimate.

**How to apply:** Keep capacity samples and the remaining-day denominator on the same calendar basis unless a separately configured Sunday-working policy is introduced.