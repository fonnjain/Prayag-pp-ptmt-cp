import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const CONNECTOR = "google-sheet";

export interface GoogleStatus {
  connected: boolean;
  message: string;
}

export async function googleStatus(): Promise<GoogleStatus> {
  try {
    const conns = await connectors.listConnections({
      connector_names: CONNECTOR,
      refresh_policy: "auto",
    });
    if (!conns || conns.length === 0) {
      return {
        connected: false,
        message: "Google Sheets connection not found. Authorize it in the workspace integrations panel.",
      };
    }
    const status = (conns[0]!.status || "").toLowerCase();
    const ok = status === "connected" || status === "active" || status === "ready";
    return {
      connected: ok,
      message: ok
        ? "Google Sheets connected"
        : `Google Sheets connection status: ${conns[0]!.status || "unknown"}. Authorize it to enable data pulls.`,
    };
  } catch (err) {
    return {
      connected: false,
      message: `Google Sheets connectivity error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface ValueRange {
  range?: string;
  majorDimension?: string;
  values?: string[][];
}

// Read a single A1 range from a spreadsheet via the Replit Google connector proxy.
export async function readRange(
  fileId: string,
  range: string,
): Promise<string[][]> {
  const resp = await connectors.proxy(
    CONNECTOR,
    `/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Google Sheets read failed (${resp.status}) for ${fileId}!${range}: ${body.slice(0, 200)}`,
    );
  }
  const data = (await resp.json()) as ValueRange;
  return data.values ?? [];
}

// List tab/sheet titles in a spreadsheet.
export async function listTabs(fileId: string): Promise<string[]> {
  const resp = await connectors.proxy(
    CONNECTOR,
    `/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=sheets.properties.title`,
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Google Sheets metadata failed (${resp.status}) for ${fileId}: ${body.slice(0, 200)}`,
    );
  }
  const data = (await resp.json()) as {
    sheets?: { properties?: { title?: string } }[];
  };
  return (data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
}
