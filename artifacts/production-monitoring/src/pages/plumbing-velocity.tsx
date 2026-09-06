import { useEffect, useState } from "react";
import { useGetPlantLiveSummary, getGetPlantLiveSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, TrendingUp, Activity, AlertTriangle } from "lucide-react";
import { classifyPlantLiveError } from "@/lib/plant-live-error";
import { fmtDate } from "@/lib/utils";
import { MonitoringSourceBanner } from "@/components/monitoring-source-banner";

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return "–";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function isNonCalendarWorkingDay(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === 0;
}

interface PlumbingMonitoringWeek {
  week: number;
  label: string;
  release: number;
  mapped: number;
  unmapped: number;
  actual: number;
  cumRelease: number;
  cumMapped: number;
  cumAttPct: number | null;
}

interface PlumbingMonitoringCategory {
  category: string;
  w1Release: number;
  w1Actual: number;
  w2Release: number;
  w2Actual: number;
  totalRelease: number;
  totalActual: number;
  notStarted?: boolean;
}

interface PlumbingMonitoringData {
  sourceMonth?: string | null;
  sourceWarning?: string | null;
  lastDataDate: string | null;
  workingDaysElapsed: number;
  weeks: PlumbingMonitoringWeek[];
  categories: PlumbingMonitoringCategory[];
  plant?: {
    produced?: number;
    mapped?: number;
    unmapped?: number;
    runRatePerDay?: number;
  };
}

function MonitoringFallback({ data, month }: { data: PlumbingMonitoringData; month: string }) {
  const weeks = data.weeks ?? [];
  const categories = data.categories ?? [];
  const mappedActual = data.plant?.mapped ?? weeks.reduce((sum, week) => sum + week.mapped, 0);
  const totalProduced = data.plant?.produced ?? weeks.reduce((sum, week) => sum + week.actual, 0);
  const totalReleased = weeks.reduce((sum, week) => sum + week.release, 0);
  const attainment = totalReleased > 0 ? (mappedActual / totalReleased) * 100 : null;

  return (
    <div className="space-y-6">
      <Card className="border-blue-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly Monitoring — Sheet3</CardTitle>
          <p className="text-xs text-muted-foreground">
            Plumbing production monitoring remains available for {month}
            {data.lastDataDate ? ` · data through ${fmtDate(data.lastDataDate)}` : ""}
            {data.workingDaysElapsed ? ` · ${data.workingDaysElapsed} working days` : ""}
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total Produced</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{fmt(totalProduced)}</div>
            <div className="text-xs text-muted-foreground">pcs from Sheet3</div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mapped Actual</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{fmt(mappedActual)}</div>
            <div className="text-xs text-muted-foreground">pcs counted against plan</div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Run Rate</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{fmt(data.plant?.runRatePerDay)}</div>
            <div className="text-xs text-muted-foreground">pcs / working day</div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cum. Attainment</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${
              attainment == null ? "text-muted-foreground" : attainment >= 95 ? "text-emerald-600" : attainment >= 85 ? "text-amber-600" : "text-red-500"
            }`}>
              {attainment == null ? "–" : `${attainment.toFixed(1)}%`}
            </div>
            <div className="text-xs text-muted-foreground">mapped actual ÷ released</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weekly Monitoring</CardTitle>
          <p className="text-xs text-muted-foreground">Sheet3 actuals against the Plumbing weekly release plan.</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {weeks.map((week) => (
            <div key={week.week} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide">{week.label}</span>
                {week.cumAttPct != null && (
                  <Badge variant="outline" className={`text-[10px] ${
                    week.cumAttPct >= 95 ? "border-emerald-500/40 text-emerald-600"
                      : week.cumAttPct >= 85 ? "border-amber-500/40 text-amber-600"
                      : "border-red-500/40 text-red-500"
                  }`}>
                    {week.cumAttPct.toFixed(1)}%
                  </Badge>
                )}
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Released</span>
                  <span className="font-mono font-medium">{fmt(week.release)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mapped actual</span>
                  <span className="font-mono font-medium">{fmt(week.mapped)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total produced</span>
                  <span className="font-mono">{fmt(week.actual)}</span>
                </div>
                {week.unmapped > 0 && (
                  <div className="flex justify-between text-amber-600">
                    <span>Unmapped</span>
                    <span className="font-mono">{fmt(week.unmapped)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Category Monitoring</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">W1 Release</th>
                  <th className="px-3 py-2 text-right font-medium">W1 Actual</th>
                  <th className="px-3 py-2 text-right font-medium">W2 Release</th>
                  <th className="px-3 py-2 text-right font-medium">W2 Actual</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {categories.map((category) => (
                  <tr key={category.category} className={category.notStarted ? "bg-red-50/60" : "hover:bg-muted/20"}>
                    <td className="px-4 py-2 font-medium">{category.category}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(category.w1Release)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(category.w1Actual)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(category.w2Release)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(category.w2Actual)}</td>
                    <td className="px-4 py-2 text-right text-xs">
                      {category.notStarted
                        ? <Badge variant="destructive" className="text-[10px]">NOT STARTED</Badge>
                        : <span className="font-medium text-emerald-600">In progress</span>}
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No category monitoring data available for {month}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PlumbingVelocity({ month }: { month: string }) {
  const { data: raw, isLoading, isError, error, isRefetching, refetch } = useGetPlantLiveSummary(
    { period: month, plant: "PIPE" },
    { query: { queryKey: getGetPlantLiveSummaryQueryKey({ period: month, plant: "PIPE" }), staleTime: 5 * 60 * 1000 } as any }
  );
  const [monitoring, setMonitoring] = useState<PlumbingMonitoringData | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(true);
  const [monitoringError, setMonitoringError] = useState<{
    status: number;
    detail: string;
    source: string;
    tabs: string[];
  } | null>(null);

  async function loadMonitoring() {
    setMonitoringLoading(true);
    setMonitoringError(null);
    try {
      const response = await fetch(`/api/monitoring/dashboard?month=${encodeURIComponent(month)}&segment=Plumbing`);
      if (!response.ok) {
        let body: any = null;
        try { body = await response.json(); } catch { /* retain the HTTP status */ }
        throw {
          status: response.status,
          detail: body?.detail ?? body?.error ?? `HTTP ${response.status}`,
          source: body?.workbookId ? `Plumbing workbook ${body.workbookId}` : "Plumbing monitoring workbook",
          tabs: Array.isArray(body?.skippedTabs) ? body.skippedTabs : [],
        };
      }
      setMonitoring(await response.json() as PlumbingMonitoringData);
    } catch (err) {
      if (err && typeof err === "object" && "status" in err) {
        const failure = err as { status: number; detail: string; source: string; tabs: string[] };
        setMonitoringError(failure);
      } else {
        setMonitoringError({
          status: 0,
          detail: err instanceof Error ? err.message : "Failed to load monthly monitoring data",
          source: "Plumbing monitoring workbook",
          tabs: [],
        });
      }
    } finally {
      setMonitoringLoading(false);
    }
  }

  useEffect(() => {
    void loadMonitoring();
  }, [month]);

  const d = raw as any;
  const overall = d?.overall;
  const byDate: Record<string, any> = d?.by_date ?? {};

  const days = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  let cumGood = 0;
  let cumIdeal = 0;
  const rows = days.map((day) => {
    cumGood  += day.good_count  ?? 0;
    cumIdeal += day.ideal_output ?? 0;
    const pace = day.actual_hours > 0 ? (day.good_count / day.actual_hours) : null;
    return { ...day, cumGood, cumIdeal, pace, isNonCalendarWorkingDay: isNonCalendarWorkingDay(day.date) };
  });

  const activeDays = days.filter((d) => (d.good_count ?? 0) > 0).length;
  const avgPerDay  = activeDays > 0 ? Math.round((overall?.good_count ?? 0) / activeDays) : 0;
  const totalGood  = overall?.good_count ?? 0;
  const totalIdeal = overall?.ideal_output ?? 0;

  const refreshAll = () => {
    void refetch();
    void loadMonitoring();
  };

  if (isLoading && monitoringLoading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-muted/40 rounded-xl" />
      <div className="h-64 bg-muted/40 rounded-xl" />
    </div>
  );

  if (isError) {
    const copy = classifyPlantLiveError({
      message: (error as any)?.message ?? String(error),
      data: (error as any)?.data,
    }, month);

    return (
      <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
          <TrendingUp className="h-6 w-6 text-primary" /> PIPE Plant Velocity
        </h1>
        <div className="text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-4 space-y-1">
          <p className="font-semibold text-red-600">{copy.heading}</p>
          <p className="text-red-600/80">{copy.detail}</p>
          <p className="text-red-600/60 text-xs pt-1">{copy.hint}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-1">
            <TrendingUp className="h-6 w-6 text-primary" /> PIPE Plant Velocity
          </h1>
          <p className="text-muted-foreground text-sm">
            Daily output pace · {month} · {activeDays} active days
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refreshAll} disabled={isRefetching || monitoringLoading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching || monitoringLoading ? "animate-spin" : ""}`} />
          {isRefetching || monitoringLoading ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <MonitoringSourceBanner
        warning={monitoring?.sourceWarning}
        sourceMonth={monitoring?.sourceMonth}
        requestedMonth={month}
      />

      {isError && (() => {
        const { heading, detail, hint } = classifyPlantLiveError(
          { message: (error as any)?.message ?? String(error), data: (error as any)?.data },
          month,
        );
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div className="space-y-1">
                <p className="font-semibold text-red-600">{heading}</p>
                <p className="text-red-600/80">{detail}</p>
                <p className="pt-1 text-xs text-red-600/60">{hint}</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={refreshAll} disabled={isRefetching || monitoringLoading} className="gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching || monitoringLoading ? "animate-spin" : ""}`} />
              {isRefetching || monitoringLoading ? "Retrying…" : "Retry live data"}
            </Button>
          </div>
        );
      })()}

      {monitoringError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Monthly monitoring source unavailable</p>
              <p>{monitoringError.source} · status {monitoringError.status || "unknown"}</p>
              {monitoringError.tabs.length > 0 && <p>Affected tab(s): {monitoringError.tabs.join(", ")}</p>}
              <p>{monitoringError.detail} Retry after the source workbook is available.</p>
            </div>
        </div>
      )}

      {isError && monitoring && <MonitoringFallback data={monitoring} month={month} />}

      {!isError && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" /> Total Output
            </div>
            <div className="text-3xl font-bold">{fmt(totalGood)}</div>
            <div className="text-xs text-muted-foreground mt-1">kg good · month to date</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Avg / Active Day</div>
            <div className="text-3xl font-bold">{fmt(avgPerDay)}</div>
            <div className="text-xs text-muted-foreground mt-1">kg/day · {activeDays} days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Ideal Output</div>
            <div className="text-3xl font-bold">{fmt(totalIdeal)}</div>
            <div className="text-xs text-muted-foreground mt-1">kg target · {overall?.ideal_hours ?? "–"}h ideal</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Output Efficiency</div>
            <div className={`text-3xl font-bold ${overall?.eff_rating === "green" ? "text-emerald-600" : overall?.eff_rating === "amber" ? "text-amber-600" : "text-red-500"}`}>
              {overall?.output_efficiency != null ? `${overall.output_efficiency.toFixed(1)}%` : "–"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{overall?.headline_label ?? "–"}</div>
          </CardContent>
        </Card>
      </div>
      )}

      {!isError && <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily Output Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-y border-border/50">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Date</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Good (kg)</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Reject (kg)</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Rej %</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Run hrs</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Util % (run ÷ ideal)</th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Cum Good (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {rows.map((row) => (
                  <tr key={row.date} className="hover:bg-muted/20">
                    <td className="py-2 px-4 font-medium">
                      <span>{fmtDate(row.date)}</span>
                      {row.isNonCalendarWorkingDay && (
                        <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-700">
                          Sun — worked
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{fmt(row.good_count)}</td>
                    <td className="py-2 px-3 text-right font-mono text-red-500/80">{row.reject_count > 0 ? fmt(row.reject_count) : "–"}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {row.rejection_pct > 0
                        ? <span className={row.rejection_pct > 10 ? "text-red-500 font-semibold" : row.rejection_pct > 5 ? "text-amber-600" : "text-emerald-600"}>{row.rejection_pct.toFixed(1)}%</span>
                        : "–"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-muted-foreground">{fmt(row.actual_hours)}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {row.utilisation != null
                        ? <span className={row.utilisation >= 80 ? "text-emerald-600" : row.utilisation >= 60 ? "text-amber-600" : "text-red-500"}>{row.utilisation.toFixed(1)}%</span>
                        : "–"}
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-semibold">{fmt(row.cumGood)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No daily data available for {month}</td></tr>
                )}
              </tbody>
              {overall && (
                <tfoot className="bg-muted/30 border-t border-border/50 font-semibold">
                  <tr>
                    <td className="py-2.5 px-4 text-muted-foreground text-xs uppercase">Total</td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmt(overall.good_count)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-500/80">{fmt(overall.reject_count)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{overall.rejection_pct?.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">{fmt(overall.actual_hours)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{overall.utilisation?.toFixed(1)}%</td>
                    <td className="py-2.5 px-4 text-right font-mono">{fmt(overall.good_count)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>}

      {!isError && <p className="text-xs text-muted-foreground text-right">
        Live data from prayag-plant.com · PIPE plant only (fitting/solvent excluded) · cached 5 min
      </p>}
    </div>
  );
}
