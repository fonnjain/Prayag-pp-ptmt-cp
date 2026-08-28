---
name: Demand versus executable plan basis
description: Durable rule for separating owed plan demand from machine-feasible production across APIs, monitoring, exports, and UI.
---

Issued demand and executable fitted production are different business quantities. Demand is the frozen owed/issued quantity used for attainment and owed views. Executable production is the machine-feasible quantity used for production monitoring and run execution. Temporary plans are demand-only until a production run is scheduled.

**Why:** Capacity fitting, scheduler gaps, and explicit Solvent states make a single generic “plan total” ambiguous and can make monitoring or attainment appear incorrect even when the underlying plan is right.

**How to apply:** Persist and expose both quantities where available, keep the legacy max/production aliases only for compatibility, and put the basis (`demand`, `executable`, or an explicit not-scheduled state) next to every total, target, export column, and user-facing label.