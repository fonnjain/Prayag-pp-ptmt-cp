import React, { createContext, useContext, useState, ReactNode } from "react";
import { Division, Role, PlanLine, CategorySummary, PlanRun, SanityResult, ImportBatch, SourceConfig, LegacyScope, Report } from "./types";
import { MOCK_CATEGORY_SUMMARIES, MOCK_IMPORT_BATCHES, MOCK_LEGACY_SCOPES, MOCK_PLAN_LINES, MOCK_PLAN_RUNS, MOCK_REPORTS, MOCK_SANITY_RESULT, MOCK_SOURCE_CONFIGS } from "./mock-data";

interface DataContextType {
  division: Division;
  setDivision: (d: Division) => void;
  planMonth: string;
  setPlanMonth: (m: string) => void;
  role: Role;
  setRole: (r: Role) => void;
  
  planLines: PlanLine[];
  categorySummaries: CategorySummary[];
  planRuns: PlanRun[];
  sanityResult: SanityResult | null;
  importBatches: ImportBatch[];
  sourceConfigs: SourceConfig[];
  legacyScopes: LegacyScope[];
  reports: Report[];

  buildPlan: (mode: "single"|"minmax"|"overrides", val1?: number, val2?: number, overrides?: Record<string, number>) => void;
  pullData: () => void;
  acknowledgeWarnings: () => void;
  generateReport: () => void;
  updateSourceConfig: (id: string, updates: Partial<SourceConfig>) => void;
  runLegacyImport: (scope: string) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [division, setDivision] = useState<Division>("PTMT");
  const [planMonth, setPlanMonth] = useState<string>("2024-03");
  const [role, setRole] = useState<Role>("planner");

  const [planLines, setPlanLines] = useState<PlanLine[]>(MOCK_PLAN_LINES);
  const [categorySummaries, setCategorySummaries] = useState<CategorySummary[]>(MOCK_CATEGORY_SUMMARIES);
  const [planRuns, setPlanRuns] = useState<PlanRun[]>(MOCK_PLAN_RUNS);
  const [sanityResult, setSanityResult] = useState<SanityResult | null>(MOCK_SANITY_RESULT);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>(MOCK_IMPORT_BATCHES);
  const [sourceConfigs, setSourceConfigs] = useState<SourceConfig[]>(MOCK_SOURCE_CONFIGS);
  const [legacyScopes, setLegacyScopes] = useState<LegacyScope[]>(MOCK_LEGACY_SCOPES);
  const [reports, setReports] = useState<Report[]>(MOCK_REPORTS);

  const buildPlan = (mode: "single"|"minmax"|"overrides", val1?: number, val2?: number, overrides?: Record<string, number>) => {
    const newRun: PlanRun = {
      id: `pr${Date.now()}`,
      division,
      planMonth,
      multiplierMode: mode,
      multiplier: mode === "single" ? val1 : undefined,
      multiplierMin: mode === "minmax" ? val1 : undefined,
      multiplierMax: mode === "minmax" ? val2 : undefined,
      overrides: mode === "overrides" ? overrides : undefined,
      createdAt: new Date().toISOString(),
      createdBy: "Current User",
      lineCount: planLines.length
    };
    setPlanRuns(prev => [newRun, ...prev]);
  };

  const pullData = () => {
    setSanityResult(MOCK_SANITY_RESULT);
  };

  const acknowledgeWarnings = () => {
    if (sanityResult) {
      setSanityResult({ ...sanityResult, verdict: "ok", findings: [] });
    }
  };

  const generateReport = () => {
    const newReport: Report = {
      id: `r${Date.now()}`,
      runId: planRuns[0]?.id || "unknown",
      cadence: "weekly",
      model: "claude-3-opus",
      tier: "deep",
      summary: "Newly generated report summary for the current state.",
      createdAt: new Date().toISOString()
    };
    setReports(prev => [newReport, ...prev]);
  };

  const updateSourceConfig = (id: string, updates: Partial<SourceConfig>) => {
    setSourceConfigs(prev => prev.map(sc => sc.id === id ? { ...sc, ...updates } : sc));
  };

  const runLegacyImport = (scope: string) => {
    setLegacyScopes(prev => prev.map(ls => ls.scope === scope ? { ...ls, status: "done", importedAt: new Date().toISOString() } : ls));
  };

  return (
    <DataContext.Provider value={{
      division, setDivision, planMonth, setPlanMonth, role, setRole,
      planLines, categorySummaries, planRuns, sanityResult, importBatches, sourceConfigs, legacyScopes, reports,
      buildPlan, pullData, acknowledgeWarnings, generateReport, updateSourceConfig, runLegacyImport
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
};
