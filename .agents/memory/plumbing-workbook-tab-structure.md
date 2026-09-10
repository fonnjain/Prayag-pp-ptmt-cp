---
name: Plumbing workbook tab structure
description: CPVC/SWR/UPVC/AGRI TOP ITEM tabs have no TYPE column and no section headers — all rows are plain item rows.
---

The July 2026 workbook pattern had tabs named "CPVC TOP ITEM", "SWR TOP ITEM",
"UPVC TOP ITEM", and "AGRI TOP ITEM". The live September 2026 workbook also
contains detailed "HDPE" and "HDPE TOP ITEM" tabs.

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

**Current source boundary:** The September HDPE tabs contain a real PIPE section
and item rows, but the application’s Plumbing material model and capacity table
still cover only CPVC, UPVC, SWR, and AGRI. No PPR, Water Tank, Silent, UGD,
Column Pipe, OPVC, or Tool planning tabs were present in that workbook.

**Why:** MRP series can identify real Prayag product families without proving
that Prayag plans them as independent categories. Treating tab presence as the
planning-category gate avoids creating unmakeable categories without capacity.

**How to apply:** Do not load MRP-only families into the executable roster until
Prayag confirms the tab/category model and a capacity basis exists. HDPE requires
its own reviewed category/capacity decision; no-tab families remain series
evidence rather than guessed mappings.
