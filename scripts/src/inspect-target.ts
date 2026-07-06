import xlsxPkg from "xlsx";
const XLSX = xlsxPkg;
const wb = XLSX.readFile("../attached_assets/PTMT_Production_Plan_July_2026_1783333521274.xlsx");
console.log(wb.SheetNames);
for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  console.log(`--- ${name} (${json.length} rows) ---`);
  console.log(JSON.stringify(json.slice(0, 5)));
}
