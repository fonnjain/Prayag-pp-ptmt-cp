---
name: Dummy stock glossary
description: Shared vocabulary for oversold stock carried into production planning.
---

`dummy stock`, `pending order last month`, `pendingOrderLastMonth`, and `DUMMY` are the same quantity: goods already sold beyond available stock and still owed for production.

**Why:** The business, application, and PLAN & ACTUAL labels use different names for one commitment; treating them as separate quantities risks double-counting or losing the debt.

**How to apply:** Use the segment-specific source to derive this one field, then include it once in the planning formula: `(Buffer Req − Stock) + Pending Order + Dummy Stock`. For Plumbing, the source is the monthly FG Stock Excel upload's negative `Net Stock`; live workbook tabs and current-pending sources are not dummy-stock sources.

**Frozen-run rule:** A live Plumbing rebuild re-reads the FG upload, but a corrective run pinned to a finalized plan run carries `pendingLastMonth` from that run's frozen inputs instead of rereading the upload.

**Why:** Prayag's September source instruction makes the one-time Temporary Plan capture explicit; mixing live rebuild behavior with frozen corrective behavior would otherwise make "recompute" ambiguous.