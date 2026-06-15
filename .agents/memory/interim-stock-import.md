---
name: Interim stock import from master workbook
description: Why opening stock is read from the monthly master with FIXED column positions, and the absolute-index gotcha.
---

# Interim stock import (C1.1)

Opening stock is NOT in the upstream source files — the planner pastes it into
the monthly MASTER workbook. Until a dedicated stock sheet exists, stock is read
from the current month's master via a `stock` row in `source_config` whose
`file_id` is that master, routed through a dedicated fixed-position mapper
(not the header-alias `mapRows`), because the master tabs are headerless.

**Absolute-index gotcha (the thing to get right):** the pull loop reads each tab
as the WHOLE range `${tab}!A1:Z200000`, so the stock mapper's column indices are
ABSOLUTE A1 columns (A=0, B=1, … K=10, Q=16, S=18), NOT range-relative. The
spec's verified table gives ranges relative to a slice (`TOP ITEM!B4:K`,
`Sheet3!Q3:S`); do not copy those relative indices — translate to absolute.

Mappings (verified):
- PTMT: tab `TOP ITEM`, data from row 4 (idx 3): item_code=B(1), colour=C(2),
  qty=K(10). Keys item_code+colour.
- CP: tab `Sheet3`, data from row 3 (idx 2): item_code=Q(16), qty=S(18),
  colour='' (keys item_code only). NEVER read Sheet8 — that block is
  pending-last-month, not stock.
- `as_on` = first day of plan month. Upsert key (item_code,colour,as_on,division).
- Sanity sums (June 2026): PTMT ≈ 26,566; CP ≈ 42,381. A wildly different total
  means a wrong column/tab/index.

**Spec self-conflict:** the spec's illustrative Node snippet used a colour index
of 2 within a B-relative range (= col D), conflicting with the verified table's
"colour = col C". Trust the verified TABLE (colour=C), not the snippet.

**Monthly rotation:** the master changes each month. The TS seed uses
`onConflictDoNothing`, so swapping the master means EDITING the division's `stock`
row's file_id (via the Settings screen / source_config), not adding a new row.

**Retirement:** when a real opening-stock sheet/export arrives, point the `stock`
source_config row at it and retire the fixed-position mapper; `stock_opening`
and the engine do not change.
