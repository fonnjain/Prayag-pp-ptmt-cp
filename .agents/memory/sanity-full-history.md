---
name: Sanity-check semantics for full-history sources
description: Why the two-layer sanity check must not block on out-of-window / multi-workbook / optional-empty data, since the engine date-filters everything.
---

# The engine date-filters every time series

The planning engine filters sales/orders/production by date window itself. So
rows OUTSIDE a source's expected window are harmless noise — they are simply
ignored downstream. The only genuinely dangerous case is when **zero** rows fall
in-window (the fetch is unusable).

**Rule:** the deterministic `wrong_month`/out-of-window finding is a `blocker`
ONLY when `inWindow === 0`; otherwise it is a `warning`. The sales window is the
engine's widest read (**12 months**, not 3).

**Why:** sales is loaded as full multi-year history and PTMT production is a
full-history tab, so most rows are legitimately out of the plan-month window. A
`frac > 0.2 → blocker` rule false-blocked every real pull.

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

# Connector access gotchas

- Accept connection status `healthy`/`authorized` (not only connected/active/
  ready) in `google.ts`, or pulls are gated off a working connection.
- The connector proxy intermittently returns 429/5xx (or throws) when many ranges
  are read back-to-back after a large pull — wrap reads in retry/backoff.
