import { eq, and } from "drizzle-orm";
import { db, importLedger, sourceConfig } from "@workspace/db";
import { pullData } from "./ingestion";
import { HttpError } from "../lib/http";

export interface LegacyScope {
  scope: string;
  division: string;
  source: string;
  status: "pending" | "done";
  importedAt: string | null;
}

const SOURCE = "google";

// Legacy scopes = the one-time historical/fiscal-year backfills configured in
// source_config (annual/fiscal files, or any source with an applies_to bound).
function isLegacyConfig(dataType: string, appliesTo: string | null): boolean {
  const d = dataType.toLowerCase();
  return d.includes("annual") || d.includes("legacy") || d.includes("history") || appliesTo !== null;
}

function scopeKey(division: string, dataType: string): string {
  return `${division}:${dataType}`;
}

export async function getScopes(division?: string): Promise<LegacyScope[]> {
  const cfgs = await db.select().from(sourceConfig);
  const ledgerRows = await db.select().from(importLedger);
  const ledgerByScope = new Map(ledgerRows.map((l) => [`${l.source}:${l.scope}`, l]));

  const out: LegacyScope[] = [];
  for (const c of cfgs) {
    if (division && c.division !== division) continue;
    if (!isLegacyConfig(c.dataType, c.appliesTo)) continue;
    const scope = scopeKey(c.division, c.dataType);
    const ledger = ledgerByScope.get(`${SOURCE}:${scope}`);
    out.push({
      scope,
      division: c.division,
      source: SOURCE,
      status: ledger ? "done" : "pending",
      importedAt: ledger?.doneAt ? new Date(ledger.doneAt).toISOString() : null,
    });
  }
  return out;
}

export interface LegacyImportResult {
  ok: boolean;
  alreadyDone: boolean;
  rowsImported: number;
  message: string;
}

export async function runLegacyImport(
  scope: string,
  source: string,
  division?: string,
): Promise<LegacyImportResult> {
  const existing = await db
    .select()
    .from(importLedger)
    .where(and(eq(importLedger.source, source), eq(importLedger.scope, scope)))
    .limit(1);
  if (existing[0]) {
    return {
      ok: true,
      alreadyDone: true,
      rowsImported: 0,
      message: `Scope "${scope}" was already imported on ${existing[0].doneAt ? new Date(existing[0].doneAt).toISOString().slice(0, 10) : "an earlier date"}.`,
    };
  }

  // scope format: "<division>:<dataType>"
  const [div, dataType] = scope.split(":");
  const divFinal = division ?? div;
  if (!divFinal || !dataType) {
    throw new HttpError(400, `Invalid legacy scope "${scope}". Expected "<division>:<dataType>".`);
  }

  // Anchor the historical pull at the configured applies_to (or applies_from)
  // month so windows resolve against the fiscal file.
  const cfgRows = await db
    .select()
    .from(sourceConfig)
    .where(and(eq(sourceConfig.division, divFinal), eq(sourceConfig.dataType, dataType)))
    .limit(1);
  const cfg = cfgRows[0];
  const anchor =
    cfg?.appliesTo ?? cfg?.appliesFrom ?? new Date().toISOString().slice(0, 10);
  const anchorMonth = `${anchor.slice(0, 7)}-01`;

  const outcome = await pullData(divFinal, anchorMonth, `legacy:${source}`, dataType);
  const rowsImported = outcome.batches.reduce((s, b) => s + b.rowsAdded, 0);

  await db.insert(importLedger).values({ source, scope });

  return {
    ok: true,
    alreadyDone: false,
    rowsImported,
    message: `Imported ${rowsImported} rows for "${scope}".`,
  };
}
