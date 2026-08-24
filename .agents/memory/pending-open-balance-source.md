---
name: Pending open-balance source
description: The business meaning and source distinction for current pending-order quantities.
---

**Rule:** Current pending demand means the unfulfilled/open balance (`Bal. Qty`). Never substitute invoice `Quantity`; a source that has only invoice quantity must remain an explicit structural zero with diagnostics.

**Why:** The pending-order source exposes separate `So Qty`, `Inv. Qty`, and `Bal. Qty` fields. Treating invoice quantity as pending would overstate open demand and make plan/corrective results look valid while using the wrong business measure.

**How to apply:** Accept the confirmed `Bal. Qty` header variants and compatible code headers such as `Item Code`; preserve segment and colour joins. Keep invoice-register layouts visible in diagnostics rather than silently aggregating `Quantity`.