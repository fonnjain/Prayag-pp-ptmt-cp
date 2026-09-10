---
name: Seasonality audit provenance
description: What the PTMT monthly multiplier rows preserve and what later audits cannot reconstruct exactly.
---

The PTMT monthly multiplier table preserves the suggested/effective multiplier, CV, quality, observation count, z-score, and timestamps, but not the raw FY-by-FY quantities that produced the result.

**Why:** A later read of the source Sheets can differ because catalog mappings or source rows changed after the run, so it must not be presented as the historical run input without an explicit provenance link.

**How to apply:** For historical audits, report raw quantities only when they are independently preserved in the audit evidence; otherwise distinguish current source reconstruction from unrecoverable historical inputs.