---
name: Ingestion source selection & pull-summary semantics
description: How the Google-Sheets pull selects sources (full-history sales loads ALL fiscal-year workbooks) and how it counts added/updated/no-change.
---

# Source selection: load ALL applicable configs, not one-per-handler

`source_config` has multiple `sales` rows per division — one per fiscal-year
workbook (e.g. FY25-26 and FY26-27). The engine date-filters sales over windows
up to **12 months**, so it needs the FULL multi-year history. Therefore the pull
selects **every** config whose window applies (`applies_from <= pm <= applies_to`,
null = open), NOT a single best match.

**Why:** an earlier "pick exactly one by month+specificity" rule loaded only one
fiscal year, starving the engine's annual window. Loading both fiscal-year sales
workbooks together is the correct, intended behavior (the "fiscal-year file
rule" means *combine* the workbooks that overlap the trailing year, not choose
one).

**How to apply:** never narrow sales to a single workbook. If you add a new dated
source variant, encode its window in `applies_from/applies_to` and let
`selectConfigs()` include it when the window applies. Because a handler can now
have several source files, any per-source comparison (partial-drop, prev rows)
MUST be scoped by `sourceFileId`, never by `dataType` alone — otherwise one
workbook is compared against another and produces false "partial drop" findings.

# Pull-summary semantics

- **added vs updated:** the upsert RETURNs `(xmax = 0) AS inserted` — true only
  for rows newly inserted by that statement; updated rows have non-zero xmax.
  Tally per statement to fill `rows_added` / `rows_updated` exactly.
- **no-change:** if the batch content hash already exists for
  (division, dataType, planMonth, sourceFileId), do NOT insert a new batch and do
  NOT mutate the hash with a timestamp — return the existing batch marked
  no-change. The content hash must stay a faithful identity of the fetch.
- De-dupe mapped rows by business key before upsert, or `ON CONFLICT DO UPDATE`
  errors with "cannot affect row a second time".
