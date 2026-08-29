---
name: PTMT rate-list roster
description: Durable source precedence and classification rules for the supplied PTMT rate-list roster.
---

The supplied PTMT rate list is a governed roster source. Use this precedence when resolving a PTMT identity:

1. planning-workbook classification and multiplier;
2. rate-list code, name, and range;
3. reviewed master-products catalogue;
4. explicitly unclassified.

Keep code variants such as `324-K` and `323-K` distinct unless the business explicitly confirms they are aliases. Map recognizable families conservatively; unfamiliar rows remain unclassified rather than receiving an inferred multiplier.

**Why:** the rate list provides the clean planning-code vocabulary that the ERP catalogue does not, but its category ranges are not safe evidence for guessing every multiplier.

**How to apply:** use the governed roster for new PTMT plans and coverage reporting; do not rewrite historical plan runs or frozen snapshots.