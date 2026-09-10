---
name: Prayag category duplicate codes
description: Prayag planning evidence can contain one item code under multiple planning categories.
---

Prayag planning evidence is not always a one-code-to-one-category mapping. Exactly 18 identities appear under multiple Prayag categories; these are `AMBIGUOUS_IN_SOURCE`, not category mismatches, and must remain `Unclassified`. Separately, frozen Temporary Plan #2367 had 107 stale `Unclassified` codes that the current precedence-aware roster now resolves with Prayag evidence; there was no real 89-code unexplained remainder.

**Why:** The prior audit conflated two populations: the 107 stale categories in frozen #2367 and the independently identified 18 ambiguous source identities. A fresh Temporary Plan is the valid comparison baseline after the precedence rule changes.

**How to apply:** Preserve category assignments at the same grain as the planning rows (at least code plus the available variant identity), or surface an explicit multi-category conflict. Never resolve duplicate evidence with last-row-wins; exclude `AMBIGUOUS_IN_SOURCE` from mismatch counts. Retire #2367 as a category-comparison baseline once a fresh run exists.