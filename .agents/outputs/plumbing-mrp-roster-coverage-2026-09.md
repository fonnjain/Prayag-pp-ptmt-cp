# September 2026 Plumbing MRP roster coverage delta

## Scope

- Planning-tab source: September 2026 Plumbing daily-production workbook (1,120 typed planning rows; 1,120 strict-normalized codes).
- MRP source: Prayag_MRP_Authoritative_01Sep2026_1788162915978.xlsx, division **Pipes & Fittings**, source id 1.
- Coverage join uses the existing strict production-code key (uppercase, removing hyphens, spaces, and dots). Raw source spellings remain in the detailed CSV/report rows.

## Full roster delta

| Bucket | Codes | Meaning |
|---|---:|---|
| In both | 1,105 | Code is present in the planning tabs and the MRP Pipes & Fittings division. Planning-tab material × type is authoritative. |
| MRP-only | 1,158 | Code is present in MRP Pipes & Fittings but absent from the current planning-tab roster. MRP series crosswalk is reported for review. |
| Roster-only | 15 | Code is present in the current planning tabs but absent from the MRP Pipes & Fittings division. |
| **Total** | **2,278** | Current planning roster ∪ MRP Pipes & Fittings. |

## The known 248-code gap

- **195 of 248** previously Unclassified codes are present in the authoritative MRP.
- In the current live September planning workbook, **5** of those MRP-covered codes are already in both sources; **190** remain MRP-only and are the actionable roster load.
- **53 of 248** are absent from the authoritative MRP and remain a Prayag master-data question.
- Under the strict-key coverage join, **190 of the 195 MRP-covered codes** are currently MRP-only and are candidates for the roster load.
- No CPVC/UPVC variance diagnosis was performed; the roster gap is addressed first as requested.

## Category precedence

1. Codes in both sources use the Prayag planning-tab material × type (`CPVC Fitting`, `UPVC Pipe`, `SWR`, etc.) as the effective planning category.
2. MRP series and division remain attached as identity evidence.
3. MRP-only rows are labeled with the direct MRP Pipes & Fittings series crosswalk for roster review; they are not yet consumed by the plan builder.
4. Roster-only codes stay visible and are not silently retired.

## Master-data escalation

The 53 absent codes are in .agents/outputs/plumbing-mrp-absent-53-2026-09.csv with current pending, dummy, stock, and draft-production context. They should be sent to Prayag for MRP/master-data resolution rather than inferred into a planning category.

## Outputs

- `plumbing-mrp-roster-coverage-2026-09.csv` — complete in-both / MRP-only / roster-only delta.
- `plumbing-mrp-absent-53-2026-09.csv` — the short Prayag escalation list.
- The API read endpoint is `/api/master-products/plumbing-roster-coverage?month=2026-09`.
