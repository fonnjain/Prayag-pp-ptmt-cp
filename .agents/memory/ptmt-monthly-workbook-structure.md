---
name: PTMT monthly workbook structure
description: External PTMT plan-and-actual workbook layout and adoption boundary.
---

The recurring plan-and-actual template uses `REPORT 1` through `REPORT 9` with row-4 item headers. `REPORT 1`–`7` are the governed planning categories; `REPORT 8` is Connection and `REPORT 9` is Waste Pipe. `REPORT 4` is a mixed accessory/helper view rather than a clean category source, and `CUSTOM!P:R` is the pending-last-month source (`DUMMY`).

**Why:** August 2026 reproduces the reported category values from these tabs, but the tabs do not cover the whole pending source and several report views mix series. The template shell is therefore useful for reconciliation, not proof of a complete taxonomy.

**How to apply:** Always reconcile `CUSTOM!R` to the union of report-tab item keys, preserve excluded quantities explicitly, and require every target month in the Jan–Jul comparison to be accessible before adopting a new PTMT classification or capacity basis.