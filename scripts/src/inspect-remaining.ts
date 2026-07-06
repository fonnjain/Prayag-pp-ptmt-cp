import { ReplitConnectors } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const targets: Array<{ label: string; id: string }> = [
  { label: "PTMT ANUJ", id: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw" },
  { label: "Order Sheet 26-27", id: "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A" },
];

async function getMeta(id: string) {
  const res = await connectors.proxy("google-sheet", `/v4/spreadsheets/${id}?fields=sheets.properties`, { method: "GET" });
  if (!res.ok) {
    console.log("META ERROR:", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return data.sheets.map((s: any) => s.properties.title);
}

async function getTab(id: string, tab: string) {
  const range = encodeURIComponent(`${tab}!A1:T5`);
  const res = await connectors.proxy("google-sheet", `/v4/spreadsheets/${id}/values/${range}`, { method: "GET" });
  if (!res.ok) {
    console.log(`  [${tab}] ERROR:`, res.status);
    return;
  }
  const data = await res.json();
  console.log(`  -- Tab "${tab}" --`);
  console.log("  ", JSON.stringify(data.values ?? []));
}

for (const t of targets) {
  console.log(`\n\n===== ${t.label} (${t.id}) =====`);
  await sleep(1500);
  const tabs = await getMeta(t.id);
  console.log("Tabs:", JSON.stringify(tabs));
  for (const tab of tabs) {
    await sleep(1200);
    await getTab(t.id, tab);
  }
}
