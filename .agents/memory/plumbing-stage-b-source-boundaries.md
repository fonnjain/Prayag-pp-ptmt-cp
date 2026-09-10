---
name: Plumbing Stage B source boundaries
description: Plumbing plan stock lookup, period fallback, and SWR buffer provenance that must remain explicit during audits.
---

## Rules

- Plumbing plan stock and pending-last-month quantities are built from raw `plumbing_fg_stock` upload rows, then joined to the live workbook roster by normalized code; `item_master` is catalogue/upsert evidence, not the plan quantity source.
- New uploads must resolve a planning period from explicit input, workbook content, or filename; only legacy rows may retain timestamp-derived periods.
- Reviewed positive-stock exclusions are period-specific and fingerprinted; current baselines are July 101,988 pieces (upload #8) and August 110,462 pieces (upload #13), with reviewed ceilings of 115,000 and 125,000 respectively.
- The planner reads `LAST 3 MONTH AVG SALE` (or the average of three monthly columns) and recomputes Buffer Req from the selected multiplier; the workbook `BUFFER STOCK REQ` column is not authoritative.
- For SWR, the normal plan still uses the same average-times-multiplier formula as other materials; category suggested/DB multipliers take precedence over per-row workbook multipliers when present.

**Why:** A catalogue gap, timestamp-derived period, source-roster change, or source-side SWR buffer column can otherwise be mistaken for a planning formula or stock-lookup result.

**How to apply:** Separate upload-row presence, `item_master` presence, and workbook-roster presence in every Plumbing audit; report source vintage, exclusion fingerprint/ceiling, and the selected multiplier basis before comparing category totals.