# Prayag planning export

Generated 2026-08-26T05:35:48.094Z. Metadata refreshed 2026-08-26T05:54:57.906Z. Requested coverage is 2025-04-01 through 2026-08-31, covering FY 2025-26 and FY 2026-27.

## Provenance
- Workspace source SHA: c7908ff9f39d21cd4c69513afcbdaa10187b084f
- GitHub origin/main at refresh: 5956d390bb9eda6e21d60a7f7adda32a49cfcb77 (the CP source-gate documentation update only)
- Deployed commit SHA: e347c3633dc049f31c9c215de1b273751d510ba5, verified from https://prayag-pp.com/api/healthz
- Export database: heliumdb on helium (development/export database)
- Deployed database host: ep-orange-tree-aj9n6w8a.c-3.us-east-2.aws.neon.tech
- schema.sql is a public-schema pg_dump containing CREATE TABLE definitions, constraints, indexes, and sequences.
- manifest.json lists every archive file, logical row count, query/source, date range where applicable, and known gaps.

## Export rules applied
- CSV files are UTF-8 with headers; database tables are unfiltered and unaggregated.
- Item-level rows, including zero/blank values returned by the source, were retained.
- Source-sheet CSVs include source_tab and source_row. Stored JSON rows retain raw_json where flattening was needed.
- Sensitive auth/key table data was not exported because it was not requested; table definitions remain in schema.sql.
- No code changes, production writes, migrations, or publish operations were performed for this export.

## Known gaps and data-quality issues
- **June 2026:** PTMT and Plumbing are frozen as actuals-only; the plan reconstruction was attempted and rejected, so no finalized plan exists for that month.
- **Early August 2026 onward:** pending current reads as zero after the worksheet rename PendingOrder → PO. The August plan inputs show pending_current=0 while pending_last_month remains populated.
- **Pre-d0a7c9a months:** Sunday production was discarded from monitoring; the known impact is 80,522 pcs across four fixtures.
- **July 2026 PTMT snapshot:** it captured workingDays=25 even though 28 working days were observed.
- CP is not included: its planning source contract is intentionally not implemented.
- The application pending-order reader has an A1:X50000 cap. This export read A1:ZZ500000 and records raw/exported counts in pending_source_profile.json, making any under-read visible.
- The 2026-27 order workbook includes a full \"July\" tab; exact source tab names are preserved.
- PTMT ANUJ Production is a mixed production/rejection worksheet with headers such as \"Cat no\", \"Prodction Qty\", and \"Rejction Qty\". Production is in actuals_daily.csv and rejection is in actuals_daily_rejections.csv.
- The Pending order report has a secondary label row after its data header; that non-data row is excluded, while all data columns are retained.
- FY25-26 sales uses transaction-level Sheet1 from CODE WISE SALE 25-26. FY26-27 sales uses the transaction-level SALE SHEET 26-27 monthly tabs because the Sale 26-27 codewise tabs did not expose raw line rows through the connector.
- The current plan history contains draft and finalized statuses; these were not filtered. Frozen-month and upload status summaries are in manifest.json.
- Plan runs without matching rows in plan_run_input_snapshots.csv are explicitly **reproducible-but-not-source-auditable**: the export retains the flattened plan inputs/results, but does not invent missing raw source snapshots. The API exposes the same per-run label through pendingAuditability.
- Machine API data is available from April 2026 onward. Missing FY2025-26 machine records are documented rather than zero-filled.
- No item_weights rows currently exist. The separate Plumbing kg file therefore contains machine-level PIPE kg records from the plant API only.
- Historical source-file shape changes, source tabs, and missing Plumbing months are recorded in source_workbook_inventory.json and plumbing_actuals_source_profile.json.

## Contents
The core files are plan_runs.csv, plan_run_results.csv, plan_run_inputs.csv, plan_run_input_snapshots.csv, corrective_runs.csv, corrective_run_items.csv, actuals_daily.csv, actuals_daily_plumbing_kg.csv, buffer_categories.csv, category_capacity.csv, plant_configs.csv, item_master.csv, item_weights.csv, weekly_release_bands.csv, plumbing_machine_capacity.csv, plant_month_snapshots.csv, orders_fy2526.csv, orders_fy2627.csv, pending_orders_snapshot.csv, sales_fy2526.csv, sales_fy2627.csv, stock_snapshots.csv, and machine_daily.csv. Extra raw/audit files are listed in the manifest.
