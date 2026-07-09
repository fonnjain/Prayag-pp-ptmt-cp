# Prayag India — Operations Dashboard: Replit Build Brief (v2, consolidated)

Paste this into Replit's AI agent. It is the complete, current spec. Hand over **three files**:

1. **`dashboard_seed.json`** — pre-computed numbers, so the dashboard shows real figures instantly.
2. **`dashboard_manifest.json`** — the live data map: every Google Sheet ID + which tab/column to read + the parsing rules. Needed for refresh/recompute.
3. **This brief** — what to build and how the numbers are defined.

The primary feature is a **stock-buffer-multiplier engine** that *suggests* a multiplier per product category and lets the user *override* it. Everything else supports that.

---

## 1. What to build

An internal web dashboard, left-nav, four areas:

- **Overview** — headline KPIs + a combined Orders-vs-Plan-vs-Sales trend.
- **Orders Received** — 4-year order intake: by month, product group, channel, plant/state, YoY.
- **Production Planning** — PTMT plan trend (6 years), by category, and Orders-vs-Plan.
- **Stock Buffer** — the suggest→override multiplier engine per category (the core feature).
- **Sales** — sales trend + Sales-vs-Orders-vs-Plan.

Global controls: fiscal-year selector (FY2023-24 … 2026-27), month range, and a festival/season overlay toggle.

## 2. Stack & data access

- **Python + Streamlit + Plotly + pandas** (fastest on Replit).
- Live reads: **gspread with a Google service account** (share each sheet with the service-account email; store its JSON in Replit **Secrets** as `GCP_SERVICE_ACCOUNT`). Keeps sheets private.
- Quick-prototype fallback (no service account): `https://docs.google.com/spreadsheets/d/<FILE_ID>/gviz/tq?tqx=out:csv&sheet=<TAB>`.
- Cache every sheet read: `@st.cache_data(ttl=3600)`.
- **Load seed on startup so the app is never blank; recompute live when filters change or the user clicks Refresh.**

## 3. The two JSON files

### `dashboard_seed.json` (pre-computed; wire straight to the UI)
- `orders.year_value_cr` — {FY: ₹ Cr}. `orders.seasonal_index_total` — {month: index}. `orders.channel_cr` — {FY: {Retail,Govt,Project,GeM,JJM}}.
- `stock_buffer.service_level_z` (1.65) and `stock_buffer.categories[]` — each has: `category`, `avg_month_units`, `seasonal_index{12 months}`, `cv`, `vol_class`, `safety_multiplier`, `yoy`, `trend_signal`, `planning_growth`, `peak_month`. **This is the buffer engine's seed output — 15 categories.**
- `production_ptmt.fy_plan_units` — {FY: units}. `production_ptmt.category_fy` — {FY: {7 categories}}.
- `sales_ptmt.fy_qty` — {FY: units}.
- `combined_ptmt_qty` — `orders`, `plan`, `sales` each {FY: units}.

### `dashboard_manifest.json` (live source map)
- `orders.files[]` (4 Order Sheets w/ id, fy) and `orders.config` (monthly tabs, `line_columns`, `value_field`=Taxable Value, `channel_rule`, "use monthly tabs not Combined").
- `production.months[]` (68 PTMT files w/ id, year, month, `era`, `pp_col`) and `production.config` (era→column M/O/P, header-row detection, REPORT→category map).
- `sales.files[]` (44 files w/ id, category, fy).

## 4. STOCK BUFFER ENGINE (primary feature — build this carefully)

**Goal:** for every category, *suggest* a data-driven buffer multiplier so the user doesn't guess, but let them override per category.

**How the suggestion is computed** (already in the seed; recompute live from orders the same way):
1. Basis = last 2 completed fiscal years (FY2024-25, FY2025-26), **recency-weighted: latest year ×2**. (FY2023-24 is intentionally excluded — older, non-comparable layout.)
2. `seasonal_index[m]` = weighted avg of month m ÷ category's weighted avg month (1.00 = average month).
3. `cv` = volatility of demand **after removing seasonality** (std/mean of deseasonalised monthly values). `vol_class`: Low <0.15, Medium 0.15–0.30, High >0.30.
4. **Suggested multiplier** = `1 + z × cv`, where `z` is the service level (global input: 1.65=95%, 2.05=98%, 1.28=90%).
5. `yoy` = FY25-26 vs FY24-25 annual qty → `trend_signal` (Growing >+8%, Declining <−8%, else Stable). `planning_growth` = `clamp(0.5 × yoy, −20%, +25%)`.

**The suggest → override → applied UI (must implement exactly):**
- Show a table, one row per category, with columns: Suggested ×, **Override ×** (editable input, blank by default), Applied ×.
- `applied = override if the user set one, else suggested`. **All downstream math uses `applied`.**
- Clearing the override reverts to the suggestion. Persist overrides (e.g., a small JSON/table keyed by category) so they survive refresh, but never overwrite the suggestion itself.
- Changing global `z` re-computes every Suggested × (and Applied × for non-overridden rows) live.

**Derived outputs (per category):**
- **Month multiplier[m]** = `seasonal_index[m] × applied` → the cover to hold each month (e.g., build ahead of the March peak). Show as a heatmap (green=build up, red=trim).
- **Next-year monthly target (units)** = `avg_month_units × (1 + planning_growth) × seasonal_index[m] × applied`.
- Show `vol_class`, `trend_signal`, `peak_month` as badges.

## 5. Other sections (definitions)

**Orders Received** (from `orders.files`, monthly tabs):
- Value = SUM(Taxable Value), qty = SUM(Quantity), grouped by month / GROUP / channel / plant.
- **Channel rule:** if STATE or STATE HEAD contains JJM/GEM/GOVT/PROJECT → that channel, else Retail.
- YoY = same-month value across FY23-24…26-27. (Note: FY26-27 is partial — Apr–Jul; label it.)

**Production Planning** (from `production.months`, PTMT only):
- For each REPORT 1–7 tab: detect the header row (the row containing "ITEM CODE"), find the column whose header contains "PRODUCTION PL", read the **TOTAL row's** value in that column = that category's plan. Sum REPORT 1–7 = monthly PTMT plan.
- **The plan figure is a produce-to-buffer snapshot** — aggregate to FY/category level; do NOT present single-month plan as committed output.
- REPORT→category: 1 Cocks Standard, 2 Cocks Premium, 3 Faucets & Jetsprays, 4 Accessorise, 5 Cistern & Seat Cover, 6 Cabinet, 7 Ball Cock.

**Sales** (from `sales.files`): Sale Masters = dated invoice lines (use for trend); P&L summaries = monthly totals. PTMT sales seed is in `sales_ptmt.fy_qty`.

**Combined (Overview):** plot `combined_ptmt_qty.orders / plan / sales` by FY. Headline insight to surface: **sales rising, orders flat, plans cut to ~half of sales → PTMT planning lags demand.**

**Festival & season overlay (static config, not a sheet):**
- Diwali: 2019-10-27, 2020-11-14, 2021-11-04, 2022-10-24, 2023-11-12, 2024-11-01, 2025-10-21, **2026-11-08**.
- Holi: 2019-03-21, 2020-03-10, 2022-03-18, 2023-03-08, 2024-03-25, 2025-03-14.
- IMD seasons: Winter Dec–Feb, Summer/Pre-monsoon Mar–May, Monsoon Jun–Sep, Post-monsoon Oct–Nov.
- Draw festival markers + season shading on monthly charts.

## 6. Build order

1. Scaffold Streamlit + nav; load both JSONs; render seed views (instant, no live calls yet).
2. `read_sheet(id, tab)` (gspread + service account; gviz fallback) with hourly cache.
3. **Stock Buffer** section with the suggest/override/applied table + month heatmap + next-year targets (recompute live from Orders using the §4 formulas).
4. Orders section (monthly/group/channel/plant/YoY).
5. Production (era-aware parser: `pp_col`, header detection, REPORT 1–7 TOTAL row).
6. Sales + Overview combined trend + festival/season overlay.

## 7. Gotchas (bake in)

- Order Sheets: **monthly tabs only** ("Combined" = current week; "--report" pivots can be broken).
- Production plan column moves **M→O→P by era**; header row varies (11–17) — detect it; plan values can be negative (overstock) → use the sheet's TOTAL row, not a raw sum.
- Buffer volatility rests on **2 clean years** — it tightens as new years are appended; recompute `cv`/`yoy` when a fiscal year completes.
- Values are ₹; show ₹ Cr / Lakh. Fiscal year = April–March.
- Scope caveat: "PTMT" is defined slightly differently across orders / production / sales, so the combined chart is a **trend comparison, not an exact unit reconciliation**.
- Production data is **PTMT only**; other lines (CP, CPVC, SWR, UPVC, Sink, Tank, Garden Pipe) have separate Daily-Production files to add later.
