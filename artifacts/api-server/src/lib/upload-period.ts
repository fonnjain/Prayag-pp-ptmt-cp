const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function formatMonth(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(period: string, delta: number): string | null {
  const [year, month] = period.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return formatMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/**
 * Extracts a human-readable source month from the filename. Bare DATA.xlsx
 * intentionally returns null because its period is supplied by the upload
 * form, or by the upload timestamp for legacy rows.
 */
export function monthInUploadFilename(filename: string): string | null {
  const numeric = filename.match(/\b(20\d{2})[-_ .](0?[1-9]|1[0-2])\b/i);
  if (numeric) return formatMonth(Number(numeric[1]), Number(numeric[2]));

  const tokens = filename.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const month = MONTH_NAMES[tokens[i]!];
    if (!month) continue;
    const neighbours = [tokens[i - 1], tokens[i + 1]];
    const yearToken = neighbours.find((token) => /^20\d{2}$/.test(token ?? ""));
    if (yearToken) return formatMonth(Number(yearToken), month);
  }
  return null;
}

function monthFromDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Returns the planning month represented by an upload.
 *
 * LAST_MONTH_PENDING and Plumbing FG Stock name the source month immediately
 * before the plan month. Current stock names the plan month directly. DATA
 * files without a month use their upload timestamp for legacy compatibility;
 * new uploads should provide an explicit period.
 */
export function inferUploadPlanningMonth(
  kind: string,
  filename: string,
  uploadedAt: Date | string | null | undefined,
  explicitPeriod?: string | null,
): string | null {
  if (explicitPeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(explicitPeriod)) return explicitPeriod;
  const sourceMonth = monthInUploadFilename(filename);
  if (sourceMonth && (kind === "last_month_pending" || kind === "plumbing_fg_stock")) {
    return shiftMonth(sourceMonth, 1);
  }
  return sourceMonth ?? monthFromDate(uploadedAt);
}