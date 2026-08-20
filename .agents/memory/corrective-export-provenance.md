---
name: Corrective export provenance
description: Exports/PDFs must reuse the run's persisted engine categories; capacity fallback ladder; fingerprint must cover persisted export inputs.
---

# Corrective export provenance

**Rule:** Excel/PDF exports for a corrective run must render the run's PERSISTED engine results (`categoriesJson`, `workingDaysRemaining`) — never re-derive Cap/Day from the `category_capacity` DB table (Plumbing suggested capacities there are 0 → the Cap/Day=0 / 100%-shortfall regression).

**Capacity ladder (Plumbing):** override → p90 when ≥5 distinct production days → mean of observed days when 1–4 → 0 only with truly no production. Surfaced as `capacityMethod` + `capacityDays`; `ZERO_CAP_WITH_PRODUCTION` is a critical warning invariant.

**Why:** August 2026 export showed Cap/Day=0 for all 12 categories and shortfall = 100% of remaining despite 205k pcs produced, because the export path silently used a different capacity source than the engine.

**How to apply:**
- Any new field consumed by an export must be persisted on the run AND included in the dedupe fingerprint payload (adding it only to the function signature does nothing — the payload lists fields explicitly). Otherwise dedupe reuses an old run with stale/null JSON.
- `frozenPlanGrandMax` (migration 022, INTEGER) is Σ plan_run_results.productionPlan for the cited planRunId, captured at run-creation time. The Detail Excel "Baseline Plan Run" row compares this against grandOrigComputed (item-level Math.round sum) with ±200 tolerance. The old comparison (run.originalMonthTotal vs grandOrigComputed) was permanently triggered because both come from the same item snapshot — see LOGIC_PTMT §A4.
- `frozenPlanGrandMax` must NOT join the dedupe fingerprint — it describes the frozen plan run (invariant for a given planRunId), not the corrective content.
- Sheet3 date parsing: ANY production row (code + qty>0) with an unparseable date is a hard error, never a silent skip.
- Drive workbook resolution must iterate ALL title-matching candidates and validate material tabs — "PLUMBING DAILY PURCHASE <MON>" matches the pattern but has no material tabs.
- Regression checks NC15a/b/c guard this; NC15c only applies while workingDaysRemaining > 0 (month-over shortfall legitimately equals remaining).
