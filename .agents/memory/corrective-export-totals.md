---
name: Corrective export header/table total consistency
description: Why the "Revised Month Total" header in corrective Excel exports must be computed from items, not from the stored DB field.
---

# Corrective export header/table total consistency

## The rule
In `buildCorrectiveStandardExcel` and `buildCorrectiveDetailExcel`, compute "Revised Month Total" as `items.reduce((s, i) => s + Math.round(i.planRev), 0)` — the same rounding path the table loop uses — NOT from `run.revisedMonthTotal`.

**Why:** `corrective_plan_runs.revised_month_total` is stored as `real` (32-bit float). Summing floats then rounding once (engine's path) diverges from summing `Math.round` per item (export table's path). For a 3,636-item PTMT plan the gap was 54 pcs; for a 1,120-item Plumbing plan it was 99 pcs.

**How to apply:** At the start of each export function, pre-compute:
```typescript
const grandMaxComputed = items.reduce((s, i) => s + Math.round(i.planRev), 0);
const grandMinComputed = items.reduce((s, i) => s + Math.round(i.originalPlan), 0);
```
Use `grandMaxComputed` wherever the summary header shows "Revised Month Total" and `grandMinComputed` for "Original Month Total". The `run.revisedMonthTotal` field is only for storage/API responses, never for display arithmetic.
