import type ExcelJS from "exceljs";
import type { PlantBundle, CategoryKPIs, ItemKPIs, DayRecord } from "./plant-engine";
import type { PlantWarning } from "./plant-warnings";
import type { PlantRecommendation } from "./plant-recommendations";

type FullBundle = PlantBundle & { warnings: PlantWarning[]; recommendations: PlantRecommendation[] };

const GREEN: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
const AMBER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
const RED: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
const HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
const SUBHEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

function ragFill(band: string | null): ExcelJS.Fill | undefined {
  if (band === "green") return GREEN;
  if (band === "amber") return AMBER;
  if (band === "red") return RED;
  return undefined;
}

function setHeaderRow(row: ExcelJS.Row, fill = SUBHEADER) {
  row.font = { bold: true, size: 9 };
  row.fill = fill;
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  row.border = {
    bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
    top: { style: "thin", color: { argb: "FFCBD5E1" } },
  };
}

function addTitleBlock(ws: ExcelJS.Worksheet, title: string, sub: string, colSpan: number) {
  const t = ws.addRow([title]);
  t.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  t.getCell(1).fill = HEADER;
  ws.mergeCells(t.number, 1, t.number, colSpan);
  const s = ws.addRow([sub]);
  s.getCell(1).font = { italic: true, size: 8.5, color: { argb: "FF475569" } };
  ws.mergeCells(s.number, 1, s.number, colSpan);
  ws.addRow([]);
}

export async function generatePlantXlsx(bundle: FullBundle): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs") as typeof import("exceljs").default;
  const { plant, categories, items, dailySeries, variancePareto, warnings, recommendations, context } = bundle;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PTMT Production";
  wb.created = new Date();

  const monthLabel = context.month;
  const subLine = `${monthLabel} · WD ${context.elapsed}/${context.workingDays} · Snapshot: ${context.snapshotDate ?? "latest"} · Generated: ${new Date().toLocaleString("en-GB")}`;

  // ── 1. Plant KPIs ──────────────────────────────────────────────────────────
  const wsKpi = wb.addWorksheet("Plant KPIs");
  wsKpi.views = [{ state: "frozen", ySplit: 3 }];
  wsKpi.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1 };
  addTitleBlock(wsKpi, `PTMT Plant Manager Report — ${monthLabel}`, subLine, 3);

  wsKpi.columns = [
    { key: "metric", width: 38 },
    { key: "value", width: 20 },
    { key: "notes", width: 30 },
  ];
  const hRow = wsKpi.addRow(["Metric", "Value", "Notes"]);
  setHeaderRow(hRow);

  const kpiRows: [string, number | string | null, string][] = [
    ["Target Max (pcs)", plant.targetMax, "Production plan upper bound"],
    ["Target Min (pcs)", plant.targetMin, "Production plan lower bound"],
    ["Produced to Date (pcs)", plant.producedToDate, ""],
    ["Required Cumulative to Date (pcs)", plant.requiredCum, "At required pace"],
    ["Cum Attainment % (vs required today)", plant.attainmentCumPct, "Actual / required cumulative"],
    ["Month Attainment % (vs Max PP)", plant.attainmentMonthPct, "Produced / target max"],
    ["Required per Day (pcs)", plant.requiredPerDay, "Avg over full month"],
    ["Actual per Day (pcs)", plant.actualPerDay, "Avg to date"],
    ["Projected Month-End (pcs)", plant.projectedMonthEnd, "At current daily pace"],
    ["Projected Max PP Attainment %", plant.projectedAttainmentPct, ""],
    ["Projected Min PP Attainment %", plant.projectedMinAttainmentPct, ""],
    ["Days Ahead / Behind", plant.daysAheadBehind, "+ve = ahead"],
    ["Catch-Up per Day (pcs)", plant.catchUpPerDay, "Extra needed to hit Max PP"],
    ["Catch-Up vs Plan %", plant.catchUpVsPlanPct, ""],
    ["Linearity Index", plant.linearityIndex !== null ? +(plant.linearityIndex * 100).toFixed(1) : null, "100=perfectly linear"],
    ["RAG Band", plant.ragBand ?? "n/a", "green/amber/red"],
    ["Working Days Total", context.workingDays, ""],
    ["Working Days Elapsed", context.elapsed, ""],
    ["Working Days Remaining", context.remaining, ""],
    ["Shifts per Day", context.shiftsPerDay, ""],
    ["Shift Hours", context.shiftHours, ""],
  ];
  for (const [metric, value, notes] of kpiRows) {
    const r = wsKpi.addRow([metric, value, notes]);
    r.getCell(2).numFmt = typeof value === "number" ? "#,##0.##" : "@";
    r.font = { size: 9 };
  }

  // ── 2. Category KPIs ───────────────────────────────────────────────────────
  const wsCat = wb.addWorksheet("Category KPIs");
  wsCat.views = [{ state: "frozen", ySplit: 4 }];
  wsCat.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1 };
  addTitleBlock(wsCat, `Category KPIs — ${monthLabel}`, subLine, 12);

  wsCat.columns = [
    { key: "category", width: 22 },
    { key: "targetMax", width: 12 }, { key: "targetMin", width: 12 },
    { key: "produced", width: 12 }, { key: "gapPcs", width: 12 },
    { key: "cumAttPct", width: 12 }, { key: "projAttPct", width: 12 },
    { key: "reqPerDay", width: 12 }, { key: "actPerDay", width: 12 },
    { key: "daysAB", width: 10 }, { key: "catchUpPerDay", width: 14 },
    { key: "rag", width: 10 },
  ];
  const catHdr = wsCat.addRow(["Category", "Max PP", "Min PP", "Produced", "Gap (pcs)", "Cum Att %", "Proj End %", "Req/Day", "Act/Day", "Days ±", "Catch-Up/Day", "RAG"]);
  setHeaderRow(catHdr);
  catHdr.getCell(1).alignment = { horizontal: "left" };

  for (const c of categories as CategoryKPIs[]) {
    const r = wsCat.addRow([
      c.category, c.targetMax, c.targetMin, c.producedToDate, c.gapPcs,
      c.attainmentCumPct, c.projectedAttainmentPct,
      c.requiredPerDay, c.actualPerDay,
      c.daysAheadBehind, c.catchUpPerDay, c.ragBand ?? "n/a",
    ]);
    r.font = { size: 9 };
    r.getCell(1).alignment = { horizontal: "left" };
    const fill = ragFill(c.ragBand);
    if (fill) {
      r.getCell(6).fill = fill;
      r.getCell(7).fill = fill;
      r.getCell(12).fill = fill;
    }
    r.getCell(5).font = { bold: true, size: 9, color: { argb: c.gapPcs > 0 ? "FF991B1B" : "FF065F46" } };
    [6, 7].forEach((col) => { r.getCell(col).numFmt = "0.0%"; r.getCell(col).value = (r.getCell(col).value as number) / 100; });
  }

  // ── 3. Item Plan vs Actual ─────────────────────────────────────────────────
  const wsItems = wb.addWorksheet("Item Plan vs Actual");
  wsItems.views = [{ state: "frozen", ySplit: 4 }];
  wsItems.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1 };
  addTitleBlock(wsItems, `Item Plan vs Actual — ${monthLabel}`, subLine, 8);

  wsItems.columns = [
    { key: "itemCode", width: 16 }, { key: "colour", width: 14 },
    { key: "category", width: 20 }, { key: "targetMax", width: 12 },
    { key: "produced", width: 12 }, { key: "gapPcs", width: 12 },
    { key: "attPct", width: 12 }, { key: "zeroDays", width: 14 },
  ];
  const itemHdr = wsItems.addRow(["Item Code", "Colour", "Category", "Plan (Max)", "Produced", "Gap (pcs)", "Att %", "0-Day Streak"]);
  setHeaderRow(itemHdr);
  itemHdr.eachCell((c) => { c.alignment = { horizontal: "left" }; });

  const sortedItems = [...items as ItemKPIs[]].sort((a, b) => Math.max(b.gapPcs, 0) - Math.max(a.gapPcs, 0));
  for (const item of sortedItems) {
    const r = wsItems.addRow([
      item.itemCode, item.colour, item.category,
      item.targetMax, item.producedToDate, item.gapPcs,
      item.attainmentMonthPct !== null ? item.attainmentMonthPct / 100 : null,
      item.daysWithNoProduction,
    ]);
    r.font = { size: 9 };
    r.eachCell((c) => { c.alignment = { horizontal: "left" }; });
    if (item.gapPcs > 0) r.getCell(6).fill = RED;
    r.getCell(6).font = { bold: true, size: 9, color: { argb: item.gapPcs > 0 ? "FF991B1B" : "FF065F46" } };
    r.getCell(7).numFmt = "0.0%";
    if (item.daysWithNoProduction > 3) r.getCell(8).font = { bold: true, size: 9, color: { argb: "FF991B1B" } };
  }
  wsItems.autoFilter = { from: "A4", to: "H4" };

  // ── 4. Daily Series ────────────────────────────────────────────────────────
  const wsDaily = wb.addWorksheet("Daily Series");
  wsDaily.views = [{ state: "frozen", ySplit: 4 }];
  wsDaily.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1 };
  addTitleBlock(wsDaily, `Daily Series — ${monthLabel}`, subLine, 8);

  wsDaily.columns = [
    { key: "date", width: 14 }, { key: "wd", width: 8 },
    { key: "reqDay", width: 14 }, { key: "actDay", width: 14 },
    { key: "dailyAtt", width: 12 }, { key: "cumReq", width: 14 },
    { key: "cumAct", width: 14 }, { key: "cumAtt", width: 12 },
  ];
  const dailyHdr = wsDaily.addRow(["Date", "WD#", "Target/Day", "Actual (pcs)", "Daily Att %", "Cum Required", "Cum Actual", "Cum Att %"]);
  setHeaderRow(dailyHdr);

  for (const d of dailySeries as DayRecord[]) {
    const dailyAtt = d.requiredPerDay > 0 ? d.actualPcs / d.requiredPerDay : null;
    const cumAtt = d.cumulativeRequired > 0 ? d.cumulativeActual / d.cumulativeRequired : null;
    const r = wsDaily.addRow([
      d.date, d.workingDayNum, d.requiredPerDay, d.actualPcs,
      dailyAtt, d.cumulativeRequired, d.cumulativeActual, cumAtt,
    ]);
    r.font = { size: 9 };
    r.getCell(5).numFmt = "0.0%";
    r.getCell(8).numFmt = "0.0%";
    if (dailyAtt !== null && dailyAtt < 0.95) r.getCell(4).fill = RED;
    if (dailyAtt !== null && dailyAtt >= 1.0) r.getCell(4).fill = GREEN;
  }

  // ── 5. Warnings & Recommendations ─────────────────────────────────────────
  const wsWR = wb.addWorksheet("Warnings & Recs");
  wsWR.views = [{ state: "frozen", ySplit: 4 }];
  addTitleBlock(wsWR, `Warnings & Recommendations — ${monthLabel}`, subLine, 6);

  wsWR.columns = [
    { key: "a", width: 12 }, { key: "b", width: 18 }, { key: "c", width: 18 },
    { key: "d", width: 40 }, { key: "e", width: 12 }, { key: "f", width: 12 },
  ];
  const wHdr = wsWR.addRow(["Severity", "Code", "Scope", "Message", "Value", "Threshold"]);
  setHeaderRow(wHdr);

  for (const w of warnings as PlantWarning[]) {
    const r = wsWR.addRow([w.severity, w.code, w.scope, w.message, w.value ?? "–", w.threshold ?? "–"]);
    r.font = { size: 9 };
    const fill = w.severity === "critical" || w.severity === "high" ? RED : w.severity === "medium" ? AMBER : undefined;
    if (fill) r.getCell(1).fill = fill;
    r.getCell(4).alignment = { wrapText: true };
  }

  wsWR.addRow([]);
  const rHdr = wsWR.addRow(["Priority", "Code", "Scope", "Action", "Effort", "Quantified Impact"]);
  setHeaderRow(rHdr);
  for (const rec of recommendations as PlantRecommendation[]) {
    const r = wsWR.addRow([rec.priority, rec.code, rec.scope, rec.action, rec.effort, rec.quantifiedImpact]);
    r.font = { size: 9 };
    r.getCell(4).alignment = { wrapText: true };
    r.getCell(6).alignment = { wrapText: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
