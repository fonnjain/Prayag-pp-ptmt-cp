import { diagnoseInputRows, type InputFieldRole, type InputReadDiagnostics } from "./input-diagnostics";

export type PendingSnapshotRole = "pending_current" | "pending_last_month";

export interface PendingSnapshotSource {
  id: number | null;
  filename: string | null;
  rowCount: number | null;
  uploadedAt: Date | null;
  sourceContentHash?: string;
}

export interface PendingSnapshotParsedRow {
  itemCode: string;
  colour: string;
  qty: number;
}

export interface PlanRunInputSnapshotPayload {
  segment: string;
  sourceRole: PendingSnapshotRole;
  sourceKind: string;
  sourceUploadId: number | null;
  sourceFilename: string | null;
  sourceUploadedAt: Date | null;
  rawRows: Record<string, unknown>[];
  parsedRows: PendingSnapshotParsedRow[];
  diagnostics: InputReadDiagnostics;
}

function firstValue(row: Record<string, unknown>, aliases: string[]): unknown {
  return aliases
    .map((alias) => row[alias])
    .find((value) => value !== undefined && value !== null && value !== "");
}

function asNumber(value: unknown): number {
  return typeof value === "number"
    ? value
    : Number(String(value ?? "0").replace(/,/g, "")) || 0;
}

export function parsePendingRows(
  rows: Record<string, unknown>[],
  aliases: Record<InputFieldRole, string[]>,
  transformQuantity: (value: number) => number = (value) => value,
): PendingSnapshotParsedRow[] {
  const totals = new Map<string, PendingSnapshotParsedRow>();
  for (const row of rows) {
    const rawCode = firstValue(row, aliases.code);
    if (rawCode === undefined) continue;
    const rawColour = firstValue(row, aliases.colour);
    const rawQuantity = firstValue(row, aliases.quantity);
    if (rawQuantity === undefined) continue;
    const itemCode = String(rawCode).trim();
    if (!itemCode) continue;
    const colour = String(rawColour ?? "").trim();
    const key = `${itemCode}::${colour}`;
    const previous = totals.get(key);
    totals.set(key, {
      itemCode,
      colour,
      qty: (previous?.qty ?? 0) + transformQuantity(asNumber(rawQuantity)),
    });
  }
  return [...totals.values()];
}

export function buildPlanRunInputSnapshot(input: {
  segment: string;
  sourceRole: PendingSnapshotRole;
  sourceKind: string;
  source: PendingSnapshotSource;
  rows: Record<string, unknown>[];
  aliases: Record<InputFieldRole, string[]>;
  transformQuantity?: (value: number) => number;
  diagnosticNotes?: string[];
}): PlanRunInputSnapshotPayload {
  const baseDiagnostics = diagnoseInputRows(input.rows, input.aliases, {
    source: `${input.sourceKind} (${input.sourceRole})`,
    uploadId: input.source.id,
    filename: input.source.filename,
  });
  const diagnostics: InputReadDiagnostics = {
    ...baseDiagnostics,
    reasons: [...baseDiagnostics.reasons, ...(input.diagnosticNotes ?? [])],
    ...(input.source.sourceContentHash
      ? { sourceContentHash: input.source.sourceContentHash }
      : {}),
  };
  return {
    segment: input.segment,
    sourceRole: input.sourceRole,
    sourceKind: input.sourceKind,
    sourceUploadId: input.source.id,
    sourceFilename: input.source.filename,
    sourceUploadedAt: input.source.uploadedAt,
    rawRows: input.rows,
    parsedRows: parsePendingRows(input.rows, input.aliases, input.transformQuantity),
    diagnostics,
  };
}

export function pendingSnapshotStatus(snapshotCount: number): "captured" | "not-captured" {
  return snapshotCount > 0 ? "captured" : "not-captured";
}