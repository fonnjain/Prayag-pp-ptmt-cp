---
name: Catalogue coverage gate
description: The synced catalogue is not currently a strict superset of the active planning roster.
---

Do not replace the planning roster with the catalogue alone until every active-roster-only code has been reviewed. Canonicalize Excel trailing `.0` code signatures and no-colour placeholders first; a preserving union can avoid dropping genuinely unresolved legacy demand while omissions and cross-segment codes are resolved.

**Why:** The source catalogue can omit active legacy codes or contain the same code under another division, so a direct swap can turn valid planned demand into unmatched demand.

**How to apply:** Before roster migration, compare canonicalized code-level coverage and pending quantities; report raw-catalogue and preserving-union results separately, and require explicit approval for retirements or remappings.

The known PTMT duplicate `186` is catalogued as `PTMT Taps / Urinal Spreader 15mm`; retain the `Accessorise` rows and remove the `Cocks Standard` rows. After canonicalization, 15 other PTMT code identities still span multiple categories and need separate review.

**Why:** Choosing a duplicate category by join convenience can apply the wrong buffer multiplier; the source catalogue category is the safer evidence for resolving a known duplicate.

**How to apply:** Resolve known duplicates explicitly before enabling catalogue-driven planning, and keep unresolved multi-category identities out of automatic roster migration.