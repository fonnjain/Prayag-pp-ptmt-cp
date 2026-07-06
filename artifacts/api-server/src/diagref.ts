import * as XLSX from "xlsx";
import * as fs from "fs";
const buf = fs.readFileSync("../../attached_assets/PTMT_Production_Plan_July_2026_1783339768945.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
const sheet = wb.Sheets["Cocks Standard"];
const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
const header = raw[3] as string[];
console.log("header", header);
const iCode = header.indexOf("Item Code"), iColour = header.indexOf("Colour"), iAvg = header.indexOf("Avg 3-Mo\nSale");
for (let i=4;i<raw.length;i++){
  const row = raw[i] as any[];
  if (!row || row[iCode]==null) continue;
  if (String(row[iCode]).trim()==="120-WS") console.log(row);
}
