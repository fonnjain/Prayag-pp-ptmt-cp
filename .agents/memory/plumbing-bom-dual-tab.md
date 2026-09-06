---
name: Plumbing BOM dual-tab merge
description: fetchPlumbingBomWeights must read both NEW and Combined tabs; picking only one leaves 702 codes missing and blows the no-BOM guard.
---

## Rule
Always read BOTH tabs from the BOM workbook (`1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA`):
1. **NEW tab first** — fixed column layout, no reliable header: pair 1 = col A (index 0) / col B (index 1); pair 2 = col J (index 9) / col K (index 10). Range `A1:K100000`. ~1,446 entries.
2. **Combined tab second** — header-detected (`ITEM CODE` + `Weight/pcs`). ~866 entries. Overwrites any collision from NEW.
Merged total: ~1,567 unique codes.

**Why:** 702 codes exist only in NEW (not Combined). Reading only Combined caused CPVC Fitting, UPVC Fitting, UPVC Solvent, AGRI Pipe KG checks to fail and pushed the no-BOM pieces guard above 10%.

**How to apply:** On any BOM refresh or `fetchPlumbingBomWeights` change, verify the merge log shows `newCount≈1446`, `combinedCount≈866`, `total≈1567`. The no-BOM guard threshold is `< 10%`; after correct dual-tab load it sits around 5.9%.

## PPR coverage boundary
The inspected `NEW` and `Combined` tabs contain no explicit `PPR`-labelled rows, and the seeded item master has no PPR entries. Treat PPR coverage as unresolved until an authoritative source confirms whether PPR is absent, encoded under another identity, or supplied by another workbook.

**Why:** Enabling PPR from an inferred code pattern could create a plan for the wrong material family.

**How to apply:** Before adding PPR to Plumbing planning, reconcile an authoritative PPR code list against both BOM tabs and the item master; keep the source gap explicit if no list is provided.
