import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

const sheets: Record<string, string> = {
  "Daily Production PTMT (master)": "1xxYYRdjrVcob3a_eIU7K4RRCzXkl50KMngJ5I8T7xuk",
  "PTMT ANUJ": "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw",
  "Order Sheet 26-27": "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A",
  "Sale 26-27": "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24",
  "SALE SHEET 26-27": "19LQGpkbZiecGaXdBvl48rPZT2LUz3sKekeKX5fHu7Ps",
  "CODE WISE SALE 25-26": "1kcPcre-iT7k6zH9RViqwajnhxQoppoUz2z46LdY29mg",
  "rate list": "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4",
};

async function inspectSheet(label: string, id: string) {
  console.log(`\n\n===== ${label} (${id}) =====`);
  try {
    const res = await connectors.proxy("google-sheet", `/v4/spreadsheets/${id}?fields=sheets.properties`, {
      method: "GET",
    });
    if (!res.ok) {
      console.log("ERROR fetching metadata:", res.status, await res.text());
      return;
    }
    const data = await res.json();
    const tabNames: string[] = data.sheets.map((s: any) => s.properties.title);
    console.log("Tabs:", JSON.stringify(tabNames));

    for (const tab of tabNames) {
      const range = encodeURIComponent(`${tab}!A1:T5`);
      const vres = await connectors.proxy(
        "google-sheet",
        `/v4/spreadsheets/${id}/values/${range}`,
        { method: "GET" }
      );
      if (!vres.ok) {
        console.log(`  [${tab}] ERROR:`, vres.status, await vres.text());
        continue;
      }
      const vdata = await vres.json();
      console.log(`  -- Tab "${tab}" --`);
      console.log("  ", JSON.stringify(vdata.values ?? []));
    }
  } catch (e) {
    console.log("EXCEPTION:", e);
  }
}

for (const [label, id] of Object.entries(sheets)) {
  await inspectSheet(label, id);
}
