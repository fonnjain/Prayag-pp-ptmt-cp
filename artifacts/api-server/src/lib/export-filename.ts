/**
 * Returns the current time in IST (UTC+5:30) formatted as YYYYMMDD-HHmm,
 * suitable for embedding in download filenames.
 *
 * Example: "20260817-1430"
 */
export function exportTimestamp(): string {
  const now = new Date();
  // Shift to IST = UTC + 5h30m
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  const y  = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(ist.getUTCDate()).padStart(2, "0");
  const h  = String(ist.getUTCHours()).padStart(2, "0");
  const mi = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${d}-${h}${mi}`;
}

export function exportDate(date = new Date()): string {
  const ist = new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000);
  const y = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export type GovernedExportKind =
  | "Temporary"
  | "Production"
  | "WeeklyRelease"
  | "MachineFeasible"
  | "CorrectiveRePlan"
  | "MachineWise"
  | "PlanningFormat";

export function governedExportFilename(params: {
  segment: string;
  kind: GovernedExportKind;
  month: string;
  runId: number;
  extension: "xlsx" | "pdf";
  variant?: string;
  date?: Date;
}): string {
  const segment = params.segment === "Plumbing" ? "Plumbing" : "PTMT";
  const variant = params.variant ? `_${params.variant.replace(/[^A-Za-z0-9-]/g, "")}` : "";
  return `${segment}_${params.kind}${variant}_${params.month}_Run${params.runId}_${exportDate(params.date)}.${params.extension}`;
}

/**
 * Filename for BX exports which combine the stored Temporary and Production
 * evidence. Unlike ordinary governed downloads this intentionally has no
 * download date: the two run ids are the complete lineage identity required
 * by the workbook.
 */
export function governedLineageExportFilename(params: {
  segment: string;
  kind: "MachineFeasible" | "WeeklyRelease";
  month: string;
  temporaryRunId: number;
  productionRunId: number;
  extension: "xlsx";
}): string {
  const segment = params.segment === "Plumbing" ? "Plumbing" : "PTMT";
  return `${segment}_${params.kind}_${params.month}_Run${params.temporaryRunId}_Run${params.productionRunId}.${params.extension}`;
}
