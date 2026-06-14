import React, { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useLogin,
  useLogout,
  useGetDashboard,
  useGetPlanRuns,
  useGetPlanLines,
  useGetSanity,
  useGetBatches,
  useGetSourceConfigs,
  useGetLegacyScopes,
  useGetReports,
  usePullData,
  useBuildPlan,
  useAcknowledgeData,
  useGenerateReport,
  useUpdateSourceConfig,
  useRunLegacyImport,
  getGetMeQueryKey,
  getGetDashboardQueryKey,
  getGetPlanRunsQueryKey,
  getGetPlanLinesQueryKey,
  getGetSanityQueryKey,
  getGetBatchesQueryKey,
  getGetReportsQueryKey,
  getGetLegacyScopesQueryKey,
  getGetSourceConfigsQueryKey,
} from "@workspace/api-client-react";
import type {
  PlanLine as ApiPlanLine,
  PlanRun as ApiPlanRun,
  CategorySummary as ApiCategorySummary,
  SanityResult as ApiSanityResult,
  ValidationFinding as ApiValidationFinding,
  ImportBatch as ApiImportBatch,
  SourceConfig as ApiSourceConfig,
  LegacyScope as ApiLegacyScope,
  Report as ApiReport,
  User as ApiUser,
} from "@workspace/api-client-react";
import {
  Division,
  Role,
  PlanLine,
  CategorySummary,
  PlanRun,
  SanityResult,
  ValidationFinding,
  ImportBatch,
  SourceConfig,
  LegacyScope,
  Report,
} from "./types";

interface DataContextType {
  division: Division;
  setDivision: (d: Division) => void;
  planMonth: string;
  setPlanMonth: (m: string) => void;
  role: Role;

  user: ApiUser | null;
  isAuthed: boolean;
  meLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  planLines: PlanLine[];
  categorySummaries: CategorySummary[];
  planRuns: PlanRun[];
  sanityResult: SanityResult | null;
  importBatches: ImportBatch[];
  sourceConfigs: SourceConfig[];
  legacyScopes: LegacyScope[];
  reports: Report[];

  buildPlan: (
    mode: "single" | "minmax" | "overrides",
    val1?: number,
    val2?: number,
    overrides?: Record<string, number>,
  ) => Promise<void>;
  pullData: () => Promise<void>;
  acknowledgeWarnings: () => Promise<void>;
  generateReport: () => Promise<void>;
  updateSourceConfig: (id: string, updates: Partial<SourceConfig>) => Promise<void>;
  runLegacyImport: (scope: string) => Promise<void>;

  isPulling: boolean;
  isBuilding: boolean;
  isGeneratingReport: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

// "YYYY-MM" (UI) -> "YYYY-MM-01" (API date)
function toApiMonth(m: string): string {
  return /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : m;
}

function mapSeverity(s: string): ValidationFinding["severity"] {
  if (s === "blocker" || s === "block") return "block";
  if (s === "warning" || s === "warn") return "warn";
  return "info";
}

function mapFinding(f: ApiValidationFinding): ValidationFinding {
  return {
    severity: mapSeverity(f.severity),
    type: (f.type as ValidationFinding["type"]) ?? "outlier",
    message: f.message,
    evidence: f.evidence ?? "",
    suggestedFix: f.suggestedFix ?? "",
  };
}

function mapSanity(s: ApiSanityResult | null | undefined): SanityResult | null {
  if (!s) return null;
  return {
    verdict: (s.verdict as SanityResult["verdict"]) ?? "ok",
    summary: s.summary,
    model: s.model ?? "—",
    tier: s.tier ?? "—",
    findings: (s.findings ?? []).map(mapFinding),
  };
}

function mapPlanLine(l: ApiPlanLine): PlanLine {
  return {
    id: String(l.id),
    itemCode: l.itemCode ?? "",
    colour: l.colour ?? "",
    category: l.category ?? "",
    model: l.model ?? undefined,
    report: l.report ?? "",
    runRate: l.runRate,
    bufferTarget: l.bufferTarget ?? undefined,
    bufferTargetMin: l.bufferTargetMin ?? undefined,
    bufferTargetMax: l.bufferTargetMax ?? undefined,
    productionRequired: l.productionRequired,
    openingStock: l.openingStock,
    pendingLast: l.pendingLast,
    pendingCurrent: l.pendingCurrent,
    orderAsOn: l.orderAsOn,
    produced: l.produced,
    left: l.left,
    coverage: l.coverage,
    urgent: l.urgent,
  };
}

function mapPlanRun(r: ApiPlanRun): PlanRun {
  return {
    id: String(r.id),
    division: r.division as Division,
    planMonth: r.planMonth,
    multiplierMode: (r.multiplierMode as PlanRun["multiplierMode"]) ?? "single",
    multiplier: r.multiplier ?? undefined,
    multiplierMin: r.multiplierMin ?? undefined,
    multiplierMax: r.multiplierMax ?? undefined,
    overrides: r.overrides ?? undefined,
    createdAt: r.createdAt ?? new Date().toISOString(),
    createdBy: r.createdBy ?? "—",
    lineCount: r.lineCount,
  };
}

function mapCategory(c: ApiCategorySummary): CategorySummary {
  return {
    category: c.category,
    targetMin: c.targetMin,
    targetMax: c.targetMax,
    perDayTarget: c.perDayTarget,
    produced: c.produced,
    achievementPct: c.achievementPct,
    rag: (c.rag as CategorySummary["rag"]) ?? "red",
  };
}

function mapSourceConfig(c: ApiSourceConfig): SourceConfig {
  return {
    id: String(c.id),
    division: c.division as Division,
    dataType: c.dataType,
    fileId: c.fileId,
    tabPattern: c.tabPattern ?? "",
    fiscalYearRule: "",
    appliesTo: c.appliesTo ?? "",
  };
}

function mapLegacyScope(s: ApiLegacyScope): LegacyScope {
  return {
    scope: s.scope,
    division: s.division as Division,
    status: (s.status as LegacyScope["status"]) ?? "pending",
    importedAt: s.importedAt ?? null,
  };
}

function mapReport(r: ApiReport): Report {
  return {
    id: String(r.id),
    runId: r.planRunId != null ? String(r.planRunId) : "",
    cadence: (r.periodType as Report["cadence"]) ?? "monthly",
    model: r.model ?? "—",
    tier: (r.tier as Report["tier"]) ?? "fast",
    summary: r.summary ?? "",
    createdAt: r.createdAt ?? new Date().toISOString(),
  };
}

// Group per-table API batches from the most recent pull into one display batch.
function buildLatestBatches(
  batches: ApiImportBatch[],
  division: Division,
  planMonth: string,
): ImportBatch[] {
  if (batches.length === 0) return [];
  const sorted = [...batches].sort(
    (a, b) => (b.pulledAt ?? "").localeCompare(a.pulledAt ?? ""),
  );
  const latestTime = sorted[0].pulledAt ?? "";
  const group = sorted.filter((b) => (b.pulledAt ?? "") === latestTime);
  const verdict = (group.find((b) => b.sanityVerdict)?.sanityVerdict ??
    "ok") as ImportBatch["sanityVerdict"];
  return [
    {
      id: String(sorted[0].id),
      source: "Google Sheets",
      division,
      planMonth,
      perTable: group.map((b) => ({
        table: b.dataType ?? "data",
        added: b.rowsAdded,
        updated: b.rowsUpdated,
        skipped: b.rowsSkipped,
        rejected: b.rowsRejected,
      })),
      contentHash: sorted[0].contentHash ?? "",
      sanityVerdict: verdict,
      sanitySummary: group.find((b) => b.sanitySummary)?.sanitySummary ?? "",
      createdAt: latestTime || new Date().toISOString(),
    },
  ];
}

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const [division, setDivision] = useState<Division>("PTMT");
  const [planMonth, setPlanMonth] = useState<string>("2026-06");

  const apiMonth = toApiMonth(planMonth);

  // Generated query hooks type `query` as full UseQueryOptions (queryKey required);
  // the hook injects queryKey internally, so we only need to pass `enabled`.
  const enabledOpt = (on: boolean): any => ({ query: { enabled: on } });

  const meQuery = useGetMe();
  const user = (meQuery.data as ApiUser | undefined) ?? null;
  const isAuthed = !meQuery.isError && !!user;
  const role = (user?.role as Role) ?? "viewer";
  const enabled = isAuthed;

  const dashboardQuery = useGetDashboard(
    { division, planMonth: apiMonth },
    enabledOpt(enabled),
  );
  const planRunsQuery = useGetPlanRuns(
    { division, planMonth: apiMonth },
    enabledOpt(enabled),
  );

  const planRunsRaw = (planRunsQuery.data as ApiPlanRun[] | undefined) ?? [];
  const sortedRuns = useMemo(
    () => [...planRunsRaw].sort((a, b) => b.version - a.version),
    [planRunsRaw],
  );
  const latestRunId = sortedRuns[0]?.id;

  const planLinesQuery = useGetPlanLines(
    latestRunId ?? 0,
    enabledOpt(enabled && latestRunId != null),
  );
  const sanityQuery = useGetSanity(
    { division, planMonth: apiMonth },
    enabledOpt(enabled),
  );
  const batchesQuery = useGetBatches(
    { division, planMonth: apiMonth },
    enabledOpt(enabled),
  );
  const sourceConfigsQuery = useGetSourceConfigs(
    { division },
    enabledOpt(enabled && role === "admin"),
  );
  const legacyScopesQuery = useGetLegacyScopes(
    { division },
    enabledOpt(enabled && role === "admin"),
  );
  const reportsQuery = useGetReports(
    { division, planMonth: apiMonth },
    enabledOpt(enabled),
  );

  const pullMutation = usePullData();
  const buildMutation = useBuildPlan();
  const ackMutation = useAcknowledgeData();
  const reportMutation = useGenerateReport();
  const sourceConfigMutation = useUpdateSourceConfig();
  const legacyMutation = useRunLegacyImport();
  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const planLines = useMemo(
    () => ((planLinesQuery.data as ApiPlanLine[] | undefined) ?? []).map(mapPlanLine),
    [planLinesQuery.data],
  );
  const planRuns = useMemo(() => sortedRuns.map(mapPlanRun), [sortedRuns]);
  const categorySummaries = useMemo(
    () => (dashboardQuery.data?.categorySummaries ?? []).map(mapCategory),
    [dashboardQuery.data],
  );
  const sanityResult = useMemo(
    () => mapSanity(sanityQuery.data as ApiSanityResult | null | undefined),
    [sanityQuery.data],
  );
  const importBatches = useMemo(
    () =>
      buildLatestBatches(
        (batchesQuery.data as ApiImportBatch[] | undefined) ?? [],
        division,
        planMonth,
      ),
    [batchesQuery.data, division, planMonth],
  );
  const sourceConfigs = useMemo(
    () => ((sourceConfigsQuery.data as ApiSourceConfig[] | undefined) ?? []).map(mapSourceConfig),
    [sourceConfigsQuery.data],
  );
  const legacyScopes = useMemo(
    () => ((legacyScopesQuery.data as ApiLegacyScope[] | undefined) ?? []).map(mapLegacyScope),
    [legacyScopesQuery.data],
  );
  const reports = useMemo(
    () => ((reportsQuery.data as ApiReport[] | undefined) ?? []).map(mapReport),
    [reportsQuery.data],
  );

  const invalidatePlanData = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey({ division, planMonth: apiMonth }) }),
      qc.invalidateQueries({ queryKey: getGetPlanRunsQueryKey({ division, planMonth: apiMonth }) }),
      qc.invalidateQueries({ queryKey: getGetPlanLinesQueryKey(latestRunId ?? 0) }),
    ]);
  };

  const login = async (email: string, password: string) => {
    await loginMutation.mutateAsync({ data: { email, password } });
    await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    qc.clear();
  };

  const buildPlan = async (
    mode: "single" | "minmax" | "overrides",
    val1?: number,
    val2?: number,
    overrides?: Record<string, number>,
  ) => {
    await buildMutation.mutateAsync({
      data: {
        division,
        planMonth: apiMonth,
        mode,
        multiplier: mode === "single" ? val1 : undefined,
        multiplierMin: mode === "minmax" ? val1 : undefined,
        multiplierMax: mode === "minmax" ? val2 : undefined,
        overrides: mode === "overrides" ? overrides : undefined,
      },
    });
    await invalidatePlanData();
  };

  const pullData = async () => {
    await pullMutation.mutateAsync({ data: { division, planMonth: apiMonth } });
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetBatchesQueryKey({ division, planMonth: apiMonth }) }),
      qc.invalidateQueries({ queryKey: getGetSanityQueryKey({ division, planMonth: apiMonth }) }),
      invalidatePlanData(),
    ]);
  };

  const acknowledgeWarnings = async () => {
    await ackMutation.mutateAsync({ data: { division, planMonth: apiMonth } });
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetSanityQueryKey({ division, planMonth: apiMonth }) }),
      qc.invalidateQueries({ queryKey: getGetBatchesQueryKey({ division, planMonth: apiMonth }) }),
    ]);
  };

  const generateReport = async () => {
    if (latestRunId == null) {
      throw new Error("No plan run available. Build a plan before generating a report.");
    }
    await reportMutation.mutateAsync({ data: { runId: latestRunId, cadence: "monthly" } });
    await qc.invalidateQueries({ queryKey: getGetReportsQueryKey({ division, planMonth: apiMonth }) });
  };

  const updateSourceConfig = async (id: string, updates: Partial<SourceConfig>) => {
    await sourceConfigMutation.mutateAsync({
      id: Number(id),
      data: {
        fileId: updates.fileId,
        tabPattern: updates.tabPattern,
        appliesTo: updates.appliesTo,
      },
    });
    await qc.invalidateQueries({ queryKey: getGetSourceConfigsQueryKey({ division }) });
  };

  const runLegacyImport = async (scope: string) => {
    const target = (legacyScopesQuery.data as ApiLegacyScope[] | undefined)?.find(
      (s) => s.scope === scope,
    );
    await legacyMutation.mutateAsync({
      data: {
        scope,
        division: target?.division ?? division,
        source: target?.source ?? "google",
      },
    });
    await qc.invalidateQueries({ queryKey: getGetLegacyScopesQueryKey({ division }) });
  };

  return (
    <DataContext.Provider
      value={{
        division,
        setDivision,
        planMonth,
        setPlanMonth,
        role,
        user,
        isAuthed,
        meLoading: meQuery.isLoading,
        login,
        logout,
        planLines,
        categorySummaries,
        planRuns,
        sanityResult,
        importBatches,
        sourceConfigs,
        legacyScopes,
        reports,
        buildPlan,
        pullData,
        acknowledgeWarnings,
        generateReport,
        updateSourceConfig,
        runLegacyImport,
        isPulling: pullMutation.isPending,
        isBuilding: buildMutation.isPending,
        isGeneratingReport: reportMutation.isPending,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
};
