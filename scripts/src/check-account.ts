import { ReplitConnectors } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const about = await connectors.proxy("google-sheet", "/drive/v3/about?fields=user", { method: "GET" });
console.log(about.status, await about.text());
