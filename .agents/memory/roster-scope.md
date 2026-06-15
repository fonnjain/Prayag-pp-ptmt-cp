---
name: Plan roster = master catalogue, inner-joined
description: The plan covers the curated stock_opening catalogue, not every sold code; division-aware keying and the join semantics in gatherInputs.
---

# Plan roster scope (gatherInputs)

The production plan covers ONLY the curated master catalogue (~155 lines for
PTMT June 2026), NOT every code that has ever sold (~5,140). The catalogue is the
`stock_opening` row set, which is read from the master TOP ITEM / Sheet3 tab
(see interim-stock-import.md) and kept complete because blank qty cells are
mapped to 0 rather than rejected.

**Rule:** `gatherInputs` seeds its aggregate map from `stock_opening`, then
INNER-joins sales / pending / production / orders onto it. Rows whose key is not
in the roster are dropped. Do NOT seed the roster from `sales` — that was the
original "scope explosion" bug that inflated the plan ~4–6x with trading codes.

**Why:** the planner curates the catalogue in the master workbook; planning a
code that isn't in the catalogue is wrong by definition. Stock is the catalogue's
authoritative key set.

**How to apply / division-aware key:**
- PTMT keys `item_code||colour` (per item+colour).
- CP keys `item_code||` (colour collapsed to ''); multiple colours of one code
  accumulate with `+=` into a single line.
- The roster loader and every join use the same `rosterKey(itemCode, colour)`
  helper so keys line up.

**Operational consequence (sharp edge):** plan scope now depends on a stock pull
having loaded `stock_opening`. If stock is empty/stale for a division+month, the
plan shrinks toward empty. A normal pull loads stock, so this is fine in
practice, but an empty-roster guard in sanity would prevent accidental
empty-scope plans.

**Validation (PTMT June 2026, minmax 1.1/1.5):** 155 lines, stock sum 26,566,
pending_last 72,263, MIN total ≈ 551,036 (sheet 551,725, −0.12%), MAX ≈ 731,946
(sheet 732,638, −0.09%). Structural numbers are exact; the ~0.1% MIN/MAX residual
is near-constant across MIN and MAX (the non-multiplier −stock+pending terms) and
is hand-spreadsheet rounding, not a formula defect. CP June builds cleanly (791
lines) with the colour-collapse path; CP has no numeric target to validate.
