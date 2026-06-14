---
name: Data-gating scope (division-level, not month)
description: Why nav/route gating and "is there data?" checks must be division-scoped, and how plan-month relates to a pull.
---

# Data availability is division-level, not plan-month-level

The UI gates Plan/Reports/Settings/Legacy behind "has data been pulled?" and the
sequence is Data → Plan → Reports (Dashboard always open). That gate MUST check
whether the **division** has any pulled data (`useGetBatches({ division })`),
NOT the selected plan month.

**Why:** a data pull loads full multi-year history into the DB and the planning
engine date-filters per month downstream. So once a division is pulled, every
month is plannable — the engine just re-runs. Gating on the month-scoped batch
row wrongly re-locks the app and forces a pointless re-pull whenever the user
switches months (the user explicitly rejected that behavior).

**How to apply:**
- Keep month-scoped `importBatches` only for the Data page's "latest sync batch"
  display; use the division-scoped query for any lock/redirect decision.
- `import_batches` rows are written per (division, plan_month) at pull time, but
  the raw data tables (sales/orders/etc.) are division-wide history — don't
  conflate "no batch row for this month" with "no data".
- After a pull, invalidate both the month-scoped and division-scoped
  `getBatches` keys so the gate updates immediately.
