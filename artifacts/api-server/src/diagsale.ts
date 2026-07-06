import { SHEET_IDS, listTabs, throttledGetTabValues, priorThreeMonths } from "./lib/sheets";
async function main() {
  const tabs = await listTabs(SHEET_IDS.sale2627);
  console.log("Sale 26-27 tabs:", tabs);
  console.log("priorThreeMonths('2026-07'):", priorThreeMonths("2026-07"));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
