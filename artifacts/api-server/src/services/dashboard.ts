import { getLatestRun, getLines } from "./plan";
import { getLatestSanity } from "./sanity";

export interface CategorySummary {
  category: string;
  targetMin: number;
  targetMax: number;
  perDayTarget: number;
  produced: number;
  achievementPct: number;
  rag: "green" | "amber" | "red";
}

export interface DashboardData {
  categorySummaries: CategorySummary[];
  urgentCount: number;
  activeCategories: number;
  dataHealth: "ok" | "warn" | "block" | "none";
  runId: number | null;
  runVersion: number | null;
  workingDays: number | null;
}

function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((x + Number.EPSILON) * f) / f;
}

function ragFor(achievementPct: number): "green" | "amber" | "red" {
  if (achievementPct >= 90) return "green";
  if (achievementPct >= 60) return "amber";
  return "red";
}

export async function getDashboard(
  division: string,
  planMonth: string,
): Promise<DashboardData> {
  const sanity = await getLatestSanity(division, planMonth);
  const dataHealth: DashboardData["dataHealth"] = sanity
    ? sanity.verdict === "block"
      ? "block"
      : sanity.verdict === "warn"
        ? "warn"
        : "ok"
    : "none";

  const run = await getLatestRun(division, planMonth);
  if (!run) {
    return {
      categorySummaries: [],
      urgentCount: 0,
      activeCategories: 0,
      dataHealth,
      runId: null,
      runVersion: null,
      workingDays: null,
    };
  }

  const lines = await getLines(run.id);
  const workingDays = run.workingDays ?? 26;

  const agg = new Map<
    string,
    { min: number; max: number; produced: number }
  >();
  for (const l of lines) {
    const cat = l.category || "Uncategorized";
    let a = agg.get(cat);
    if (!a) {
      a = { min: 0, max: 0, produced: 0 };
      agg.set(cat, a);
    }
    a.min += l.minRequired ?? l.productionRequired;
    a.max += l.maxRequired ?? l.productionRequired;
    a.produced += l.produced;
  }

  const categorySummaries: CategorySummary[] = [...agg.entries()]
    .map(([category, a]) => {
      const achievementPct = a.max > 0 ? (a.produced / a.max) * 100 : 100;
      return {
        category,
        targetMin: round(a.min),
        targetMax: round(a.max),
        perDayTarget: round(workingDays > 0 ? a.max / workingDays : 0),
        produced: round(a.produced),
        achievementPct: round(achievementPct),
        rag: ragFor(achievementPct),
      };
    })
    .sort((x, y) => y.targetMax - x.targetMax);

  const urgentCount = lines.filter((l) => l.urgent).length;
  const activeCategories = categorySummaries.filter((c) => c.targetMax > 0).length;

  return {
    categorySummaries,
    urgentCount,
    activeCategories,
    dataHealth,
    runId: run.id,
    runVersion: run.version,
    workingDays,
  };
}
