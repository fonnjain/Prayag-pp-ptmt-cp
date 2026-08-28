import { getTabValues } from "./sheets";
import { logger } from "./logger";

export interface MachineDayRecord {
  date: string;
  runHours: number;
  outputKg: number;
}

export type TotalCountBasis = "net" | "gross";

export interface MachineMonthRecord {
  machineId: string;
  idealHours: number | null;
  totalRunHours: number;
  totalOutputKg: number;
  rejectionKg: number | null;
  total_count_basis: TotalCountBasis;
  isGrinder: boolean;
  days: MachineDayRecord[];
}

export interface Report5Result {
  month: string;
  machines: MachineMonthRecord[];
  lastDataDate: string | null;
}

const DATE_RE = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseSheetDate(label: string): string | null {
  const m = DATE_RE.exec(label.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const monthIdx = MONTH_ABBR[m[2].toLowerCase()];
  if (monthIdx === undefined) return null;
  const year = 2000 + Number(m[3]);
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "").replace(/,/g, "").replace("%", "").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function findHeaderRow(rows: string[][]): number {
  let bestIdx = -1;
  let bestCount = 0;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const row = rows[i] ?? [];
    const count = row.filter((cell) => DATE_RE.test(String(cell ?? "").trim())).length;
    if (count > bestCount) {
      bestCount = count;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function findColByHeader(headerRow: string[], needle: string, exact = false): number {
  const target = needle.toUpperCase();
  return headerRow.findIndex((cell) => {
    const text = String(cell ?? "").trim().toUpperCase();
    return exact ? text === target : text.includes(target);
  });
}

/**
 * Parses the PTMT Report-5 tab: a matrix of (machine, date) → Run Hours / Output (kg),
 * plus per-machine fixed columns (M/C NO., TOTAL RUN HOUR, IDEAL HOUR) and 4 trailing
 * whole-month summary columns (Wt in Kgs, Runner Produce, Actual Rejection Weight, Wastage).
 *
 * Confirmed against the live 2026-06 workbook — do NOT assume "PTMT <code>" machine ids or
 * a fixed column layout; everything below is located by header text per the build spec.
 */
export async function parseReport5(sheetId: string, month: string): Promise<Report5Result> {
  const rows = await getTabValues(sheetId, "Report-5", "A1:DZ400");
  if (rows.length === 0) {
    return { month, machines: [], lastDataDate: null };
  }

  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx === -1) {
    logger.warn({ sheetId, month }, "Report-5: could not locate date header row");
    return { month, machines: [], lastDataDate: null };
  }
  const headerRow = rows[headerRowIdx] ?? [];
  const subHeaderRow = rows[headerRowIdx + 1] ?? [];

  const snoCol = findColByHeader(headerRow, "S.NO", false);
  const machineCol = findColByHeader(headerRow, "M/C NO", false);
  const totalRunHourCol = findColByHeader(headerRow, "TOTAL RUN HOUR", false);
  const idealHourCol = findColByHeader(headerRow, "IDEAL HOUR", false);

  const dateGroups: { colStart: number; date: string }[] = [];
  for (let c = 0; c < headerRow.length; c++) {
    const date = parseSheetDate(String(headerRow[c] ?? ""));
    if (date) dateGroups.push({ colStart: c, date });
  }

  const lastGroupEndCol =
    dateGroups.length > 0 ? dateGroups[dateGroups.length - 1].colStart + 2 : headerRow.length;
  const trailingOutputCol = findColByHeader(subHeaderRow.slice(lastGroupEndCol), "WT IN KGS", false);
  const trailingRejectCol = findColByHeader(subHeaderRow.slice(lastGroupEndCol), "REJECT", false);
  const outputColAbs = trailingOutputCol === -1 ? -1 : trailingOutputCol + lastGroupEndCol;
  const rejectColAbs = trailingRejectCol === -1 ? -1 : trailingRejectCol + lastGroupEndCol;

  const machines: MachineMonthRecord[] = [];
  let lastDataDate: string | null = null;

  for (let r = headerRowIdx + 2; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.length === 0) continue;
    const snoRaw = String(row[snoCol] ?? "").trim();
    if (snoRaw === "" || !/^\d+$/.test(snoRaw)) continue;

    const machineId = String(row[machineCol] ?? "").trim();
    if (!machineId) continue;

    const idealHoursRaw = idealHourCol >= 0 ? row[idealHourCol] : undefined;
    const idealHours =
      idealHoursRaw === undefined || String(idealHoursRaw).trim() === "" ? null : toNumber(idealHoursRaw);
    const totalRunHours = totalRunHourCol >= 0 ? toNumber(row[totalRunHourCol]) : 0;

    const days: MachineDayRecord[] = [];
    for (const group of dateGroups) {
      const outputKg = toNumber(row[group.colStart + 1]);
      const runHours = toNumber(row[group.colStart]);
      if (outputKg === 0 && runHours === 0) continue;
      days.push({ date: group.date, runHours, outputKg });
      if (!lastDataDate || group.date > lastDataDate) lastDataDate = group.date;
    }

    const totalOutputFromTrailing = outputColAbs >= 0 ? toNumber(row[outputColAbs]) : NaN;
    const totalOutputFromDays = days.reduce((sum, d) => sum + d.outputKg, 0);
    const totalOutputKg = Number.isFinite(totalOutputFromTrailing) && totalOutputFromTrailing > 0
      ? totalOutputFromTrailing
      : totalOutputFromDays;

    const rejectionRaw = rejectColAbs >= 0 ? row[rejectColAbs] : undefined;
    const rejectionKg =
      rejectionRaw === undefined || String(rejectionRaw).trim() === "" ? null : toNumber(rejectionRaw);

    machines.push({
      machineId,
      idealHours,
      totalRunHours,
      totalOutputKg,
      rejectionKg,
      // Report-5 is the PTMT source; its validated rejection measure is
      // rejects divided by total manufactured (gross).
      total_count_basis: "gross",
      isGrinder: /grinder/i.test(machineId),
      days,
    });
  }

  return { month, machines, lastDataDate };
}
