/**
 * Excel export for the Plan-vs-Actual report (task #134).
 *
 * Workbook layout:
 *   Sheet 1 – KPI / Context
 *   Sheet 2 – Categories (one section per category, week breakdown)
 *   Sheet 3 – Item Detail
 *   Sheet 4 – Invariants
 *   Sheet 5 – Out of Plan
 *
 * Uses lazy require(exceljs) per the existing convention in reports-plant-xlsx.ts.
 */

import type ExcelJS from "exceljs";
import type { PlanVsActualReport } from "./plan-vs-actual-engine";

// ── Colour palette (matches reports-plant-xlsx) ───────────────────────────────
const GREEN: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
const AMBER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
const RED: ExcelJS.Fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
const HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
const SUBHEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
const CATHEAD: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
const FAIL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
const PASS_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };

function remarkFill(remark: string | null): ExcelJS.Fill | undefined {
  if (remark === "OVER") return GREEN;
  if (remark === "ON TARGET") return GREEN;
  if (remark === "UNDER") return RED;
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

function weekHeader(report: PlanVsActualReport, index: number, metric: string): string {
  const week = report.weekCalendar[index];
  if (!week) return `W${index + 1} ${metric}`;
  return `${week.label} ${metric}`;
}

export async function generatePlanVsActualXlsx(report: PlanVsActualReport): Promise<Buffer> {
  // Keep ExcelJS lazy so production startup does not load the large workbook
  // package, while remaining compatible with the ESM development server.
  const { default: ExcelJS } = await import("exceljs");

  const wb = new ExcelJS.Workbook();
  wb.creator = "PTMT Production";
  wb.created = new Date();

  const subLine = `${report.month} · ${report.segment} · Generated: ${new Date().toLocaleString("en-GB")} · Lifecycle: ${report.lifecycle}`;
  const hasInvariantFailures = report.invariants.some((inv) => !inv.ok);

  // ── Sheet 1: KPI / Context ────────────────────────────────────────────────
  const wsKpi = wb.addWorksheet("KPI & Context");
  wsKpi.views = [{ state: "frozen", ySplit: 3 }];
  wsKpi.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1 };

  const titleSuffix = hasInvariantFailures ? " — INVARIANT FAILURES" : "";
  addTitleBlock(wsKpi, `Plan vs Actual — ${report.month} (${report.segment})${titleSuffix}`, subLine, 3);

  wsKpi.columns = [
    { key: "metric", width: 38 },
    { key: "value", width: 22 },
    { key: "notes", width: 35 },
  ];

  const hRow = wsKpi.addRow(["Metric", "Value", "Notes"]);
  setHeaderRow(hRow);

  const kpiRows: [string, number | string | null, string][] = [
    ["Segment", report.segment, ""],
    ["Month", report.month, ""],
    ["Lifecycle", report.lifecycle, "open / grace / closed / future"],
    ["Data Available", report.dataAvailable ? "Yes" : "No", ""],
    ["Unavailable Reason", report.unavailableReason ?? "–", ""],
    ["Plan Status", report.planStatus, report.planStatusReason ?? ""],
    ["Plan Evidence", String(report.planEvidence?.archiveCommit ?? "–"), "Archived reconstruction evidence"],
    ["Working Days", report.workingDays, report.workingDaysSource],
    ["Last Data Date", report.lastDataDate ?? "–", ""],
    ["Generated At", report.generatedAt, ""],
    ["", "", ""],
    ["── Plan Sources ──", "", ""],
    ["Plan Source", report.sources.plan, ""],
    ["Production Source", report.sources.production, ""],
    ["Orders Available", report.sources.orders.available ? "Yes" : "No", report.sources.orders.note],
    ["Sales Available", report.sources.sales.available ? "Yes" : "No", report.sources.sales.note],
    ["", "", ""],
    ["── KPIs ──", "", ""],
    ["Total Plan (pcs)", report.kpis.totalPlan, "Sum of all planned items"],
    ["Mapped Production (pcs)", report.kpis.mappedProduction, "Production matched to plan items"],
    ["Total Production (pcs)", report.kpis.totalProduction, "Mapped + unmapped"],
    ["Unmapped Production (pcs)", report.kpis.unmappedProduction, "Codes not in plan"],
    ["Order Qty", report.kpis.orderQty ?? "N/A", "null when source unavailable"],
    ["Sale Qty", report.kpis.saleQty ?? "N/A", "null when source unavailable"],
    ["Variance (pcs)", report.kpis.variance, "Mapped production − plan"],
    ["Achievement %", report.kpis.achievementPct ?? "N/A", "Mapped production / plan × 100"],
    ["Achievement Remark", report.kpis.achievementRemark ?? "N/A", "UNDER < 80% / ON TARGET 80–110% / OVER > 110%"],
    ["Planned Item Count", report.kpis.plannedItemCount, "Items with plan > 0"],
    ["Category Count", report.kpis.categoryCount, "Distinct categories in report"],
  ];

  for (const [metric, value, notes] of kpiRows) {
    if (metric === "") { wsKpi.addRow([]); continue; }
    if (metric.startsWith("──")) {
      const r = wsKpi.addRow([metric]);
      r.font = { bold: true, size: 9 };
      r.fill = SUBHEADER;
      ws_mergeIfNeeded(wsKpi, r.number, 1, r.number, 3);
      continue;
    }
    const r = wsKpi.addRow([metric, value, notes]);
    r.font = { size: 9 };
    if (metric === "Achievement Remark" && typeof value === "string" && ["UNDER", "ON TARGET", "OVER"].includes(value)) {
      const fill = remarkFill(value);
      if (fill) r.getCell(2).fill = fill;
    }
    if (metric === "Achievement %") {
      r.getCell(2).numFmt = "0.00";
    }
  }

  wsKpi.addRow([]);
  const pvHdr = wsKpi.addRow(["Plan Version", "Kind", "Source ID", "Effective From", "Effective To"]);
  pvHdr.font = { bold: true, size: 9 };
  pvHdr.fill = SUBHEADER;
  const pvCols = wsKpi.columns.length;
  if (report.planVersions.length === 0) {
    wsKpi.addRow(["No plan versions", "", "", "", ""]).font = { italic: true, size: 9 };
  } else {
    for (const pv of report.planVersions) {
      const r = wsKpi.addRow([pv.auditLabel, pv.kind, pv.sourceId, pv.effectiveFrom, pv.effectiveTo ?? "–"]);
      r.font = { size: 9 };
    }
  }

  // ── Sheet 2: Categories ───────────────────────────────────────────────────
  const wsCat = wb.addWorksheet("Categories");
  wsCat.views = [{ state: "frozen", ySplit: 4 }];
  wsCat.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1 };
  addTitleBlock(wsCat, `Categories — ${report.month} (${report.segment})`, subLine, 10);

  wsCat.columns = [
    { key: "category", width: 22 },
    { key: "items", width: 10 },
    { key: "plan", width: 13 },
    { key: "production", width: 13 },
    { key: "orders", width: 11 },
    { key: "sales", width: 11 },
    { key: "variance", width: 11 },
    { key: "achPct", width: 11 },
    { key: "remark", width: 14 },
    { key: "week1plan", width: 18 },
    { key: "week1production", width: 18 },
    { key: "week2plan", width: 18 },
    { key: "week2production", width: 18 },
    { key: "week3plan", width: 18 },
    { key: "week3production", width: 18 },
    { key: "week4plan", width: 20 },
    { key: "week4production", width: 20 },
  ];

  // Week header row
  const wkHdr1 = wsCat.addRow([
    "Category", "Items", "Plan", "Production", "Orders", "Sales", "Variance", "Ach %", "Remark",
    weekHeader(report, 0, "Plan"), weekHeader(report, 0, "Prod"),
    weekHeader(report, 1, "Plan"), weekHeader(report, 1, "Prod"),
    weekHeader(report, 2, "Plan"), weekHeader(report, 2, "Prod"),
    weekHeader(report, 3, "Plan"), weekHeader(report, 3, "Prod"),
  ]);
  setHeaderRow(wkHdr1);
  wkHdr1.getCell(1).alignment = { horizontal: "left" };

  for (const cat of report.categories) {
    const r = wsCat.addRow([
      cat.category, cat.itemCount, cat.plan, cat.production,
      cat.orders ?? "N/A", cat.sales ?? "N/A",
      cat.variance, cat.achievementPct ?? "N/A", cat.achievementRemark ?? "–",
      cat.weeks[0]!.plan, cat.weeks[0]!.production,
      cat.weeks[1]!.plan, cat.weeks[1]!.production,
      cat.weeks[2]!.plan, cat.weeks[2]!.production,
      cat.weeks[3]!.plan, cat.weeks[3]!.production,
    ]);
    r.font = { size: 9 };
    r.getCell(1).alignment = { horizontal: "left" };
    const fill = remarkFill(cat.achievementRemark);
    if (fill) {
      r.getCell(8).fill = fill;
      r.getCell(9).fill = fill;
    }
    if (cat.variance < 0) r.getCell(7).fill = RED;
    else if (cat.variance > 0) r.getCell(7).fill = GREEN;
  }

  // ── Sheet 3: Item Detail ──────────────────────────────────────────────────
  const wsItems = wb.addWorksheet("Item Detail");
  wsItems.views = [{ state: "frozen", ySplit: 4 }];
  wsItems.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1 };
  addTitleBlock(wsItems, `Item Detail — ${report.month} (${report.segment})`, subLine, 9);

  wsItems.columns = [
    { key: "category", width: 22 },
    { key: "itemCode", width: 16 },
    { key: "colour", width: 12 },
    { key: "plan", width: 12 },
    { key: "production", width: 12 },
    { key: "orders", width: 10 },
    { key: "sales", width: 10 },
    { key: "variance", width: 10 },
    { key: "achievementPct", width: 10 },
    { key: "remark", width: 14 },
    { key: "week1plan", width: 18 },
    { key: "week1production", width: 18 },
    { key: "week2plan", width: 18 },
    { key: "week2production", width: 18 },
    { key: "week3plan", width: 18 },
    { key: "week3production", width: 18 },
    { key: "week4plan", width: 20 },
    { key: "week4production", width: 20 },
  ];

  const itemHdr = wsItems.addRow([
    "Category", "Item Code", "Colour", "Plan", "Production", "Orders", "Sales", "Variance", "Ach %", "Remark",
    weekHeader(report, 0, "Plan"), weekHeader(report, 0, "Prod"),
    weekHeader(report, 1, "Plan"), weekHeader(report, 1, "Prod"),
    weekHeader(report, 2, "Plan"), weekHeader(report, 2, "Prod"),
    weekHeader(report, 3, "Plan"), weekHeader(report, 3, "Prod"),
  ]);
  setHeaderRow(itemHdr);
  itemHdr.eachCell((c) => { c.alignment = { horizontal: "left" }; });

  for (const cat of report.categories) {
    // Category separator row
    const catRow = wsItems.addRow([
      cat.category, "", "", cat.plan, cat.production,
      cat.orders ?? "N/A", cat.sales ?? "N/A", cat.variance,
      cat.achievementPct ?? "N/A", cat.achievementRemark ?? "–",
    ]);
    catRow.font = { bold: true, size: 9 };
    catRow.fill = CATHEAD;

    for (const item of cat.items) {
      const r = wsItems.addRow([
        "", item.itemCode, item.colour,
        item.plan, item.production,
        item.orders ?? "N/A", item.sales ?? "N/A",
        item.variance, item.achievementPct ?? "N/A", item.achievementRemark ?? "–",
        item.weeks[0]!.plan, item.weeks[0]!.production,
        item.weeks[1]!.plan, item.weeks[1]!.production,
        item.weeks[2]!.plan, item.weeks[2]!.production,
        item.weeks[3]!.plan, item.weeks[3]!.production,
      ]);
      r.font = { size: 9 };
      r.eachCell((c) => { c.alignment = { horizontal: "left" }; });
      const fill = remarkFill(item.achievementRemark);
      if (fill) {
        r.getCell(9).fill = fill;
        r.getCell(10).fill = fill;
      }
    }
  }
  wsItems.autoFilter = { from: "A4", to: "J4" };

  // ── Sheet 4: Invariants ───────────────────────────────────────────────────
  const wsInv = wb.addWorksheet("Invariants");
  wsInv.views = [{ state: "frozen", ySplit: 4 }];
  const invTitleSuffix = hasInvariantFailures ? " — FAILURES DETECTED" : " — ALL PASS";
  addTitleBlock(wsInv, `Invariants — ${report.month}${invTitleSuffix}`, subLine, 5);

  wsInv.columns = [
    { key: "code", width: 26 },
    { key: "status", width: 12 },
    { key: "expected", width: 14 },
    { key: "actual", width: 14 },
    { key: "detail", width: 60 },
  ];

  const invHdr = wsInv.addRow(["Code", "Status", "Expected", "Actual", "Detail"]);
  setHeaderRow(invHdr);

  for (const inv of report.invariants) {
    const r = wsInv.addRow([inv.code, inv.ok ? "PASS" : "FAIL", inv.expected, inv.actual, inv.detail]);
    r.font = { size: 9 };
    r.getCell(2).fill = inv.ok ? PASS_FILL : FAIL_FILL;
    r.getCell(2).font = { bold: true, size: 9, color: { argb: inv.ok ? "FF065F46" : "FF991B1B" } };
    r.getCell(5).alignment = { wrapText: true };
  }

  // ── Sheet 5: Out of Plan / Actuals ────────────────────────────────────────
  const oopTitle = report.planStatus === "actuals_only" ? "Actuals Only" : "Out of Plan";
  const wsOop = wb.addWorksheet(oopTitle);
  wsOop.views = [{ state: "frozen", ySplit: 4 }];
  addTitleBlock(wsOop, `${oopTitle} — ${report.month} (${report.segment})`, subLine, 6);

  wsOop.columns = [
    { key: "itemCode", width: 18 },
    { key: "colour", width: 14 },
    { key: "category", width: 22 },
    { key: "total", width: 14 },
    { key: "w1", width: 10 },
    { key: "w2", width: 10 },
    { key: "w3", width: 10 },
    { key: "w4", width: 10 },
  ];

  const oopHdr = wsOop.addRow(["Item Code", "Colour", "Category", "Total Prod", "W1", "W2", "W3", "W4"]);
  setHeaderRow(oopHdr);

  if (report.outOfPlan.length === 0) {
    const r = wsOop.addRow([report.planStatus === "actuals_only" ? "No frozen actual production rows" : "No out-of-plan production", "", "", "", "", "", "", ""]);
    r.font = { italic: true, size: 9 };
  } else {
    for (const oop of report.outOfPlan) {
      const r = wsOop.addRow([
        oop.itemCode, oop.colour, oop.category ?? "–", oop.totalProduction,
        oop.weeks[0] ?? 0, oop.weeks[1] ?? 0, oop.weeks[2] ?? 0, oop.weeks[3] ?? 0,
      ]);
      r.font = { size: 9 };
      r.eachCell((c) => { c.alignment = { horizontal: "left" }; });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// Helper: merge cells without throwing on single-column sheets
function ws_mergeIfNeeded(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  try {
    ws.mergeCells(r1, c1, r2, c2);
  } catch {
    // ignore merge errors on single-column sheets
  }
}
