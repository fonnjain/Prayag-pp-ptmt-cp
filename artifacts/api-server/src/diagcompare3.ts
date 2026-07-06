import * as XLSX from "xlsx";
import * as fs from "fs";

const buf = fs.readFileSync("../../attached_assets/PTMT_Production_Plan_July_2026_1783339768945.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });

const catSheets = ["Cocks Standard", "Cocks Premium", "Faucets & Jetsprays & Shower", "Accessorise", "Cistern & Seat Cover", "Cabinet", "Ball Cock"];
let grandMin = 0, grandMax = 0;
for (const catName of catSheets) {
  const sheet = wb.Sheets[catName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const header = raw[3] as string[];
  const idx = (name: string) => header.indexOf(name);
  const iCode = idx("Item Code"), iMin = idx("Min\nProduction"), iMax = idx("Production\nPlan");
  let minSum = 0, maxSum = 0;
  for (let i = 4; i < raw.length; i++) {
    const row = raw[i] as any[];
    if (!row || row[iCode] == null) continue;
    const refMin = Math.max(Number(row[iMin]) || 0, 0);
    const refMax = Math.max(Number(row[iMax]) || 0, 0);
    minSum += refMin; maxSum += refMax;
  }
  console.log(`${catName}: minSum(clamped)=${minSum.toFixed(0)} maxSum(clamped)=${maxSum.toFixed(0)}`);
  grandMin += minSum; grandMax += maxSum;
}
console.log("GRAND clamped min/max:", grandMin.toFixed(0), grandMax.toFixed(0));
