import * as XLSX from "xlsx";
import { getRun, getLines } from "./plan";
import { getDashboard } from "./dashboard";
import { getLatestSanity } from "./sanity";

// Build an XLSX workbook for a plan run: Plan grid, category Summary, and the
// latest Validation findings for the run's scope.
export async function buildWorkbook(runId: number): Promise<Buffer | null> {
  const run = await getRun(runId);
  if (!run) return null;
  const lines = await getLines(runId);
  const dashboard = await getDashboard(run.division, run.planMonth);
  const sanity = await getLatestSanity(run.division, run.planMonth);

  const wb = XLSX.utils.book_new();

  const planHeader = [
    "Item Code",
    "Colour",
    "Model",
    "Category",
    "Report",
    "Run Rate",
    "Last 3 Sale",
    "Last Month Sale",
    "Avg Annual",
    "Opening Stock",
    "Pending Last",
    "Pending Current",
    "Multiplier",
    "Buffer Target",
    "Buffer Min",
    "Buffer Max",
    "Min Required",
    "Max Required",
    "Production Required",
    "Order As On",
    "Produced",
    "Left",
    "Coverage (mo)",
    "Urgent",
    "Value Amount",
  ];
  const planRows = lines.map((l) => [
    l.itemCode,
    l.colour,
    l.model,
    l.category,
    l.report,
    l.runRate,
    l.last3Sale,
    l.lastMonthSale,
    l.avgSaleAnnual,
    l.openingStock,
    l.pendingLast,
    l.pendingCurrent,
    l.multiplier,
    l.bufferTarget,
    l.bufferTargetMin,
    l.bufferTargetMax,
    l.minRequired,
    l.maxRequired,
    l.productionRequired,
    l.orderAsOn,
    l.produced,
    l.left,
    l.coverage,
    l.urgent ? "YES" : "",
    l.valueAmount,
  ]);
  const planSheet = XLSX.utils.aoa_to_sheet([planHeader, ...planRows]);
  XLSX.utils.book_append_sheet(wb, planSheet, "Plan");

  const sumHeader = [
    "Category",
    "Target Min",
    "Target Max",
    "Per-Day Target",
    "Produced",
    "Achievement %",
    "RAG",
  ];
  const sumRows = dashboard.categorySummaries.map((c) => [
    c.category,
    c.targetMin,
    c.targetMax,
    c.perDayTarget,
    c.produced,
    c.achievementPct,
    c.rag.toUpperCase(),
  ]);
  const sumSheet = XLSX.utils.aoa_to_sheet([
    [`Division`, run.division],
    [`Plan Month`, run.planMonth],
    [`Version`, run.version],
    [`Multiplier Mode`, run.multiplierMode ?? ""],
    [
      `Multiplier`,
      run.multiplierMode === "minmax"
        ? `${run.multiplierMin ?? ""} – ${run.multiplierMax ?? ""}`
        : (run.multiplier ?? ""),
    ],
    [`Working Days`, run.workingDays ?? ""],
    [],
    sumHeader,
    ...sumRows,
  ]);
  XLSX.utils.book_append_sheet(wb, sumSheet, "Summary");

  const valHeader = ["Severity", "Type", "Source", "Message", "Evidence", "Suggested Fix"];
  const valRows = (sanity?.findings ?? []).map((f) => [
    f.severity,
    f.type,
    f.source,
    f.message,
    f.evidence,
    f.suggestedFix,
  ]);
  const valSheet = XLSX.utils.aoa_to_sheet([
    [`Sanity Verdict`, sanity?.verdict ?? "none"],
    [`Summary`, sanity?.summary ?? ""],
    [],
    valHeader,
    ...valRows,
  ]);
  XLSX.utils.book_append_sheet(wb, valSheet, "Validation");

  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}
