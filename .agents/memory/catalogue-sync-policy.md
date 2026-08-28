---
name: Catalogue sync policy
description: Confirmed division and category handling for the maintained product catalogue
---

Exact clean catalogue divisions map to the corresponding planning segment: `PTMT & Plastic Fittings` → PTMT, `Pipes & Fittings` → Plumbing, and `CP Fittings / Faucets` → CP. The reviewed exact pairing `Ceramic Sanitaryware | PTMT & Plastic Fittings` maps to PTMT. Hardware, standalone Ceramic Sanitaryware, and other combined values remain visible but unmapped; never assign them by first match.

Raw catalogue categories are preserved and require an explicit many-to-one review mapping before they can drive planning categories or buffer multipliers. Products with a valid identity but blank source names/categories are retained as nullable values rather than causing the complete source sync to fail.

**Why:** The catalogue owner confirmed that a wrong segment or category silently applies the wrong plan and buffer quantity, while an unmapped product is visible and recoverable. The live API can also differ from an archived export, so snapshot counts are not a source contract.

**How to apply:** Use exact division equality plus the reviewed combined-pair allow-list for segment classification, keep other unmapped/excluded rows in `master_products`, and do not switch planning away from `item_master` until category coverage has been reviewed.