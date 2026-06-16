import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const CONNECTOR = "google-sheet";
const DRIVE_CONNECTOR = "google-drive";

type ProxyResp = Awaited<ReturnType<typeof connectors.proxy>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Proxy GET with retry/backoff. The connector proxy intermittently returns 429
// or 5xx (and occasionally throws) when many ranges are read back-to-back, e.g.
// right after a large multi-hundred-thousand-row pull. Retry those.
async function proxyGet(path: string): Promise<ProxyResp> {
  let lastResp: ProxyResp | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await connectors.proxy(CONNECTOR, path);
      if (resp.ok || (resp.status !== 429 && resp.status < 500)) return resp;
      lastResp = resp;
    } catch (err) {
      if (attempt === 2) throw err;
    }
    await sleep(700 * (attempt + 1));
  }
  return lastResp!;
}

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
    const ok =
      status === "connected" ||
      status === "active" ||
      status === "ready" ||
      status === "healthy" ||
      status === "authorized";
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
  const resp = await proxyGet(
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
  const resp = await proxyGet(
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

// ---------------------------------------------------------------------------
// Google DRIVE helpers (separate connector from Sheets). Used by the advisory
// coverage layer to enumerate spreadsheets under configured root folders and to
// resolve a file's parent folder(s). All best-effort: callers must tolerate
// failures, since coverage is advisory and must never break a data pull.
// ---------------------------------------------------------------------------

async function driveProxyGet(path: string): Promise<ProxyResp> {
  let lastResp: ProxyResp | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await connectors.proxy(DRIVE_CONNECTOR, path);
      if (resp.ok || (resp.status !== 429 && resp.status < 500)) return resp;
      lastResp = resp;
    } catch (err) {
      if (attempt === 2) throw err;
    }
    await sleep(700 * (attempt + 1));
  }
  return lastResp!;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string | null;
  parents: string[];
  mimeType: string;
}

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// One page-through listing of a folder's direct children of a given mime type.
async function driveListChildren(
  folderId: string,
  mimeType: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(
      `'${folderId}' in parents and mimeType='${mimeType}' and trashed=false`,
    );
    const fields = encodeURIComponent(
      "nextPageToken,files(id,name,modifiedTime,parents,mimeType)",
    );
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const resp = await driveProxyGet(
      `/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives${tokenParam}`,
    );
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Google Drive list failed (${resp.status}) for folder ${folderId}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await resp.json()) as {
      nextPageToken?: string;
      files?: {
        id?: string;
        name?: string;
        modifiedTime?: string;
        parents?: string[];
        mimeType?: string;
      }[];
    };
    for (const f of data.files ?? []) {
      if (!f.id) continue;
      out.push({
        id: f.id,
        name: f.name ?? "",
        modifiedTime: f.modifiedTime ?? null,
        parents: f.parents ?? [],
        mimeType: f.mimeType ?? mimeType,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// Recursively enumerate every spreadsheet under a root folder (bounded by depth
// and a global file cap so a huge/looping Drive can never hang a pull).
export async function driveListSpreadsheets(
  rootFolderId: string,
  opts: { maxDepth?: number; maxFiles?: number } = {},
): Promise<DriveFile[]> {
  const maxDepth = opts.maxDepth ?? 2;
  const maxFiles = opts.maxFiles ?? 800;
  const seen = new Set<string>();
  const results: DriveFile[] = [];
  const visitedFolders = new Set<string>();

  async function walk(folderId: string, depth: number): Promise<void> {
    if (results.length >= maxFiles) return;
    if (visitedFolders.has(folderId)) return;
    visitedFolders.add(folderId);

    const sheets = await driveListChildren(folderId, SHEET_MIME);
    for (const s of sheets) {
      if (results.length >= maxFiles) break;
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      results.push(s);
    }
    if (depth >= maxDepth || results.length >= maxFiles) return;
    const subfolders = await driveListChildren(folderId, FOLDER_MIME);
    for (const sub of subfolders) {
      if (results.length >= maxFiles) break;
      await walk(sub.id, depth + 1);
    }
  }

  await walk(rootFolderId, 0);
  return results;
}

// Resolve a file's parent folder id(s). Returns [] if the file is inaccessible
// or shared individually (no readable parent).
export async function driveGetParents(fileId: string): Promise<string[]> {
  const resp = await driveProxyGet(
    `/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`,
  );
  if (!resp.ok) return [];
  const data = (await resp.json()) as { parents?: string[] };
  return data.parents ?? [];
}
