---
name: Plumbing BOM supplement
description: Durable rule for approved plant-app BOM weights loaded outside the live Google Sheet.
---

Approved plant-app BOM weights are an additive, provenance-tagged reference source, not a stock/pending upload and not an edit to the live Google Sheet. Existing live-sheet exact keys win; held conflict codes stay out until separately confirmed.

**Why:** The live BOM has multiple raw spellings and can contain conflicting low-unit values. Updating or replacing it would disturb source history and make it impossible to distinguish a July plant-app supplement from a fresh reading.

**How to apply:** Keep the supplement idempotent and additive, preserve the exact source/seed dates, do not create an upload period, and recompute frozen-plan effects in memory before any plan is created or finalized. The supplement stores kg/piece; frozen plan rows store total kg, so multiply by row demand before running machine-capacity analysis.