---
name: Plumbing upload structure
description: Global vs local upload split — DATA.xlsx is shared by both PTMT and Plumbing; each segment has its own local upload.
---

## Rule

DATA.xlsx (pending_orders kind) is a **global upload** — upload once, both segments use it.
The plan engine routes PendingOrder rows to PTMT or Plumbing based on the Segment column.

## Upload breakdown

| Upload kind           | Scope    | What it provides               |
|-----------------------|----------|-------------------------------|
| `pending_orders`      | GLOBAL   | Current pending for PTMT + Plumbing |
| `current_stock`       | PTMT     | Opening stock                  |
| `last_month_pending`  | PTMT     | Pending order from last month  |
| `plumbing_fg_stock`   | Plumbing | Stock (positive Net Stock) + pending-LM (negative Net Stock) |

## UI structure (data.tsx)

Two cards on the Data page:
1. **Global uploads — shared by all segments (1 required)** — always shows DATA.xlsx
2. **Local uploads — {segment} (N required)** — PTMT shows 2 files; Plumbing shows 1 file

Constants: `GLOBAL_UPLOAD_KINDS`, `PTMT_LOCAL_UPLOAD_KINDS`, `PLUMBING_LOCAL_UPLOAD_KINDS`.

**Why:**
DATA.xlsx previously appeared in both PTMT_UPLOAD_KINDS and PLUMBING_UPLOAD_KINDS, causing confusion about whether users needed to upload it twice. Separating it into a global card makes the "upload once" semantics explicit.
