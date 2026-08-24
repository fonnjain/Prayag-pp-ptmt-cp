---
name: Plumbing pending order segment values
description: Confirmed ERP Segment column values for Plumbing items in the DATA.xlsx PendingOrder sheet.
---

## Rule

Plumbing pending orders in the live `Pending order` → `report` sheet may use
the legacy values `PLUMBING`, `P`, `PL`, and `AGRI`, or the material-group
values `CPVC`, `UPVC`, and `SWR` used by the current report. All must be
included in the Plumbing filter.

```ts
// sheets.ts — confirmed filter
if (isPlumbing) {
  return new Set(["PLUMBING", "P", "PL", "AGRI", "CPVC", "UPVC", "SWR"]).has(seg);
}
```

## Segment breakdown (current live report observed 2026-08-24)

| Segment   | Count | Balance Qty | What it contains |
|-----------|------:|------------:|------------------|
| CPVC      |   172 |      96,370 | CPVC item group |
| UPVC      |    61 |      32,274 | UPVC item group |
| SWR       |   128 |      18,282 | SWR item group |
| AGRI      |    60 |       5,699 | AGRI item group |

(Segment "P" was not observed in this file but is kept for forward-compatibility.)

## PPR items under "PLUMBING"

PPR anti-freeze items (P20A03, PF43, PG43 series) appear with Segment = "PLUMBING".
These would only affect the plan if their item codes exist in `item_master`.
Since PPR items in the FG Stock file have category "PPR Fittimg" → `inferPlumbingCategory`
returns null → they are never inserted into `item_master` → their pending orders are
looked up but produce no match → effectively zero contribution. Safe to include all PLUMBING rows.

The four current material groups total **152,625** balance pcs.

## Embedded report header

The live report can include a second header row below the top-level headers. In
the observed layout, that row identifies the actual code column as `Old ERP
Code` under the top-level `Item Group` position, and the colour column as
`Color` under the top-level `Item Code` position. The top-level `Bal. Qty`
column remains the authoritative open-balance quantity; the embedded
`Quantity` label must not replace it.

**Why:** Reading the first row literally treats descriptions as item codes,
so the scalar pending total looks correct but none of the pending pieces join
the plan roster.

**How to apply:** Detect the embedded header before parsing report rows, expose
its code and colour positions under their logical aliases, skip that header
row, and continue to parse quantity from the top-level `Bal. Qty` column.

## Other ERP segment values (NOT Plumbing)

Seen in the same file: PTMT (349), TK (300), CP (127), GARDEN PIPE (46),
SANITARYWARE (39), SINK (30), PT (18), HARDWARE (10), WATER TANK (8), HDPE (1).
