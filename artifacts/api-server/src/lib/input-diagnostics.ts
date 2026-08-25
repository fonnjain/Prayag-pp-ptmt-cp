export type InputFieldRole = "code" | "colour" | "quantity";

export interface PendingCoverageRow {
  segment: string;
  code: string;
  colour: string;
  description: string;
  quantity: number;
  disposition: "excluded";
  reason: "NO_ROSTER_MATCH";
}

export interface PendingCoverageDiagnostics {
  totalQuantity: number;
  matchedQuantity: number;
  unmatchedQuantity: number;
  matchedRowCount: number;
  unmatchedRowCount: number;
  unmatchedRows: PendingCoverageRow[];
}

export interface InputReadDiagnostics {
  source: string;
  uploadId: number | null;
  filename: string | null;
  rowCount: number;
  codeRows: number;
  quantityRows: number;
  recognizedRows: number;
  skippedRows: number;
  resolvedFields: Record<InputFieldRole, string | null>;
  acceptedAliases: Record<InputFieldRole, string[]>;
  presentHeaders: string[];
  missingRequiredFields: InputFieldRole[];
  reasons: string[];
  pendingCoverage?: PendingCoverageDiagnostics;
  error?: string;
}

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstValue(row: Record<string, unknown>, aliases: string[]): unknown {
  const direct = aliases
    .map((alias) => row[alias])
    .find((value) => value !== undefined && value !== null && value !== "");
  if (direct !== undefined) return direct;
  const wanted = new Set(aliases.map(normaliseHeader));
  const matchingKey = Object.keys(row).find((key) => wanted.has(normaliseHeader(key)));
  return matchingKey ? row[matchingKey] : undefined;
}

function presentHeaders(rows: Record<string, unknown>[]): string[] {
  const headers = new Set<string>();
  for (const row of rows) {
    for (const header of Object.keys(row)) headers.add(header);
  }
  return [...headers].sort();
}

/**
 * Describe how a row-based source maps its accepted aliases before any
 * aggregation occurs. A row is recognized only when both its key and quantity
 * are present; this makes a missing balance column visible instead of looking
 * like a legitimate zero total.
 */
export function diagnoseInputRows(
  rows: Record<string, unknown>[],
  aliases: Record<InputFieldRole, string[]>,
  options: { source: string; uploadId?: number | null; filename?: string | null; error?: string },
): InputReadDiagnostics {
  const headers = presentHeaders(rows);
  const normalisedHeaders = new Set(headers.map(normaliseHeader));
  const resolvedFields = {
    code: aliases.code.find((alias) => headers.includes(alias))
      ?? aliases.code.find((alias) => normalisedHeaders.has(normaliseHeader(alias)))
      ?? null,
    colour: aliases.colour.find((alias) => headers.includes(alias))
      ?? aliases.colour.find((alias) => normalisedHeaders.has(normaliseHeader(alias)))
      ?? null,
    quantity: aliases.quantity.find((alias) => headers.includes(alias))
      ?? aliases.quantity.find((alias) => normalisedHeaders.has(normaliseHeader(alias)))
      ?? null,
  } satisfies Record<InputFieldRole, string | null>;

  let codeRows = 0;
  let quantityRows = 0;
  let recognizedRows = 0;
  for (const row of rows) {
    const hasCode = firstValue(row, aliases.code) !== undefined;
    const hasQuantity = firstValue(row, aliases.quantity) !== undefined;
    if (hasCode) codeRows++;
    if (hasQuantity) quantityRows++;
    if (hasCode && hasQuantity) recognizedRows++;
  }

  const missingRequiredFields: InputFieldRole[] = [];
  if (!resolvedFields.code) missingRequiredFields.push("code");
  if (!resolvedFields.quantity) missingRequiredFields.push("quantity");
  const reasons = [
    ...(missingRequiredFields.length > 0
      ? [`missing required fields: ${missingRequiredFields.join(", ")}`]
      : []),
    ...(rows.length > 0 && recognizedRows === 0 && missingRequiredFields.length === 0
      ? ["rows were read but none contained both a recognized code and quantity"]
      : []),
    ...(options.error ? [`source read failed: ${options.error}`] : []),
  ];

  return {
    source: options.source,
    uploadId: options.uploadId ?? null,
    filename: options.filename ?? null,
    rowCount: rows.length,
    codeRows,
    quantityRows,
    recognizedRows,
    skippedRows: rows.length - recognizedRows,
    resolvedFields,
    acceptedAliases: aliases,
    presentHeaders: headers,
    missingRequiredFields,
    reasons,
    ...(options.error ? { error: options.error } : {}),
  };
}

export function formatInputDiagnostics(diagnostics: InputReadDiagnostics): string {
  const missing = diagnostics.missingRequiredFields.length > 0
    ? `; missing required fields: ${diagnostics.missingRequiredFields.join(", ")}`
    : "";
  return [
    `source=${diagnostics.source}`,
    `uploadId=${diagnostics.uploadId ?? "n/a"}`,
    `rows=${diagnostics.rowCount}`,
    `recognized=${diagnostics.recognizedRows}`,
    `skipped=${diagnostics.skippedRows}`,
    `resolved=${JSON.stringify(diagnostics.resolvedFields)}`,
    `presentHeaders=${JSON.stringify(diagnostics.presentHeaders)}`,
    `acceptedAliases=${JSON.stringify(diagnostics.acceptedAliases)}`,
    `reasons=${JSON.stringify(diagnostics.reasons)}`,
    missing,
    diagnostics.error ? `; error=${diagnostics.error}` : "",
  ].join(" ");
}