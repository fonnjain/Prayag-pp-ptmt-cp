import { ReplitConnectors } from "@replit/connectors-sdk";

async function main() {
  const connectors = new ReplitConnectors();
  const fileId = "1xxYYRdjrVcob3a_eIU7K4RRCzXkl50KMngJ5I8T7xuk";
  const res = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`,
    { method: "GET" }
  );
  console.log("status:", res.status);
  console.log("body:", await res.text());
}

main();
