---
name: Pending trace roster boundary
description: The roster boundary required for pending exclusion fingerprints and source/join diagnostics.
---

Pending exclusion fingerprints, unmatched quantities, and roster-join diagnostics must be computed against the pre-Unclassified roster. The final plan rows intentionally include Unclassified rows, so using them as the join roster turns every excluded source row into a false match and produces a zero-exclusion fingerprint.

**Why:** A September Plumbing draft initially persisted a zero fingerprint because its provenance calculation reused the completed plan rows after Unclassified routing. The visible plan was correct, but the stored evidence could not explain the exclusion population.

**How to apply:** Filter out rows with an `unmappedReason` before calling pending-plan diagnostic or fingerprint helpers. Keep the final rows for conservation checks, where Unclassified sums are compared back to the pre-Unclassified evidence.