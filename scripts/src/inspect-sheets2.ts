import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const targets: Array<{ label: string; id: string; tabs?: string[] }> = [
  { label: "Sale 26-27", id: "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24" },
  { label: "SALE SHEET 26-27", id: "19LQGpkbZiecGaXdBvl48rPZT2LUz3sKekeKX5fHu7Ps" },
  { label: "CODE WISE SALE 25-26", id: "1kcPcre-iT7k6zH9RViqwajnhxQoppoUz2z46LdY29mg" },
  { label: "rate list", id: "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4" },
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
  const range = encodeURIComponent(`${tab}!A1:T4`);
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
  await sleep(2000);
  const tabs = await getMeta(t.id);
  console.log("Tabs:", JSON.stringify(tabs));
  for (const tab of tabs) {
    await sleep(1200);
    await getTab(t.id, tab);
  }
}
