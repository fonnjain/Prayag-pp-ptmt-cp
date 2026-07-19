---
name: Workbook ID configuration
description: DB-backed workbook ID management for PTMT and Plumbing daily-production workbooks.
---

**DB table:** `workbook_config` (migration 012_workbook_config.sql)
- Columns: `id TEXT PK`, `division TEXT`, `month TEXT`, `workbook_id TEXT`, `label TEXT`, `updated_at TIMESTAMPTZ`
- Schema: `lib/db/src/schema/workbook-config.ts` → `workbookConfigTable`

**API routes** (in `artifacts/api-server/src/routes/sheet-config.ts`):
- `GET /api/workbook-config` — returns all rows
- `PUT /api/workbook-config/:id` — upsert; invalidates in-memory cache
- `DELETE /api/workbook-config/:id` — removes row

**Lookup priority (in `sheets.ts`):**
1. DB (`loadWorkbookIdFromDb`) — 5-minute in-process cache (`_dbWorkbookCache`)
2. Drive discovery (Plumbing only, skipped if DB has an ID)
3. Hardcoded maps (`PTMT_DAILY_WORKBOOK_IDS`, `PLUMBING_DAILY_WORKBOOK_IDS`)

**Key function:** `getWorkbookIdForMonth(division, month)` — used by monitoring.ts
(PTMT) and sheets.ts `fetchPlumbingPlanData` (Plumbing). Call `invalidateWorkbookCache()`
after any save.

**UI:** `WorkbookConfigPanel` component on the Data page — shows fallback IDs as
placeholders, DB-configured rows as editable fields, + Add entry form.

**Why:** Hardcoded maps need updating each new month; user wanted a UI to set IDs
without code changes. DB entries override hardcoded so no restart is needed.
