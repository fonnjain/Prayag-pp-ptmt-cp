---
name: Corrective scheduler positive-piece boundary
description: Corrective Plumbing demand can remain fractional internally and become zero when converted to scheduler pieces.
---

## Rule
The machine scheduler accepts only strictly positive finite piece quantities.
Corrective calculations may retain fractional internal demand, but the
outbound scheduler payload floors to the integer piece boundary and excludes
rounded-zero rows with an audit record.

**Why:** A July AGRI Fitting item (`A-443`) had `remainingToProduce = 0.35`.
The payload used integer rounding and sent `qty_pcs = 0`, causing the machine
validator to reject the entire request. The row was a valid small positive
calculation before the boundary conversion.

**How to apply:** Keep fractional colour-level plan quantities intact. At the
corrective payload boundary, send only rows whose rounded quantity is at least
one, retain candidate/sent counts, and expose excluded item codes plus the
fractional quantity. Do not relax the scheduler validator.