export type Division = "PTMT" | "CP";
export type Role = "admin" | "planner" | "viewer";

export interface PlanLine {
  id: string;
  itemCode: string;
  colour: string;
  category: string;
  model?: string; // CP only
  report: string;
  runRate: number;
  bufferTarget?: number;
  bufferTargetMin?: number;
  bufferTargetMax?: number;
  productionRequired: number;
  openingStock: number;
  pendingLast: number;
  pendingCurrent: number;
  orderAsOn: number;
  produced: number;
  left: number;
  coverage: number;
  urgent: boolean;
}

export interface CategorySummary {
  category: string;
  targetMin: number;
  targetMax: number;
  perDayTarget: number;
  produced: number;
  achievementPct: number;
  rag: "red" | "amber" | "green";
}

export interface PlanRun {
  id: string;
  division: Division;
  planMonth: string; // YYYY-MM
  multiplierMode: "single" | "minmax" | "overrides";
  multiplier?: number;
  multiplierMin?: number;
  multiplierMax?: number;
  overrides?: Record<string, number>;
  createdAt: string;
  createdBy: string;
  lineCount: number;
}

export interface ValidationFinding {
  severity: "info" | "warn" | "block";
  type: "empty" | "partial" | "wrong_month" | "wrong_file" | "shifted_column" | "missing_codes" | "unit_mismatch" | "outlier";
  message: string;
  evidence: string;
  suggestedFix: string;
}

export interface SanityResult {
  verdict: "ok" | "warn" | "block";
  summary: string;
  findings: ValidationFinding[];
  model: string;
  tier: string;
}

export interface ImportBatch {
  id: string;
  source: string;
  division: Division;
  planMonth: string;
  perTable: { table: string; added: number; updated: number; skipped: number; rejected: number }[];
  contentHash: string;
  sanityVerdict: "ok" | "warn" | "block";
  sanitySummary: string;
  createdAt: string;
}

export interface SourceConfig {
  id: string;
  division: Division;
  dataType: string;
  fileId: string;
  tabPattern: string;
  fiscalYearRule: string;
  appliesTo: string;
}

export interface LegacyScope {
  scope: string;
  division: Division;
  status: "done" | "pending";
  importedAt: string | null;
}

export interface Report {
  id: string;
  runId: string;
  cadence: "daily" | "weekly" | "monthly" | "quarterly" | "board";
  model: string;
  tier: "fast" | "deep";
  summary: string;
  createdAt: string;
}
