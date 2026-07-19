---
name: Plumbing workbook tab structure
description: CPVC/SWR/UPVC/AGRI TOP ITEM tabs have no TYPE column and no section headers — all rows are plain item rows.
---

The Plumbing daily-production workbook (July 2026 onward) has tabs named
"CPVC TOP ITEM", "SWR TOP ITEM", "UPVC TOP ITEM", "AGRI TOP ITEM".

**Rule:** these tabs have NO TYPE column and NO section-header rows. All items
are listed sequentially with only a serial number. The parser must NOT skip
rows just because `currentSectionType` is null.

**Fix applied:** `fetchPlumbingPlanData` pushes rows with `type: null` when
no type info is present. `PlumbingPlanRow.type` is `"Pipe"|"Fitting"|"Solvent"|null`.

**Type resolution in the plan engine (`buildPlumbingPlanItemsFromWorkbook`):**
1. Check FG stock upload Category column: "CPVC-PIPE"→Pipe, "CPVC-FG"→Fitting,
   "*-TRADING"→Solvent.
2. MATERIAL_TYPE_DEFAULT fallback: CPVC/SWR→Fitting, UPVC/AGRI→Pipe.

**Why:** The workbook was reformatted at some point removing type/section info.
Parser must be tolerant of missing type — resolve it from FG stock instead.

**How to apply:** Any future parser changes must keep `type: null` rows in the
output; never add `if (!type) continue` guards in `fetchPlumbingPlanData`.
