---
name: PTMT buffer multiplier locks
description: AI seasonality engine drifts PTMT category multipliers; how to detect, fix, and prevent.
---

The rule: PTMT business-specified multipliers must be set as `overrideMultiplier` in the DB.
Without an override, the AI recompute engine replaces `multiplier` with its AI-computed `suggestedMultiplier`.

**Correct business values (2026-07 reference):**
- Cocks Standard 1.5×, Cocks Premium 1.2×, Faucets & Jetsprays & Shower 1.5×
- Accessorise 1.5×, Cistern & Seat Cover 1.2×, Cabinet 1.2×, Ball Cock 1.5×

**How to lock:** `PATCH /api/buffer-categories/:id` with `{ "overrideMultiplier": N }`.
The recompute route reads `row?.overrideMultiplier` first and uses it as `appliedMultiplier`,
so an override survives any future AI recompute.

**Why it was masked:** PTMT_TOLERANCE was 0.05 (±5%), hiding a 4,552-piece drift (0.8%).
Fixed to PTMT_TOLERANCE=0.001 (±0.1%) in plumbing-golden.ts.

**Regression suite (76/76):** 56 Plumbing + 20 PTMT (6 guards + 14 per-category Max/Min).
Per-category golden values stored in PTMT_CATEGORY_GOLDEN in plumbing-golden.ts.
