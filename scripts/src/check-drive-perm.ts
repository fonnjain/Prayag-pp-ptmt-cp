import { ReplitConnectors } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();

const fileId = "1xxYYRdjrVcob3a_eIU7K4RRCzXkl50KMngJ5I8T7xuk";

try {
  const aboutRes = await connectors.proxy("google-drive", "/drive/v3/about?fields=user", { method: "GET" });
  console.log("about:", aboutRes.status, await aboutRes.text());
} catch (e) {
  console.log("about failed", e);
}

try {
  const fileRes = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}?fields=id,name,owners,permissions,shared`, { method: "GET" });
  console.log("file:", fileRes.status, await fileRes.text());
} catch (e) {
  console.log("file failed", e);
}
