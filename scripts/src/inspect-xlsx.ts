import ExcelJS from "exceljs";

const files = [
  "../attached_assets/DATA_1783333521270.xlsx",
  "../attached_assets/LAST_MONTH_PENDING_ORDERS_JUNE_2026_1783333521274.xlsx",
  "../attached_assets/PTMT_Production_Plan_July_2026_1783333521274.xlsx",
];

async function inspect(path: string) {
  console.log(`\n===== ${path} =====`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  for (const ws of wb.worksheets) {
    console.log(`\n-- Sheet: "${ws.name}" (rows=${ws.rowCount}, cols=${ws.columnCount}) --`);
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? "");
    });
    console.log("Headers:", JSON.stringify(headers));
    for (let r = 2; r <= Math.min(4, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const vals: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        vals[colNumber] = cell.value;
      });
      console.log(`Row ${r}:`, JSON.stringify(vals));
    }
  }
}

for (const f of files) {
  await inspect(f);
}
