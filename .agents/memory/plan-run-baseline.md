---
name: Immutable plan-run baseline for corrective replans
description: How corrective runs cite frozen plan runs, and the invariants that keep the citation auditable
---

The corrective engine accepts an optional `planRunId`. When set, the "original plan" baseline is rebuilt from the frozen `plan_run_results` + `plan_run_inputs` snapshot instead of a live `buildPlanItems` rebuild; week/w1–w4 are re-derived from the frozen plan numbers with the CURRENT weekly release bands (bands are config, not plan data). Frozen baselines have weightKg=0 (kg fields are Plumbing display aids only).

**Rules that must hold:**
- The replan-validate golden suite calls the engine directly WITHOUT `planRunId` → live baseline. Never make the engine auto-pick a frozen run; auto-resolution (latest finalized for month+segment) lives only in the POST /corrective/replan route.
- Explicit `planRunId` must be finalized and match month+segment → 400 otherwise. `planRunId: null` forces live rebuild.
- A plan run cited by any corrective run cannot be deleted (409) — deletion would erase the audit citation despite `ON DELETE SET NULL`.
- Drift and per-item comparisons must key by `itemCode::colour::category` — the same code+colour legitimately appears in multiple categories (dual-category roster pattern), so a two-part key silently collapses rows.

**Why:** management needs every corrective run to cite the immutable plan version it measured against, and a drift view of "as issued" vs "if re-run today" (GET /plan/runs/:id/drift).
