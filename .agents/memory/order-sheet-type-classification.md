---
name: Order Sheet TYPE classification
description: Business rules for classifying Order Sheet rows into PTMT, Plumbing, or excluded coverage.
---

**Rule:** Use the Order Sheet `TYPE` field as the authoritative classification, normalized only by trimming and uppercasing with exact membership. Keep `GROUP` only as a compatibility fallback for old layouts that have no `TYPE` column. `C P`, `HDPE PIPE`, and unknown or blank types remain excluded from both PTMT and Plumbing.

**Why:** The Order Sheet is a shared source across planning, Ops coverage, and corrective exports. Prefix or fuzzy matching would silently move demand between segments; excluding undecided types keeps coverage visible without inventing a business assignment.

**How to apply:** Reuse the shared classifier in every Order Sheet consumer, preserve excluded quantities/value in coverage diagnostics, and enforce the requested segment independently for scoped machine/API reads.