---
name: PTMT mapping business hold
description: Business-review hold for the proposed PTMT range mapping and its capacity impact.
---

The governed PTMT range mapping is now `CONNECTION → P.V.C. Connections` and `WASTE PIPE → Waste Pipes`, matching the August workbook's `DB RANGE`/report taxonomy. The current July last-month-pending capture contains 35 rate-list CONNECTION codes, but only six carry demand, totaling **63,230 pieces**: 321, 324, 325, 326, 323-K, and 324-K. The earlier 67,215 figure included seven Waste Pipe codes and is not the CONNECTION-only value.

MRP is authoritative when a row exists: code `324` resolves through MRP to `P.V.C. Connections` with `hold` status, while the rate-list path independently resolves the same code through `CONNECTION` to `P.V.C. Connections`. The current MRP July split reports 64,255 P.V.C. Connections pieces, 5,477 Accessorise pieces, and 1,895 Waste Pipes pieces; these categories remain held until their executable capacity treatment is approved.

**Why:** two competing classification paths can produce contradictory capacity utilization and category totals; the fallback must match the authoritative workbook taxonomy even while MRP/capacity approval remains pending.

**How to apply:** keep PTMT planning held; use MRP over rate-list fallback; use the dedicated categories for rate-list-only identities; and do not assign Waste Pipes a multiplier unless the source workbook explicitly provides one. Mapping must not alter raw July reconciliation quantities. Any end-to-end verification of the adopted PTMT multiplier policy is coupled to this hold: once MRP approval clears it, rebuild the plan and confirm the Cistern 1.20× exception and the 173,285-piece confirmed-demand floor.