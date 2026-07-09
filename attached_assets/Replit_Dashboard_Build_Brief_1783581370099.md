# Prayag India — Operations Dashboard: Replit Build Brief

Paste this into Replit's AI agent as the build spec. It describes an internal web dashboard with three sections — **Orders Received**, **Production Planning**, and **Sales** — that read live from Google Sheets. All sheet IDs and read rules are in the companion file **`dashboard_manifest.json`** (upload it into the Repl).

---

## 1. What to build

A single-page internal dashboard with a left nav and three sections plus an overview:

- **Overview** — headline KPIs across all three domains + a combined monthly trend (Orders vs Sales vs Production Plan).
- **Orders Received** — order intake by month, product group, channel, plant/state, and year-over-year.
- **Production Planning** — PTMT monthly production plan by the 7 categories, trend over time, and Orders-vs-Plan coverage.
- **Sales** — monthly sales value, sales by product, and Sales-vs-Orders-vs-Plan overlay.

Global controls: **fiscal-year selector** (FY2023-24 … FY2026-27) and a **month range**. A **festival & season overlay** toggle (Diwali/Holi markers, IMD seasons).

## 2. Recommended stack

- **Python + Streamlit** (fastest for a data dashboard on Replit). Charts via Plotly. Data via `pandas`.
- Data access: **Google service account + `gspread`** (keeps the sheets private — share each sheet with the service-account email). Put the service-account JSON in Replit **Secrets** as `GCP_SERVICE_ACCOUNT`.
- Quick-prototype alternative (no service account): publish each sheet and read the CSV endpoint
  `https://docs.google.com/spreadsheets/d/<FILE_ID>/gviz/tq?tqx=out:csv&sheet=<TAB_NAME>`.
- Cache every sheet read (`st.cache_data(ttl=3600)`); these sheets are large, so read once per hour.

## 3. Data sources (see `dashboard_manifest.json`)

### Orders Received — 4 Google Sheets
`manifest.orders.files` → Order Sheet 23-24 / 24-25 / 25-26 / 26-27.
- Read the **monthly tabs** (`Apr`…`Mar`), **not** `Combined` (that's only the current week).
- Fields: `manifest.orders.config.line_columns`. Value = **Taxable Value**, qty = **Quantity**.
- **Channel derivation:** if `STATE` or `STATE HEAD` contains `JJM/GEM/GOVT/PROJECT` → that channel, else **Retail**.
- These sheets IMPORTRANGE item rates from **`rate list`** (`1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4`); you don't need to read it separately.

### Production Planning — 68 PTMT "Daily Production" sheets
`manifest.production.months` (each has `id`, `year`, `month`, `era`, `pp_col`).
- **Production-Plan column moves by era** — use `pp_col` per month: `M` (2020), `O` (2021–24), `P` (2025–26).
- **Header row varies** (13 for 2020-22, 11 for 2023-24, 11–17 for 2025-26) — detect the header by finding the row containing "Item Code"/"REPORT".
- Read tabs **REPORT 1..REPORT 7** and map to the 7 categories in `manifest.production.config.report_tabs_to_categories`. Sum the PP column per report = category plan; sum of 1–7 = monthly PTMT plan.
- Columns: item code = `B`, colour = `G` (sometimes `I`), plan = the per-era `pp_col`.
- Note: this master is **PTMT only**. Other product lines have their own Daily Production files (add later).

### Sales — 44 files
`manifest.sales.files` (each has `id`, `category`, `fy`).
- For **trend/seasonality** use the **Sale Masters** (dated invoice lines): yearly (`Sale Master 2022-23`…`2026-27`) or the multi-year `3 YEAR SALE MASTER` (`1JpHX_hiRZ1l2QyyS3X3LbbsyqSLQ0oyIs3n9emnoH3s`).
- For quick monthly totals use the **`Sale & Pur PL Summary`** files.
- **Product-wise** sales come from the `SALE` tab of a multi-year Sale Master (that's how the seed FY2024-25 table was built).

## 4. Seed data (already computed — show instantly, compute the rest live)

Upload these into the Repl and load them for the default view; recompute live when the user changes filters:
- `Prayag_Order_Booking_Analysis_FY2026-27.xlsx` — FY26-27 orders by month/group/channel/plant.
- `Prayag_Sales_By_Product_Year.xlsx` — FY2024-25 product-wise monthly + annual sales.
- `PTMT_Production_Plans_History2.xlsx` — PTMT 7-category plan totals (Jun 2025, Mar/May/Jun/Jul 2026).

## 5. KPIs & charts per section

**Overview:** total order intake (₹ + qty), total sales (₹), total production plan (units) for the selected FY; combined monthly line chart Orders vs Sales vs Plan.

**Orders Received:**
- KPI cards: YTD order value, YTD qty, #documents, #customers.
- Monthly order value bar (₹ Cr) + qty.
- Order value by product GROUP (bar).
- Channel split (donut: Retail vs Govt/GeM/JJM/Project).
- Plant & top states (bar).
- Year-over-year: same-month order value across the 4 years (grouped bar).

**Production Planning:**
- Monthly PTMT plan (units) with the 7 categories stacked.
- Category-trend line over available months.
- **Orders vs Plan coverage:** for a chosen month, compare order qty vs planned qty per category (needs an order-GROUP → PTMT-category mapping; start with PTMT groups only).

**Sales:**
- Monthly sales value line.
- Sales by product (bar; FY24-25 seed, live for others).
- **Sales vs Orders vs Plan** overlay (monthly).

**Festival & Season overlay (config, not a sheet):**
- Diwali: 27 Oct 2019, 14 Nov 2020, 4 Nov 2021, 24 Oct 2022, 12 Nov 2023, 1 Nov 2024, 21 Oct 2025, **8 Nov 2026**.
- Holi: 21 Mar 2019, 10 Mar 2020, 18 Mar 2022, 8 Mar 2023, 25 Mar 2024, 14 Mar 2025.
- IMD seasons: Winter Dec–Feb, Summer/Pre-monsoon Mar–May, Monsoon Jun–Sep, Post-monsoon Oct–Nov.
- Draw festival vertical markers and shade seasons on the monthly charts.

## 6. Suggested file layout

```
main.py                # Streamlit entry + nav
data/loader.py         # read_sheet(id, tab) with caching; era-aware PTMT parser; channel deriver
data/manifest.py       # loads dashboard_manifest.json
sections/overview.py
sections/orders.py
sections/production.py
sections/sales.py
seed/                  # the 3 computed .xlsx files
dashboard_manifest.json
.streamlit/secrets.toml # or Replit Secrets: GCP_SERVICE_ACCOUNT
```

## 7. Build order for the agent

1. Scaffold Streamlit + nav + load `dashboard_manifest.json`.
2. Build `read_sheet()` (gspread with service account; fallback gviz CSV) with hourly cache.
3. **Orders** section first (data is cleanest) — monthly, group, channel, plant, YoY.
4. **Production** — era-aware PTMT parser (use `pp_col`, detect header, sum REPORT 1–7).
5. **Sales** — Sale Master monthly + product-wise.
6. **Overview** + Orders-vs-Sales-vs-Plan overlay + festival/season overlay.
7. Load the 3 seed files for instant default views.

## 8. Known gotchas (bake these in)

- Order Sheets: monthly tabs only (`Combined` = current week).
- PTMT plan column: **M → O → P by era**; header row varies — detect it.
- Sale Masters = daily lines (heavy — cache); P&L summaries = monthly totals.
- Values are ₹; show in ₹ Cr / Lakh. Fiscal year = April–March.
- Currency/number formatting: Indian grouping optional; keep totals in ₹ Cr for readability.
