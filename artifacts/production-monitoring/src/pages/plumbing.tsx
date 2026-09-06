import { Fragment, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  Package,
  Unlink,
} from "lucide-react";
import { fmtDate } from "@/lib/utils";
import { MonitoringSourceBanner } from "@/components/monitoring-source-banner";

const CATEGORY_ORDER = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
];

function fmtN(n: number | null | undefined) {
  if (n == null) return "–";
  return Math.round(n).toLocaleString("en-IN");
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return "–";
  return `${n.toFixed(1)}%`;
}

interface WeekRow {
  week: number;
  label: string;
  startDate: string;
  endDate: string;
  release: number;
  mapped: number;
  unmapped: number;
  actual: number;
  wkAttPct: number | null;
  cumRelease: number;
  cumMapped: number;
  cumTotal: number;
  cumAttPct: number | null;
}

interface CategoryRow {
  category: string;
  w1Release: number; w1Actual: number;
  w2Release: number; w2Actual: number;
  w3Release: number; w3Actual: number;
  w4Release: number; w4Actual: number;
  totalRelease: number; totalActual: number;
  notStarted: boolean;
}

interface ItemRow {
  itemCode: string;
  category: string;
  w1Release: number;
  w1Actual: number;
  w2Release: number;
  w2Actual: number;
  w3Release: number;
  w3Actual: number;
  w4Release: number;
  w4Actual: number;
  totalRelease: number;
  totalActual: number;
}

interface MonitoringData {
  month: string;
  sourceMonth?: string | null;
  sourceWarning?: string | null;
  lastDataDate: string | null;
  workingDaysElapsed: number;
  weeks: WeekRow[];
  categories: CategoryRow[];
  items: ItemRow[];
  unmapped: { byWeek: number[]; total: number; topCodes: { code: string; qty: number }[] };
  totalProduced: number;
  totalMapped: number;
  totalUnmapped: number;
  runRatePerDay: number;
}

function ragClass(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 95) return "text-emerald-600 font-semibold";
  if (pct >= 85) return "text-amber-600 font-semibold";
  return "text-red-500 font-semibold";
}

export default function PlumbingMonitoring({ month, selectedCategory }: { month: string; selectedCategory?: string | null }) {
  const [data, setData]       = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/plumbing-monitoring?month=${encodeURIComponent(month)}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json() as MonitoringData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExpandedCategory(null);
    load();
  }, [month]);

  const today = new Date().toISOString().slice(0, 10);
  const elapsedWeeks = data?.weeks.filter((w) => today > w.endDate) ?? [];
  const lastElapsed  = elapsedWeeks[elapsedWeeks.length - 1];
  const cumPlanCompletion = lastElapsed?.cumAttPct ?? data?.weeks.find((w) => w.cumAttPct != null)?.cumAttPct ?? null;

  const w1Release = data?.weeks[0]?.release ?? 0;
  const demonstratedWeeklyCapacity = data ? Math.round(data.runRatePerDay * 7) : 0;

  const orderedCategories = data
    ? CATEGORY_ORDER
      .filter((name) => !selectedCategory || name === selectedCategory)
      .map((name) => data.categories.find((c) => c.category === name)).filter(Boolean) as CategoryRow[]
    : [];

  const notStarted = orderedCategories.filter((c) => c.notStarted);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">

      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plumbing Production Monitoring</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Sheet3 actuals vs weekly release plan · {month}
            {data?.lastDataDate ? ` · data through ${fmtDate(data.lastDataDate)}` : ""}
            {data ? ` · ${data.workingDaysElapsed} working days` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : data ? "Refresh" : "Load"}
        </Button>
      </header>

      {error && (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
          error.includes("unrecognised date formats")
            ? "border-orange-300 bg-orange-50 text-orange-900"
            : "border-red-200 bg-red-50 text-red-700"
        }`}>
          <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${
            error.includes("unrecognised date formats") ? "text-orange-500" : "text-red-500"
          }`} />
          <div className="space-y-1">
            {error.includes("unrecognised date formats") ? (
              <>
                <p className="font-semibold">Sheet3 date format error — production data cannot be read</p>
                <p className="leading-snug">{error}</p>
                <p className="text-xs mt-1 opacity-80">
                  Fix the date in the Plumbing workbook's Sheet3 and re-run sync, or refresh this page once corrected.
                  Supported formats: Sheets serial, ISO (YYYY-MM-DD), "1-Aug-2026", "Aug 1, 2026".
                </p>
              </>
            ) : (
              <p>{error}</p>
            )}
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading Sheet3 actuals…
        </div>
      )}

      {data && (
        <>
          <MonitoringSourceBanner
            warning={data.sourceWarning}
            sourceMonth={data.sourceMonth}
            requestedMonth={month}
          />
          {/* Feasibility banner — W1 release is a priority ranking, not an achievable weekly target */}
          {w1Release > 200_000 && demonstratedWeeklyCapacity > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div>
                <strong>W1 release ({fmtN(w1Release)} pcs) is a priority ranking — not a 7-day achievable target.</strong>
                {" "}Demonstrated capacity is ≈{fmtN(data.runRatePerDay)} pcs/day
                ({fmtN(demonstratedWeeklyCapacity)} pcs/week). Per-week attainment % against a
                {" "}front-loaded release like this is misleading. Use the cumulative column below and the{" "}
                <a href="/" className="underline underline-offset-2 font-medium">Corrective Re-plan</a> for a runnable schedule.
              </div>
            </div>
          )}

          {/* NOT STARTED warning */}
          {notStarted.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
              <div>
                <strong>NOT STARTED:</strong>{" "}
                {notStarted.map((c) => c.category).join(", ")} — zero production recorded as of{" "}
                 {fmtDate(data.lastDataDate) || "today"}. Plan requires{" "}
                {fmtN(notStarted.reduce((s, c) => s + c.totalRelease, 0))} pcs.
              </div>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                    Cum. Attainment
                  </span>
                </div>
                <div className={`text-3xl font-bold tabular-nums ${ragClass(cumPlanCompletion)}`}>
                  {fmtPct(cumPlanCompletion)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {fmtN(lastElapsed?.cumMapped)} of {fmtN(lastElapsed?.cumRelease)} pcs released
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                    Run Rate
                  </span>
                </div>
                <div className="text-3xl font-bold tabular-nums">
                  {fmtN(data.runRatePerDay)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  pcs / working day · {fmtN(data.totalProduced)} total
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <Unlink className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                    Unmapped Codes
                  </span>
                </div>
                <div className={`text-3xl font-bold tabular-nums ${data.totalUnmapped > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                  {fmtN(data.totalUnmapped)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  pcs not in plan master · {data.unmapped.topCodes.length > 0 ? `top: ${data.unmapped.topCodes[0]!.code}` : "none"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Weekly release table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Weekly Release Plan vs Actual</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cum % = mapped production ÷ cumulative release. Per-week % suppressed when release is a priority
                ranking (front-loaded W1), shown only for W2–W4 where release reflects true weekly capacity.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right text-xs text-muted-foreground">
                      <th className="text-left py-2 font-medium w-36">Week</th>
                      <th className="py-2 pr-3 font-medium">Release</th>
                      <th className="py-2 pr-3 font-medium">Produced</th>
                      <th className="py-2 pr-3 font-medium">Unmapped</th>
                      <th className="py-2 pr-3 font-medium border-l border-border/30">Cum Release</th>
                      <th className="py-2 pr-3 font-medium">Cum Mapped</th>
                      <th className="py-2 font-medium">Cum Att %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {data.weeks.map((wk) => {
                      const isPast    = today > wk.endDate;
                      const isCurrent = today >= wk.startDate && today <= wk.endDate;
                      const isFuture  = today < wk.startDate;
                      const showWkPct = !isFuture && wk.release > 0 && wk.release < 500_000 && wk.wkAttPct != null;
                      return (
                        <tr key={wk.week} className={`text-right ${isCurrent ? "bg-primary/5" : ""} ${isFuture ? "opacity-40" : ""}`}>
                          <td className="py-2 text-left font-medium text-xs">
                            {wk.label}
                            {isCurrent && <span className="ml-1.5 text-[10px] text-primary font-normal">▶ now</span>}
                            {isPast    && <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">done</span>}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">{fmtN(wk.release)}</td>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {isFuture ? <span className="text-muted-foreground/30">–</span> : fmtN(wk.actual)}
                          </td>
                          <td className={`py-2 pr-3 font-mono text-xs ${wk.unmapped > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                            {isFuture ? <span className="text-muted-foreground/30">–</span> : wk.unmapped > 0 ? fmtN(wk.unmapped) : "–"}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs border-l border-border/20">{fmtN(wk.cumRelease)}</td>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {isFuture ? <span className="text-muted-foreground/30">–</span> : fmtN(wk.cumMapped)}
                          </td>
                          <td className={`py-2 font-mono text-xs ${ragClass(wk.cumAttPct)}`}>
                            {isFuture
                              ? <span className="text-muted-foreground/30">–</span>
                              : wk.cumAttPct != null
                                ? <>
                                    {fmtPct(wk.cumAttPct)}
                                    {showWkPct && <span className="ml-1.5 text-muted-foreground font-normal">(wk: {fmtPct(wk.wkAttPct)})</span>}
                                  </>
                                : "–"
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Per-category table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Category Actuals — W1 and W2 (Frozen)</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                W1 (1–7 Jul) and W2 (8–14 Jul) are elapsed. These figures will not change.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-4 font-medium w-36">Category</th>
                      <th className="py-2 pr-3 font-medium">W1 Release</th>
                      <th className="py-2 pr-3 font-medium">W1 Actual</th>
                      <th className="py-2 pr-3 font-medium border-l border-border/20">W2 Release</th>
                      <th className="py-2 pr-3 font-medium">W2 Actual</th>
                      <th className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {orderedCategories.map((cat) => {
                      const isSolvent = cat.category.includes("Solvent");
                      const isExpanded = expandedCategory === cat.category;
                      const categoryItems = (data.items ?? []).filter(
                        (item) => item.category === cat.category,
                      );
                      return (
                        <Fragment key={cat.category}>
                          <tr
                            className={`text-right cursor-pointer select-none hover:bg-muted/20 ${
                              cat.notStarted ? "bg-red-50/60" : ""
                            } ${isSolvent ? "opacity-60" : ""}`}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${cat.category} product rows`}
                            onClick={() => setExpandedCategory(isExpanded ? null : cat.category)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setExpandedCategory(isExpanded ? null : cat.category);
                              }
                            }}
                          >
                            <td className="py-2 pr-4 text-left font-medium">
                              <span className="inline-flex items-center gap-1.5">
                                {isExpanded
                                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                {cat.category}
                              </span>
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{fmtN(cat.w1Release)}</td>
                            <td className={`py-2 pr-3 font-mono text-xs ${cat.w1Actual > 0 ? "" : "text-muted-foreground/50"}`}>
                              {cat.w1Actual > 0 ? fmtN(cat.w1Actual) : "0"}
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs text-muted-foreground border-l border-border/20">{fmtN(cat.w2Release)}</td>
                            <td className={`py-2 pr-3 font-mono text-xs ${cat.w2Actual > 0 ? "" : "text-muted-foreground/50"}`}>
                              {cat.w2Actual > 0 ? fmtN(cat.w2Actual) : "0"}
                            </td>
                            <td className="py-2 text-xs">
                              {cat.notStarted ? (
                                <Badge variant="destructive" className="text-[10px] px-1.5">NOT STARTED</Badge>
                              ) : (
                                <span className="text-emerald-600 font-medium">In progress</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-muted/15">
                              <td colSpan={6} className="px-4 py-2">
                                <div className="rounded-md border border-border/50 overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="bg-muted/30">
                                      <tr className="border-b border-border/40 text-right text-muted-foreground">
                                        <th className="text-left py-2 px-3 font-medium">Product Code</th>
                                        <th className="py-2 px-2 font-medium">W1 Release</th>
                                        <th className="py-2 px-2 font-medium">W1 Actual</th>
                                        <th className="py-2 px-2 font-medium">W2 Release</th>
                                        <th className="py-2 px-2 font-medium">W2 Actual</th>
                                        <th className="py-2 px-2 font-medium">Total Release</th>
                                        <th className="py-2 px-3 font-medium">Total Actual</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30">
                                      {categoryItems.map((item) => (
                                        <tr key={`${item.category}-${item.itemCode}`} className="hover:bg-muted/20">
                                          <td className="py-1.5 px-3 text-left font-mono font-medium">{item.itemCode}</td>
                                          <td className="py-1.5 px-2 text-right font-mono">{fmtN(item.w1Release)}</td>
                                          <td className="py-1.5 px-2 text-right font-mono">{fmtN(item.w1Actual)}</td>
                                          <td className="py-1.5 px-2 text-right font-mono">{fmtN(item.w2Release)}</td>
                                          <td className="py-1.5 px-2 text-right font-mono">{fmtN(item.w2Actual)}</td>
                                          <td className="py-1.5 px-2 text-right font-mono font-semibold">{fmtN(item.totalRelease)}</td>
                                          <td className="py-1.5 px-3 text-right font-mono font-semibold">{fmtN(item.totalActual)}</td>
                                        </tr>
                                      ))}
                                      {categoryItems.length === 0 && (
                                        <tr>
                                          <td colSpan={7} className="py-3 px-3 text-center text-muted-foreground">
                                            No product detail available for this category.
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold text-right">
                      <td className="py-2 pr-4 text-left">Plant Total</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                        {fmtN(data.weeks[0]?.release)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{fmtN(data.weeks[0]?.mapped)}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground border-l border-border/20">
                        {fmtN(data.weeks[1]?.release)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{fmtN(data.weeks[1]?.mapped)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Unmapped production */}
          {data.unmapped.total > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Unlink className="h-4 w-4 text-amber-600" />
                  <CardTitle className="text-base">
                    Unmapped Production — {fmtN(data.unmapped.total)} pcs
                  </CardTitle>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Produced on codes not found in the Plumbing plan master. These pieces are counted in "Total Produced"
                  but excluded from plan attainment %. Identify and map these codes to categories to close the gap.
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex gap-6 text-sm mb-4">
                  {data.unmapped.byWeek.map((qty, i) => qty > 0 && (
                    <div key={i} className="text-center">
                      <div className="font-bold text-lg tabular-nums">{fmtN(qty)}</div>
                      <div className="text-xs text-muted-foreground">W{i + 1}</div>
                    </div>
                  ))}
                </div>
                {data.unmapped.topCodes.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-1.5 pr-4 font-medium">#</th>
                          <th className="text-left py-1.5 pr-4 font-medium">Raw Code</th>
                          <th className="text-right py-1.5 font-medium">Qty (pcs)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/10">
                        {data.unmapped.topCodes.slice(0, 15).map((row, idx) => (
                          <tr key={row.code} className="text-right">
                            <td className="py-1.5 pr-4 text-left text-muted-foreground">{idx + 1}</td>
                            <td className="py-1.5 pr-4 text-left font-mono font-medium">{row.code}</td>
                            <td className="py-1.5 font-mono">{fmtN(row.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
