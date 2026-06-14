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

# Deterministic cleanup of Claude's sanity reply (don't trust the prompt)

The spec mandates Node-side backstops over Claude's JSON, applied to Layer B
ONLY before merging with deterministic Layer A:
- normalize: demote full-history-worded `wrong_month`/`partial` to an info
  `full_history`; reclassify stray `empty` about stock/pending to no_stock/
  no_pending.
- dedupe Claude's output by TYPE only (keep more SEVERE finding; longer fix is
  only a tiebreaker at equal severity). Then merge with Layer A and run the
  cross-layer dedupe; recompute the verdict from the cleaned set.

Three traps the spec's literal code hits — guard against them:
1. Never merge two findings across DIFFERENT types just because they cite the
   same number ("0" collides no_stock/no_pending; "19" could collide
   missing_codes/outlier). Same-number merge is allowed only WITHIN a type.
2. Severity must dominate replacement — a longer `suggested_fix` must never let a
   lower-severity finding overwrite a higher-severity one (would hide a blocker).
3. Full-history demotion must require POSITIVE full-history wording AND the
   ABSENCE of a hard-failure signal (in_window_rows=0 / "nothing to plan" /
   "no rows inside"). Otherwise a real in-window-missing blocker silently
   becomes info. When in doubt, do NOT demote — a false alarm beats hidden bad data.

**Why:** these are the high-impact regressions an architect review caught in the
naive port of the spec's normalizeTypes/dedupeIssues.

# Connector access gotchas

- Accept connection status `healthy`/`authorized` (not only connected/active/
  ready) in `google.ts`, or pulls are gated off a working connection.
- The connector proxy intermittently returns 429/5xx (or throws) when many ranges
  are read back-to-back after a large pull — wrap reads in retry/backoff.
