---
name: Plumbing machine cascade
description: Machine-capacity-constrained weekly release for Plumbing — pool structure, cascade rules, DB table, field names, and frontend quirks.
---

## DB table
`plumbing_machine_capacity` (migration 014) — UNIQUE(segment, machine_id).
Fields: id, segment, pool (PIPE|MOULDING), machine_id, label, shifts_per_day, hours_per_shift, working_days, rates JSONB, locked_out.
Seeded: 9 PIPE machines (MC1–MC9) + 24 MOULDING machines (A01–D07, B01–D07…).

## Cascade rules (machine-capacity-engine.ts → runMachineCascade)
- **PIPE**: sort items by dedicated-machine-only first (single material in rates), then flex; spillover W→W+1; W4 overflow → unfulfillable.
- **MOULDING**: sort by remaining available hours DESC per week; same spillover logic.
- **Solvent / no BOM weight**: unconstrained, pass-through (machineW* = same as weeklyW*).
- AGRI Pipe must only go to flex machines (MC3/MC4/MC5). MC1/MC2 = CPVC only, MC6 = UPVC only, MC9 = SWR only, MC7/MC8 = locked out.

## Integration point
In plan.ts: cascade runs AFTER `annotateWeeklyRelease`. Fields added to PlanItemWithBom:
- `machineW1`, `machineW2`, `machineW3`, `machineW4` (pieces per week, machine-feasible)
- `assignedMachineId` (string | null)
- `machineUnfulfillable` (boolean)

**Check**: `hasMachineData = items.some(i => i.machineW1 !== undefined)` — NOT `.machineWeek` (which doesn't exist).

## Routes
- `GET /api/capacity/machines?segment=Plumbing&month=YYYY-MM` → `{ machines, utilisation, unfulfillable }`
- `PUT /api/capacity/machines/:id` → body `{ shiftsPerDay?, hoursPerShift?, lockedOut? }`

## Frontend
- Monitoring: `/plumbing/machine-release` → `plumbing-machine-release.tsx` (new page)
- Planning Data page: `MachineCapacityPanel` gated on `segment === "Plumbing"`.
  **DataPage has no `month` prop** — the panel derives current month from `new Date()` directly.
- Data page needed `import { RefreshCw } from "lucide-react"` — there was no lucide import before.

## Validate endpoint checks (prefix "Machine ·")
Three checks added to Plumbing validate:
1. "Machine · cascade ran (machines seeded)" — bool
2. "Machine · cascade sum consistency" — machineW1+W2+W3+W4 = maxProduction for non-solvent, non-unfulfillable items
3. "Machine · AGRI Pipe only on flex machines (MC3/MC4/MC5)"

In verify-plumbing-plan.ts: filter `machineChks` by `c.name.startsWith("Machine ·")` and exclude from the `categories` catch-all.

**Why:** AGRI Pipe is too large-diameter for dedicated CPVC/UPVC/SWR machines; flex machines handle all materials.
