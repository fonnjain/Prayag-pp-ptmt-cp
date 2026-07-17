---
name: Plumbing pending order segment values
description: Confirmed ERP Segment column values for Plumbing items in the DATA.xlsx PendingOrder sheet.
---

## Rule

Plumbing pending orders in `PendingOrder` sheet use **four** distinct Segment values.
All four must be included in the Plumbing filter in `plan.ts`.

```ts
// plan.ts — confirmed correct filter
if (isPlumbing) return seg === "PLUMBING" || seg === "P" || seg === "PL" || seg === "AGRI";
```

## Segment breakdown (June 2026 file)

| Segment   | Count | Balance Qty | What it contains |
|-----------|------:|------------:|------------------|
| PLUMBING  |    43 |       6,809 | PPR anti-freeze items + SWR fittings (5111, 5711) + CPVC/UPVC fittings + misc |
| PL        |     7 |         935 | SWR Selfit pipes (PW93S, PW13S) + SWR Selfit fittings (5741S, 5941S, 5141S) + UPVC SCH40 pipes (PU-11S, PU-13S) |
| AGRI      |     2 |         200 | AGRI Pipe (A-26C 63mm, A-27C 75mm) |

(Segment "P" was not observed in this file but is kept for forward-compatibility.)

## PPR items under "PLUMBING"

PPR anti-freeze items (P20A03, PF43, PG43 series) appear with Segment = "PLUMBING".
These would only affect the plan if their item codes exist in `item_master`.
Since PPR items in the FG Stock file have category "PPR Fittimg" → `inferPlumbingCategory`
returns null → they are never inserted into `item_master` → their pending orders are
looked up but produce no match → effectively zero contribution. Safe to include all PLUMBING rows.

## Other ERP segment values (NOT Plumbing)

Seen in the same file: PTMT (349), TK (300), CP (127), GARDEN PIPE (46),
SANITARYWARE (39), SINK (30), PT (18), HARDWARE (10), WATER TANK (8), HDPE (1).
