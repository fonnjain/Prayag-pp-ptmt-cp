---
name: Sheet tab name normalisation
description: Order sheet tabs use full month names ("July") not 3-letter abbreviations ("Jul"); fix with buildTabMap().
---

## Rule
`FISCAL_MONTHS = ["Apr","May","Jun","Jul",...]` uses 3-letter abbreviations.
Some Google Sheet workbooks use full names: "July", "June", "January", etc.
A strict `tabs.includes("Jul")` check silently misses "July", yielding 0 data for that month.

## Fix
`buildTabMap(tabs: string[]): Map<FiscalMonth, string>` in `seasonality-engine.ts`:
- Calls `normTab(tab)` which checks exact match first, then falls back to `MONTH_ALIASES`
- `MONTH_ALIASES` maps all full month names → FiscalMonth abbreviation
- Returns a map from canonical FiscalMonth → actual tab name in the sheet

Usage:
```typescript
const tabMap = buildTabMap(tabs);
const monthlyTabs = FISCAL_MONTHS.filter((m) => tabMap.has(m));
for (const tab of monthlyTabs) {
  const actualTab = tabMap.get(tab) ?? tab;
  const values = await getTabValues(sheetId, actualTab, "A1:Z50000");
}
```

**Why:** The FY26-27 order sheet uses "July" — confirmed in logs `tabs:["WT-LTR","Apr","May","Jun","July"]`.
Without this fix, Jul data is always 0, inflating CV calculations and giving wrong seasonal indices.

**How to apply:** Any time `listTabs()` results are matched against FISCAL_MONTHS, use `buildTabMap()` instead of raw `tabs.includes()`.
