---
name: Sanity-check semantics for full-history sources
description: Why the two-layer sanity check must not block on out-of-window / multi-workbook / optional-empty data, since the engine date-filters everything.
---

# The engine date-filters every time series — judge completeness IN-WINDOW

The planning engine filters sales/orders/production by date window itself. So
rows OUTSIDE a source's expected window are harmless noise — simply ignored
downstream. **Never flag completeness on whole-file counts; judge on in-window
figures only.** Out-of-window rows alone are NOT an error (do not even warn on
them); whole-file stats are context-only.

**Rule (both layers):**
- `wrong_month` is a `blocker` ONLY when `inWindowRows === 0` for a windowed
  source (the engine has nothing to plan on). Out-of-window rows existing while
  in-window rows are present → no finding at all.
- `partial` / `missing_codes` compare **in-window** counts vs the previous
  accepted pull's in-window footprint (`prevInWindowRows`/`prevInWindowDistinct`),
  NOT whole-file counts. These prev-in-window figures are computed pre-upsert and
  only for single-source windowed handlers (null for multi-file sales, so the
  two-workbook span never trips a false drop).
- negatives are judged on `inWindowNegQty` (warning, type `outlier` — could be
  returns/credits).

**Why:** sales is loaded as full multi-year history and production is a
full-history tab, so most rows are legitimately out of the plan-month window.
Whole-file or `frac`-based rules false-blocked/false-warned every real pull.
SourceDiag carries both whole-file AND in-window stats for exactly this reason —
use the in-window ones for any completeness judgment.

# Multiple workbooks per handler are expected

Sales spans multiple fiscal-year workbooks. Both the deterministic prev-pull
comparison (scope by `sourceFileId`) and the AI layer's system prompt must treat
"two `sales` sources with different file_ids/date-ranges" as NORMAL, not a
duplicate or partial-drop error.

# Optional sources can be empty

`pending` and `stock` are optional: empty `pending` → `info` (demand excludes
pending), empty `stock` → `warning` (assume zero opening stock). Only the core
series (sales/orders/production/items) block when empty.

# Other expected warnings (do not escalate to blockers)

- `amount != qty x rate`: usually tax-inclusive amounts or rounding → warning.
- distinct-code drop across the two sales workbooks (table-total `prevDistinct`
  conflates files) → noisy warning, not a blocker.

**How to apply:** a clean live pull should land on verdict `warn` (not `block`);
the user then acknowledges (`/data/acknowledge`) before `/plan/build`. If you see
`block` from out-of-window / multi-workbook / optional-empty, the sanity logic
regressed — re-check the rules above before "fixing" the data.

# Finding type taxonomy + singleton de-dup

Allowed finding types: empty | partial | wrong_month | wrong_file |
shifted_column | missing_codes | outlier | no_stock | no_pending. There is NO
`unit_mismatch` type — negatives/amount anomalies are `outlier`.

- `empty` is ONLY for a core source that returned 0 rows (failed/blank fetch).
- An absent opening-stock snapshot is `no_stock` (warning), absent pending is
  `no_pending` (info) — NEVER `empty`. Both layers must use these types.
- `no_stock` / `no_pending` are whole-division SINGLETONS: at most one each per
  scope. Both Layer A (aggregate + per-source) and Layer B can surface them, so
  `dedupeFindings` collapses them by type alone (Layer A wording wins, it's
  merged first); all other types de-dup by exact severity+type+message.

**Why:** the spec's TYPE-SELECTION rule forbids double-classifying the same
fact (e.g. a `no_stock` and an `empty` both citing stock=0). Exact-message
de-dup can't catch cross-type/cross-layer repeats, hence the type-level collapse.

# Connector access gotchas

- Accept connection status `healthy`/`authorized` (not only connected/active/
  ready) in `google.ts`, or pulls are gated off a working connection.
- The connector proxy intermittently returns 429/5xx (or throws) when many ranges
  are read back-to-back after a large pull — wrap reads in retry/backoff.
