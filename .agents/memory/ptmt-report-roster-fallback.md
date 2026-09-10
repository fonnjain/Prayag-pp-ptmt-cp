---
name: PTMT report-roster fallback
description: Distinguishes the authoritative REPORT 1-9 roster from the legacy effective-roster recovery path during PTMT validation.
---

The PTMT effective roster must not be compared to REPORT 1-9 row-count targets when the REPORT 1-9 read failed. In that case the app falls back to item-master, rate-list, catalogue, and approved MRP identities; the resulting size difference is not a list of extra REPORT rows.

**Why:** A failed report-tab read can still produce a populated fallback roster, making source totals look inflated while hiding the missing authoritative comparison.

**How to apply:** Always report the report-read status and entry-path counts first. Only produce row-level “absent from REPORT 1-9” lists when the report rows were actually captured; otherwise label the comparison unavailable and do not infer demand, stock, or pending causality.