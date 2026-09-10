---
name: Prayag export format
description: Plant-facing Temporary, Production, and corrective Excel exports share the reference workbook structure.
---

All plant-facing plan Excel downloads use the supplied Prayag workbook shape: Sheet12, P-DATA, Color summary, SUMMARY, TOP ITEM, GOVT., category tabs with row-7 headers and row-8 items, and REPORT tabs where PTMT applies. Frozen runs are the source of plan values; fields not persisted in the run stay blank or explicitly labelled rather than being rebuilt from live Sheets.

**Why:** The plant consumes one workbook convention across Temporary, fitted Production, and corrective/recompute outputs, while rebuilding missing source fields would break frozen-run auditability.

**How to apply:** Reuse the shared Prayag exporter for new plan downloads. Keep corrective-only audit columns in an additional detail sheet, not by changing the plant-facing category schema.