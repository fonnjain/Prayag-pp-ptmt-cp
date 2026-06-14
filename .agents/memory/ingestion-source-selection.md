---
name: Ingestion source selection & pull-summary semantics
description: How the Google-Sheets pull picks one source per handler (fiscal-year rule) and how it counts added/updated/no-change.
---

# Fiscal-year source selection (PTMT/CP production planning)

Two `sales` rows exist per division in `source_config`: an April-only fiscal file
(FY25-26, `applies_from`/`applies_to` both set = bounded window) and an
open-ended one (FY26-27, `applies_from` set, `applies_to` null). For an **April**
plan month BOTH windows match.

**Rule:** pick exactly one config per handler by (1) month applicability
(`applies_from <= pm <= applies_to`, null = open) then (2) **specificity** — a
fully-bounded window beats a half-open beats fully-open; tie-break on latest
`applies_from`.

**Why:** this resolves the April overlap to FY25-26 (bounded) and May/Jun to
FY26-27 (the only match) *without* hand-editing the seed. The spec rule is
"April uses Sale 25-26; May/Jun use Sale 26-27."

**How to apply:** never select ALL configs by division — always run them through
the month+specificity selector. If you add a new dated source variant, encode the
window in `applies_from/applies_to`; do not branch on month in code.

# Pull-summary semantics

- **added vs updated:** the upsert RETURNs `(xmax = 0) AS inserted` — true only
  for rows newly inserted by that statement; updated rows have non-zero xmax.
  Tally per statement to fill `rows_added` / `rows_updated` exactly.
- **no-change:** if the batch content hash already exists for
  (division, dataType, planMonth), do NOT insert a new batch and do NOT mutate
  the hash with a timestamp — return the existing batch marked no-change. The
  content hash must stay a faithful identity of the fetch.
- De-dupe mapped rows by business key before upsert, or `ON CONFLICT DO UPDATE`
  errors with "cannot affect row a second time".
