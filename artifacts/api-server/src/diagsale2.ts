import { SHEET_IDS, throttledGetTabValues } from "./lib/sheets";
async function main() {
  const values = await throttledGetTabValues(SHEET_IDS.sale2627, "Apr,May,Jun'26");
  console.log("total rows", values.length);
  console.log("header", values[0]);
  console.log(values.slice(1, 4));
  // sum for item 120-WS
  const header = values[0];
  const codeIdx = header.indexOf("Item Code");
  const colourIdx = header.findIndex(h => h === "COLOR" || h === "Color" || h === "Colour");
  const qtyIdx = header.findIndex(h => h === "Quantity" || h === "QTY");
  console.log("indices", codeIdx, colourIdx, qtyIdx);
  let sum = 0, count = 0;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[codeIdx]) continue;
    if (String(row[codeIdx]).trim().toUpperCase() === "120-WS" && String(row[colourIdx]).trim().toUpperCase() === "WHITE") {
      sum += Number(String(row[qtyIdx]).replace(/,/g,"")) || 0;
      count++;
    }
  }
  console.log("120-WS WHITE: rows=", count, "sum=", sum);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
