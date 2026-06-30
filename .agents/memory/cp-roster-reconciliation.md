---
name: CP Machine Roster Reconciliation
description: Architecture of the machine roster reconciliation feature for the CP Pipe & Fitting plant.
---

# CP Machine Roster Reconciliation

## Canonical machine keys

- **Pipe**: `PIPE-1` … `PIPE-9` (9 machines)
- **Moulding**: `MOULD-A01..A06`, `MOULD-B01..B06`, `MOULD-C01..C07`, `MOULD-D01..D07` (26 machines)
- **Not canonical**: `B07` appears in some data rows with 0 output — treat as unlisted.

## Source workbooks

`PIPE_DAILY_WORKBOOKS` in `roster.ts` maps `"YYYY-MM"` → Google Drive file ID (15 entries, Apr-2025 → Jun-2026). Aug-2025 is empty/awaiting.

## Report tab structure (parsed by roster-reconciliation.ts)

| Report | Tab name | What it holds |
|--------|----------|---------------|
| Report-5 | `"Report-5"` | Summary rows: pipe machines at rows ~5–14, moulding ~34–61. Read A1:H100. |
| Report-11 | `"Report-11"` | Transaction rows: col[3] = `"PIPE M/C - N"`, col[9] = weight KG. Read A1:Z2000. |
| Report-12 | `"Report-12"` | Transaction rows: col[4] = machine name (e.g. `"A02(U-150)"`), col[9] = weight KG. Read A1:Z3000. |

## DB table

`reconciliation_runs` — stores month (text "YYYY-MM"), status, pipeEmpty (bool), payload (jsonb), errorMsg, created_at.

## API

- `GET /data/reconciliation?month=YYYY-MM` → latest run or null
- `POST /data/reconciliation/run` (body: `{ month: "YYYY-MM" }`) → runs and returns result

## Frontend

`RosterPanel` component (`artifacts/production-planning/src/components/roster-panel.tsx`) is rendered in `data.tsx` **only when division === "CP"**. Uses `useGetReconciliation` + `useRunReconciliation` directly (not through data-provider context).

**Why:** The feature is strictly CP-specific; PTMT has no PIPE daily workbooks. Showing it for PTMT would confuse users.
