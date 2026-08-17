import type ExcelJS from "exceljs";
import type { CalcPlanItem, PlanSummaryResult } from "./calc";

export const RED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } };
export const GREEN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
export const BLUE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFE2F3" } };

export const ITEM_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Item Code", key: "itemCode", width: 14 },
  { header: "Colour", key: "colour", width: 14 },
  { header: "Avg 3-Mo Sale", key: "avg3MoSale", width: 14 },
  { header: "Pending Order", key: "pendingOrder", width: 14 },
  { header: "Pending Last Mo", key: "pendingOrderLastMonth", width: 16 },
  { header: "Buffer Req", key: "bufferReq", width: 12 },
  { header: "Stock", key: "stock", width: 10 },
  { header: "Min Production", key: "minProduction", width: 14 },
  { header: "Production Plan", key: "maxProduction", width: 14 },
  { header: "Order", key: "order", width: 10 },
];

function addCategorySheet(workbook: ExcelJS.Workbook, category: string, items: CalcPlanItem[]): void {
  const sheet = workbook.addWorksheet(category.slice(0, 31));
  sheet.columns = ITEM_COLUMNS;
  sheet.getRow(1).font = { bold: true };

  // AGRI: header note explaining the intentional divergence from the source sheet.
  if (category.startsWith("AGRI")) {
    const noteRow = sheet.addRow(["AGRI is computed from the STOCK and BUFFER columns by header name; the source sheet's AGRI formula transposes these two, so AGRI figures intentionally differ from the source sheet."]);
    noteRow.font = { italic: true, color: { argb: "FF7F7F7F" } };
    noteRow.getCell(1).alignment = { wrapText: true };
  }

  for (const item of items) {
    const row = sheet.addRow({
      itemCode: item.itemCode,
      colour: item.colour,
      avg3MoSale: item.avg3MoSale,
      pendingOrder: item.pendingOrder,
      pendingOrderLastMonth: item.pendingOrderLastMonth,
      bufferReq: item.bufferReq,
      stock: item.stock,
      minProduction: item.minProduction,
      maxProduction: item.maxProduction,
      order: item.order,
    });

    const planCell = row.getCell("maxProduction");
    planCell.fill = item.maxProduction > 0 ? RED_FILL : GREEN_FILL;
    const minCell = row.getCell("minProduction");
    minCell.fill = item.minProduction > 0 ? RED_FILL : GREEN_FILL;
    const orderCell = row.getCell("order");
    if (item.order > 0) orderCell.fill = BLUE_FILL;
  }
}

function addSummarySheet(workbook: ExcelJS.Workbook, month: string, summary: PlanSummaryResult): void {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [
    { header: "Category", key: "category", width: 32 },
    { header: "Min Production Required", key: "minTotal", width: 22 },
    { header: "Max Production Required", key: "maxTotal", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  // spliceRows inserts a blank at position 1, shifting the auto-created column-header
  // row (Category / Min / Max) from row 1 → row 2, then we write the title into row 1.
  // Do NOT addRow(title) before this — that pattern creates a duplicate ghost row at row 3.
  sheet.spliceRows(1, 0, []);
  sheet.getRow(1).values = [`PTMT Production Plan — ${month}`];

  for (const cat of summary.categories) {
    sheet.addRow({ category: cat.category, minTotal: cat.minTotal, maxTotal: cat.maxTotal });
  }
  const totalRow = sheet.addRow({
    category: "TOTAL",
    minTotal: summary.grandMinTotal,
    maxTotal: summary.grandMaxTotal,
  });
  totalRow.font = { bold: true };
}

export function addLegendSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("Legend");
  sheet.columns = [{ header: "", width: 4 }, { header: "Meaning", width: 50 }];
  const rows: [string, ExcelJS.Fill | undefined][] = [
    ["Production Plan > 0 (must produce this month)", RED_FILL],
    ["Production Plan ≤ 0 (stock covers demand)", GREEN_FILL],
    ["Min Production > 0 (minimum to make)", RED_FILL],
    ["Order > 0 (live order backlog)", BLUE_FILL],
  ];
  rows.forEach(([label, fill], idx) => {
    const row = sheet.addRow(["", label]);
    if (fill) row.getCell(1).fill = fill;
    void idx;
  });
}

export async function exportPlanExcel(
  month: string,
  items: CalcPlanItem[],
  summary: PlanSummaryResult,
  requiredCategories?: string[],
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  addSummarySheet(workbook, month, summary);

  // Pre-seed with required categories so tabs always exist (e.g. SWR Solvent even when 0 pcs,
  // AGRI Solvent when all items are ≤ 0 under the swragri formula).
  const byCategory = new Map<string, CalcPlanItem[]>();
  if (requiredCategories) {
    for (const cat of requiredCategories) {
      byCategory.set(cat, []);
    }
  }
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  for (const [category, categoryItems] of byCategory) {
    addCategorySheet(workbook, category, categoryItems);
  }
  addLegendSheet(workbook);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
