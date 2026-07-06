import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("../attached_assets/PTMT_Production_Plan_July_2026_1783333521274.xlsx");

const cocks = wb.getWorksheet("Cocks Standard")!;
for (let r = 5; r <= 10; r++) {
  const row = cocks.getRow(r);
  const vals: unknown[] = [];
  const fills: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    vals[colNumber] = cell.value;
    const fill = cell.fill as any;
    fills[colNumber] = fill?.fgColor?.argb ?? "";
  });
  console.log(`Row ${r}:`, JSON.stringify(vals));
  console.log(`Fills ${r}:`, JSON.stringify(fills));
}

const summary = wb.getWorksheet("Summary")!;
for (let r = 4; r <= 12; r++) {
  const row = summary.getRow(r);
  const vals: unknown[] = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    vals[colNumber] = cell.value;
  });
  console.log(`SummaryRow ${r}:`, JSON.stringify(vals));
}

const legend = wb.getWorksheet("Legend")!;
for (let r = 1; r <= 13; r++) {
  const row = legend.getRow(r);
  const vals: unknown[] = [];
  const fills: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    vals[colNumber] = cell.value;
    const fill = cell.fill as any;
    fills[colNumber] = fill?.fgColor?.argb ?? "";
  });
  console.log(`LegendRow ${r}:`, JSON.stringify(vals), JSON.stringify(fills));
}
