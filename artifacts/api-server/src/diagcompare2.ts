import * as XLSX from "xlsx";
import * as fs from "fs";

const buf = fs.readFileSync("../../attached_assets/PTMT_Production_Plan_July_2026_1783339768945.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
const computed: any[] = JSON.parse(fs.readFileSync("/tmp/plan_full2.json", "utf8"));

const computedMap = new Map<string, any>();
for (const item of computed) computedMap.set(`${item.itemCode}||${item.colour}`, item);

const catSheets = ["Cocks Standard", "Cocks Premium", "Faucets & Jetsprays & Shower", "Accessorise", "Cistern & Seat Cover", "Cabinet", "Ball Cock"];

let totalRefRows = 0, totalMatched = 0;
const sampleMismatches: any[] = [];

for (const catName of catSheets) {
  const sheet = wb.Sheets[catName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const header = raw[3] as string[];
  const idx = (name: string) => header.indexOf(name);
  const iCode = idx("Item Code"), iColour = idx("Colour"), iAvg = idx("Avg 3-Mo\nSale"), iStock = idx("Stock"), iMin = idx("Min\nProduction"), iMax = idx("Production\nPlan");

  let catAvgRef=0, catAvgComp=0, catStockRef=0, catStockComp=0, catMinRef=0, catMinComp=0, catMaxRef=0, catMaxComp=0, catMatched=0, catRows=0;
  for (let i = 4; i < raw.length; i++) {
    const row = raw[i] as any[];
    if (!row || row[iCode] == null) continue;
    catRows++;
    const code = String(row[iCode]).trim();
    const colour = String(row[iColour] ?? "").trim();
    const refAvg = Number(row[iAvg]) || 0;
    const refStock = Number(row[iStock]) || 0;
    const refMin = Number(row[iMin]) || 0;
    const refMax = Number(row[iMax]) || 0;
    catAvgRef += refAvg; catStockRef += refStock; catMinRef += refMin; catMaxRef += refMax;
    const c = computedMap.get(`${code}||${colour}`);
    if (c) {
      catMatched++;
      catAvgComp += c.avg3MoSale; catStockComp += c.stock; catMinComp += c.minProduction; catMaxComp += c.maxProduction;
      if (sampleMismatches.length < 20 && Math.abs(c.stock - refStock) > 5) {
        sampleMismatches.push({cat:catName, code, colour, refStock, compStock: c.stock, refAvg, compAvg: c.avg3MoSale});
      }
    }
  }
  console.log(`${catName}: rows=${catRows} matched=${catMatched} | avgRef=${catAvgRef.toFixed(0)} avgComp=${catAvgComp.toFixed(0)} | stockRef=${catStockRef.toFixed(0)} stockComp=${catStockComp.toFixed(0)} | minRef=${catMinRef.toFixed(0)} minComp=${catMinComp.toFixed(0)} | maxRef=${catMaxRef.toFixed(0)} maxComp=${catMaxComp.toFixed(0)}`);
  totalRefRows += catRows; totalMatched += catMatched;
}
console.log("\ntotal", totalRefRows, totalMatched);
console.log(JSON.stringify(sampleMismatches, null, 1));
