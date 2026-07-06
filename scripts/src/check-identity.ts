import { ReplitConnectors } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const res = await connectors.proxy("google-sheet", "/v4/spreadsheets/1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw?fields=sheets.properties", { method: "GET" });
console.log("sheets ok?", res.ok);

// Try drive 'about' via a generic proxy path (may 404 since connector is google-sheet specific)
try {
  const res2 = await connectors.proxy("google-sheet", "/../drive/v3/about?fields=user", { method: "GET" });
  console.log(res2.status, await res2.text());
} catch (e) {
  console.log("about failed", e);
}
