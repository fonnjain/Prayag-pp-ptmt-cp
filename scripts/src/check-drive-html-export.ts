import { ReplitConnectors } from "@replit/connectors-sdk";

async function main() {
  const connectors = new ReplitConnectors();
  const fileId = "1xxYYRdjrVcob3a_eIU7K4RRCzXkl50KMngJ5I8T7xuk";
  const res = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent("text/html")}`,
    { method: "GET" }
  );
  console.log("status:", res.status);
  const text = await res.text();
  console.log("length:", text.length);
  if (res.status !== 200) console.log(text.slice(0, 500));
}

main();
