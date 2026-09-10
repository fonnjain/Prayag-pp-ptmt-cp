---
name: H2r raw-spelling guard
description: Raw-spelling collision checks must remain warning-only until live source drift and canonical-key policy are resolved.
---

The roster guard groups by the existing strict comparison key, then reports only groups containing distinct raw code spellings; multiple colours of one raw spelling are valid and must not be treated as duplicates. The guard must not normalize, merge, drop, or throw on current collisions.

**Why:** The live rate-list source can drift from a prior H1 snapshot and expose many more punctuation variants than the historical seven-group inventory. A hard-coded seven-group filter would hide current source evidence and a fatal guard could break planning.

**How to apply:** Keep the diagnostic at roster construction, report the current source values, and make fatal enforcement wait for an explicit canonical-key decision plus reconciliation of live rate-list variants and persisted plan identities.

For source-coverage read models, the existing strict comparison key may reconcile punctuation-only variants while retaining each raw spelling in the report. This is evidence reconciliation only; it does not authorize plan-to-plan deduplication or a silent roster merge.

**Why:** September Plumbing MRP coverage contains legitimate punctuation variants such as `4763W`/`4763-W`; exact matching would undercount MRP coverage, while mutating the persisted planning identity would be unsafe.

**How to apply:** Use the strict key for coverage counts and cross-source evidence, preserve raw codes in outputs, and keep plan-builder integration as a separately reviewed change.