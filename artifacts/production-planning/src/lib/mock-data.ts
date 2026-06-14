import { CategorySummary, ImportBatch, LegacyScope, PlanLine, PlanRun, Report, SanityResult, SourceConfig } from "./types";

export const MOCK_PLAN_LINES: PlanLine[] = [
  {
    id: "l1",
    itemCode: "PT-1001",
    colour: "Chrome",
    category: "Faucets",
    report: "Main Line",
    runRate: 150,
    bufferTarget: 300,
    productionRequired: 400,
    openingStock: 50,
    pendingLast: 10,
    pendingCurrent: 140,
    orderAsOn: 150,
    produced: 100,
    left: 300,
    coverage: 0.8,
    urgent: true
  },
  {
    id: "l2",
    itemCode: "PT-1002",
    colour: "Matte Black",
    category: "Faucets",
    report: "Main Line",
    runRate: 80,
    bufferTarget: 160,
    productionRequired: 200,
    openingStock: 40,
    pendingLast: 0,
    pendingCurrent: 60,
    orderAsOn: 60,
    produced: 50,
    left: 150,
    coverage: 1.2,
    urgent: false
  },
  {
    id: "l3",
    itemCode: "CP-2001",
    colour: "White",
    category: "Cisterns",
    model: "EcoFlush",
    report: "Cisterns Line",
    runRate: 500,
    bufferTarget: 1000,
    productionRequired: 1200,
    openingStock: 200,
    pendingLast: 50,
    pendingCurrent: 400,
    orderAsOn: 450,
    produced: 800,
    left: 400,
    coverage: 2.1,
    urgent: false
  }
];

export const MOCK_CATEGORY_SUMMARIES: CategorySummary[] = [
  { category: "Faucets", targetMin: 2000, targetMax: 2500, perDayTarget: 85, produced: 1500, achievementPct: 75, rag: "amber" },
  { category: "Cisterns", targetMin: 5000, targetMax: 6000, perDayTarget: 200, produced: 5200, achievementPct: 104, rag: "green" },
  { category: "Pipes", targetMin: 10000, targetMax: 12000, perDayTarget: 400, produced: 4000, achievementPct: 40, rag: "red" }
];

export const MOCK_PLAN_RUNS: PlanRun[] = [
  { id: "pr1", division: "PTMT", planMonth: "2024-03", multiplierMode: "single", multiplier: 2.5, createdAt: "2024-03-01T08:00:00Z", createdBy: "Planner Alice", lineCount: 142 },
  { id: "pr2", division: "CP", planMonth: "2024-03", multiplierMode: "minmax", multiplierMin: 1.5, multiplierMax: 3.0, createdAt: "2024-03-02T09:15:00Z", createdBy: "Planner Bob", lineCount: 85 }
];

export const MOCK_SANITY_RESULT: SanityResult = {
  verdict: "warn",
  summary: "Data generally looks good, but some outliers detected in Faucet categories.",
  model: "claude-3-haiku",
  tier: "fast",
  findings: [
    { severity: "warn", type: "outlier", message: "PT-1001 run rate jumped 400% from last month", evidence: "Prev run rate: 30, Current: 150", suggestedFix: "Verify if bulk order was placed" }
  ]
};

export const MOCK_IMPORT_BATCHES: ImportBatch[] = [
  { id: "ib1", source: "Sales DB", division: "PTMT", planMonth: "2024-03", perTable: [{ table: "Orders", added: 500, updated: 20, skipped: 0, rejected: 2 }], contentHash: "abc123hash", sanityVerdict: "ok", sanitySummary: "All clean", createdAt: "2024-03-01T07:30:00Z" }
];

export const MOCK_SOURCE_CONFIGS: SourceConfig[] = [
  { id: "sc1", division: "PTMT", dataType: "Sales", fileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz", tabPattern: "Sales_Mar_24", fiscalYearRule: "April-March", appliesTo: "All PTMT" },
  { id: "sc2", division: "CP", dataType: "Production", fileId: "1ZyXwVuTsRqPoNmMlKjIhGfEdCbA", tabPattern: "Prod_*", fiscalYearRule: "Jan-Dec", appliesTo: "Cisterns only" }
];

export const MOCK_LEGACY_SCOPES: LegacyScope[] = [
  { scope: "2023 Historical Sales", division: "PTMT", status: "done", importedAt: "2024-01-15T10:00:00Z" },
  { scope: "2023 Historical Stock", division: "PTMT", status: "pending", importedAt: null }
];

export const MOCK_REPORTS: Report[] = [
  { id: "r1", runId: "pr1", cadence: "weekly", model: "claude-3-opus", tier: "deep", summary: "Production on track for Faucets, but Pipes lagging. Recommend shifting capacity.", createdAt: "2024-03-07T12:00:00Z" }
];
