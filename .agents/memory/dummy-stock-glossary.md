---
name: Dummy stock glossary
description: Shared vocabulary for oversold stock carried into production planning.
---

`dummy stock`, `pending order last month`, `pendingOrderLastMonth`, and `DUMMY` are the same quantity: goods already sold beyond available stock and still owed for production.

**Why:** The business, application, and PLAN & ACTUAL labels use different names for one commitment; treating them as separate quantities risks double-counting or losing the debt.

**How to apply:** Use the segment-specific source to derive this one field, then include it once in the planning formula: `(Buffer Req − Stock) + Pending Order + Dummy Stock`.