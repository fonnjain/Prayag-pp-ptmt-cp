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

Range-name audits canonicalize only the eight known presentation aliases in the supplied list, yielding 148 values; do not broadly strip punctuation from qualified or colour-specific names.

**Why:** broad punctuation removal collapses distinct-looking qualified families and changes the governed review scope, while the audited aliases are formatting-only duplicates.

**How to apply:** keep new range-name normalization conservative and verify the complete supplied-list audit count before changing planning classification.

The evidence-backed PTMT pending boundary is 168,695 source pieces, 160,501 joined, and 8,194 unmatched across 33 codes (95.14% matched). The earlier 5,889 figure was only an estimate from 38 July exclusion codes.

**Why:** the full-source reconciliation is the reproducible measure; the smaller estimate is not a valid completeness result. The unmatched codes are a mapping gap, not evidence that the families are absent.

**How to apply:** keep Cocks Standard, Cocks Premium, and Faucets & Jetsprays explicitly unmapped until reviewed; together with four other categories they represent about 80% of PTMT capacity in the 4,422-code governed rate list.