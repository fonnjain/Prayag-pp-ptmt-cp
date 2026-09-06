---
name: Regression root-cause gating
description: Cross-source regression checks must not interpret a structured source-input failure as a real zero metric.
---

When an upstream validation or monitoring endpoint returns a structured input failure, downstream cross-source comparisons must identify that cause explicitly instead of comparing the missing side as zero. A zero-versus-nonzero result can be deterministic and fast while still being secondary to the source failure.

**Why:** The PTMT monitoring path can refuse to produce a partial payload when pending reconciliation is invalid. Treating that response as `produced=0` makes NC13 look like a cross-source production mismatch and obscures the actual input-integrity failure.

**How to apply:** Preserve the structured error metadata through the verifier, report the input failure as the root result, and only run a numeric cross-source comparison when both source payloads are valid.