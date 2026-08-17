---
name: Corrective empty-baseline guard
description: POST /corrective/replan returns 422 EMPTY_BASELINE when a live rebuild yields zero items and zero categories.
---

## Rule
`POST /corrective/replan` checks after computing the result: if `baselinePlanRunId === null` AND `categories.length === 0` AND `items.length === 0`, it returns HTTP 422 with `{ error: "EMPTY_BASELINE", message: "...", segment, month, baselinePlanRunId: null, baselineSource }`.

**Why:** A live rebuild with zero items looks identical to a legitimate plan — it returns HTTP 200 with an empty categories array. Without the guard, callers would display a "plan of zeros" without any indication that the upstream data is missing. The named error forces the caller to handle the missing-baseline case explicitly.

**How to apply:** The guard is in `routes/corrective.ts`, immediately after `runCorrectiveReplan()` returns. It only fires on `baselinePlanRunId === null` (live rebuild) — a frozen-run corrective with zero items is not blocked (though that would itself be a data integrity issue caught by other guards).

Covered by regression check NC21d.
