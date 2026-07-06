import { ReplitConnectors } from "@replit/connectors-sdk";

async function main() {
  const connectors = new ReplitConnectors();
  const fileId = "1xxYYRdjrVcob3a_eIU7K4RRCzXkl50KMngJ5I8T7xuk";
  const res = await connectors.proxy(
    "google-drive",
    `/v4/spreadsheets/${fileId}?fields=sheets.properties`,
    { method: "GET" }
  );
  console.log("status:", res.status);
  console.log("body:", (await res.text()).slice(0, 500));
}

main();
