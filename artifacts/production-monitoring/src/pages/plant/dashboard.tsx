import { useGetPlantBundle, getGetPlantBundleQueryKey, type PlantBundle, useGetPlantWeeklySummary, getGetPlantWeeklySummaryQueryKey, useGetPlantLiveSummary, getGetPlantLiveSummaryQueryKey } from "@workspace/api-client-react";
import type { PlantLiveMachineMetrics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Activity, Download, FileSpreadsheet, CalendarRange, Zap, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { fmtDate } from "@/lib/utils";
import { exportXlsx } from "@/lib/excel";

function downloadPdf(month: string, section: string) {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  window.open(`${base}/api/plant/export/pdf?month=${month}&section=${section}`, "_blank");
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) return "–";
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return `${n.toFixed(1)}%`;
}

function ragColors(band: string | null | undefined) {
  if (band === "green") return { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-600", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" };
  if (band === "amber") return { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-600", badge: "bg-amber-500/15 text-amber-700 border-amber-500/30" };
  return { bg: "bg-red-500/10 border-red-500/30", text: "text-red-600", badge: "bg-red-500/15 text-red-700 border-red-500/30" };
}

export default function PlantDashboard({ month, selectedCategory, setSelectedCategory }: { month: string; selectedCategory?: string | null; setSelectedCategory?: (c: string | null) => void }) {
  const [, navigate] = useLocation();
  const { data, isLoading } = useGetPlantBundle(
    { month },
    { query: { queryKey: getGetPlantBundleQueryKey({ month }) } }
  );
  const { data: weeklyRaw, isLoading: isWeeklyLoading } = useGetPlantWeeklySummary(
    { month },
    { query: { queryKey: getGetPlantWeeklySummaryQueryKey({ month }), staleTime: 0 } as any }
  );

  const { data: liveRaw, isLoading: isLiveLoading, refetch: refetchLive, isRefetching: isLiveRefetching } = useGetPlantLiveSummary(
    { period: month, plant: "PTMT" },
    { query: { queryKey: getGetPlantLiveSummaryQueryKey({ period: month, plant: "PTMT" }), staleTime: 5 * 60 * 1000 } as any }
  );
  const liveData = liveRaw as any;

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading plant data...</div>;
  if (!data) return <div className="text-red-500 p-4">Failed to load plant data.</div>;
  const bundle = data as unknown as PlantBundle;
  const weekly = weeklyRaw as any;

  const { plant, context, categories: allCategories, warnings } = bundle;
  const lifecycleState = (context as any).lifecycleState as string | undefined;
  const workingDaysSource = (context as any).workingDaysSource as string | undefined;
  const unavailableReason = (data as any).unavailableReason as string | undefined;

  const categories = selectedCategory
    ? allCategories.filter((c) => c.category === selectedCategory)
    : allCategories;

  const colors = ragColors(plant.ragBand);
  const criticalWarnings = warnings.filter((w) => w.severity === "critical").length;
  const highWarnings = warnings.filter((w) => w.severity === "high").length;

  const weeklyPlantWeeks: any[] = weekly?.plant?.weeks ?? [];
  const weekCalendar: any[] = weekly?.weekCalendar ?? [];
  const currentWeek: number = weekly?.currentWeek ?? 0;
  const hasWeeklyData = weeklyPlantWeeks.length === 4 && weeklyPlantWeeks.some((w: any) => w.target > 0);

  // Category filter for weekly data
  const weeklyCatRow = selectedCategory && weekly?.categories
    ? (weekly.categories as any[]).find((c: any) => c.category === selectedCategory)
    : null;
  const weeklyRows: any[] = weeklyCatRow
    ? weeklyCatRow.weeks
    : weeklyPlantWeeks;

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto pb-10">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-2">
              <Activity className="h-7 w-7 text-primary" /> Plant Dashboard
            </h1>
            <p className="text-muted-foreground text-sm">
              NOS (pieces) against Production Plan — {month} · {context.elapsed}/{context.workingDays} working days elapsed
              {context.snapshotDate ? ` · snapshot ${fmtDate(context.snapshotDate)}` : ""}
              {workingDaysSource ? ` · ${workingDaysSource} working-day calendar` : ""}
              {selectedCategory ? ` · ${selectedCategory}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lifecycleState && (
              <Badge variant="outline" className={lifecycleState === "closed" ? "border-slate-400 text-slate-700" : lifecycleState === "grace" ? "border-amber-400 text-amber-700" : "border-primary/40 text-primary"}>
                {lifecycleState === "closed" ? "Frozen month" : lifecycleState === "grace" ? "Finalizing" : lifecycleState === "future" ? "Future month" : "Live month"}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => exportXlsx(`plant-dashboard-${month}`, [
              { name: "Plant Summary", rows: [{ Month: month, AttainmentCumPct: bundle.plant?.attainmentCumPct, ProducedToDate: bundle.plant?.producedToDate, TargetMax: bundle.plant?.targetMax, TargetMin: bundle.plant?.targetMin, ProjectedAttainmentPct: bundle.plant?.projectedAttainmentPct, RAG: bundle.plant?.ragBand }] },
              { name: "Categories", rows: categories.map((c: any) => ({ Category: c.category, ProducedToDate: c.producedToDate, TargetMax: c.targetMax, TargetMin: c.targetMin, AttainmentCumPct: c.attainmentCumPct, ProjectedAttainmentPct: c.projectedAttainmentPct, RAG: c.ragBand })) },
            ])}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadPdf(month, "control-board")}>
              <Download className="h-4 w-4 mr-2" /> Export PDF
            </Button>
          </div>
        </div>
      </header>

      {!bundle.dataAvailable && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 text-amber-600 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" /> No production data found for this month. Ensure the PTMT ANUJ Production tab has been updated.
          </CardContent>
        </Card>
      )}

      {unavailableReason && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 text-amber-700 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" /> {unavailableReason}
          </CardContent>
        </Card>
      )}

      {bundle.caveats.length > 0 && (
        <div className="space-y-1">
          {bundle.caveats.map((c, i) => (
            <div key={i} className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-1.5 border border-border/40">{c}</div>
          ))}
        </div>
      )}

      {/* Monthly hero row */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg border ${colors.bg}`}>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Produced to Date</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{fmt(plant.producedToDate)}</div>
          <div className="text-xs text-muted-foreground mt-1">pcs</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Cumulative Attainment</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{pct(plant.attainmentCumPct)}</div>
          <div className="text-xs text-muted-foreground mt-1">vs required cum. ({fmt(plant.requiredCum)} pcs)</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Month Attainment</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{pct(plant.attainmentMonthPct)}</div>
          <div className="text-xs text-muted-foreground mt-1">vs Max PP ({fmt(plant.targetMax)} pcs)</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Projected End</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{pct(plant.projectedAttainmentPct)}</div>
          <div className="text-xs text-muted-foreground mt-1">at {fmt(plant.actualPerDay, 0)} pcs/day</div>
        </div>
      </div>

      {/* === WEEKLY RELEASE PULSE === */}
      {hasWeeklyData && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" />
              Weekly Release Pulse
              {selectedCategory && <span className="text-sm font-normal text-muted-foreground">— {selectedCategory}</span>}
              {currentWeek > 0 && (
                <Badge variant="outline" className="text-xs border-primary/40 text-primary ml-1">
                  W{currentWeek} in progress
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-4 gap-3">
              {weeklyRows.map((wk: any, i: number) => {
                const isCurrent = currentWeek === wk.week;
                const rag = wk.ragBand;
                const wkLabel = weekCalendar[i]?.label ?? `W${wk.week}`;
                const borderCls = isCurrent
                  ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
                  : rag === "green" ? "border-emerald-500/30 bg-emerald-500/5"
                  : rag === "amber" ? "border-amber-500/30 bg-amber-500/5"
                  : rag === "red" ? "border-red-500/30 bg-red-500/5"
                  : "border-border bg-muted/20";
                const textCls = rag === "green" ? "text-emerald-600" : rag === "amber" ? "text-amber-600" : rag === "red" ? "text-red-500" : "text-muted-foreground";
                const futureWeek = wk.attainmentPct === null && wk.target > 0;
                return (
                  <div key={wk.week} className={`rounded-lg border p-3 ${borderCls}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider">{wkLabel}</span>
                      {isCurrent && <Badge variant="outline" className="text-[10px] border-primary/40 text-primary py-0">now</Badge>}
                      {!isCurrent && !futureWeek && rag && (
                        <span className={`text-[10px] font-semibold uppercase ${textCls}`}>{rag}</span>
                      )}
                      {futureWeek && <span className="text-[10px] text-muted-foreground">upcoming</span>}
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Released</span>
                        <span className="font-mono font-medium">{fmt(wk.target)}</span>
                      </div>
                      {wk.carryover > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Carry-in</span>
                          <span className="font-mono text-amber-600 font-medium">+{fmt(wk.carryover)}</span>
                        </div>
                      )}
                      {wk.carryover > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Effective</span>
                          <span className="font-mono font-medium">{fmt(wk.effectiveTarget)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Actual</span>
                        <span className="font-mono font-medium">{fmt(wk.actual)}</span>
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-border/30">
                      {futureWeek ? (
                        <div className="text-center text-xs text-muted-foreground">—</div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Attainment</span>
                          <span className={`text-sm font-bold font-mono ${textCls}`}>{pct(wk.attainmentPct)}</span>
                        </div>
                      )}
                      {wk.gap > 0 && !futureWeek && (
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-xs text-muted-foreground">Gap</span>
                          <span className="text-xs font-mono text-red-500">{fmt(wk.gap)}</span>
                        </div>
                      )}
                    </div>

                    {/* Attainment progress bar */}
                    {!futureWeek && wk.target > 0 && (
                      <div className="mt-2 bg-muted/40 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            rag === "green" ? "bg-emerald-500" : rag === "amber" ? "bg-amber-500" : rag === "red" ? "bg-red-500" : "bg-muted-foreground"
                          }`}
                          style={{ width: `${Math.min(wk.attainmentPct ?? 0, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Required/Day</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(plant.requiredPerDay)}</div><div className="text-xs text-muted-foreground">pcs/working day</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Catch-up/Day</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${plant.catchUpPerDay !== null && plant.catchUpPerDay > plant.requiredPerDay * 1.2 ? "text-red-500" : ""}`}>{fmt(plant.catchUpPerDay)}</div>
            <div className="text-xs text-muted-foreground">{plant.catchUpVsPlanPct !== null ? `${plant.catchUpVsPlanPct.toFixed(0)}% of plan/day` : "–"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Days Ahead/Behind</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold flex items-center gap-1 ${plant.daysAheadBehind !== null && plant.daysAheadBehind < 0 ? "text-red-500" : "text-emerald-600"}`}>
              {plant.daysAheadBehind !== null ? (plant.daysAheadBehind >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />) : null}
              {plant.daysAheadBehind !== null ? `${Math.abs(plant.daysAheadBehind).toFixed(1)}d` : "–"}
            </div>
            <div className="text-xs text-muted-foreground">{plant.daysAheadBehind !== null ? (plant.daysAheadBehind >= 0 ? "ahead" : "behind") : "no data"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Linearity Index</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${plant.linearityIndex !== null && plant.linearityIndex < 0.6 ? "text-amber-500" : "text-emerald-600"}`}>
              {plant.linearityIndex !== null ? plant.linearityIndex.toFixed(2) : "–"}
            </div>
            <div className="text-xs text-muted-foreground">1.0 = perfect linearity</div>
          </CardContent>
        </Card>
      </div>

      {/* Target row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Max PP (Target)</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold">{fmt(plant.targetMax)}</div><div className="text-xs text-muted-foreground">pcs for the month</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Min PP (Floor)</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${plant.projectedMinAttainmentPct !== null && plant.projectedMinAttainmentPct < 100 ? "text-red-500" : ""}`}>{fmt(plant.targetMin)}</div>
            <div className="text-xs text-muted-foreground">Projected: {pct(plant.projectedMinAttainmentPct)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Best Day Output</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold">{fmt(plant.bestDayOutput)}</div><div className="text-xs text-muted-foreground">pcs in best day</div></CardContent>
        </Card>
      </div>

      {/* Category summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Category Attainment Summary
            {selectedCategory && <span className="ml-2 text-sm font-normal text-muted-foreground">— {selectedCategory}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-2 pb-1 border-b border-border/30">
            <div className="w-44" />
            <div className="flex-1" />
            <div className="w-14 text-right text-xs text-muted-foreground font-medium">Cum Att%</div>
            <div className="w-24 text-right text-xs text-muted-foreground font-medium">Produced</div>
            <div className="w-28 text-right text-xs text-muted-foreground font-medium">Projected EOM</div>
            <div className="w-24 text-right text-xs text-muted-foreground font-medium">Target (Max)</div>
          </div>
          <div className="space-y-2.5">
            {categories.map((cat) => {
              const cc = ragColors(cat.ragBand);
              const pct_val = cat.attainmentCumPct ?? 0;
              const projectedPcs = cat.actualPerDay !== null && context.workingDays > 0
                ? Math.round(cat.actualPerDay * context.workingDays)
                : null;
              const projOk = projectedPcs !== null && projectedPcs >= cat.targetMax;
              const projPct = projectedPcs !== null && cat.targetMax > 0
                ? (projectedPcs / cat.targetMax) * 100
                : null;
              return (
                <button
                  key={cat.category}
                  onClick={() => {
                    setSelectedCategory?.(cat.category);
                    navigate("/plant/categories");
                  }}
                  className="w-full flex items-center gap-3 rounded-md px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors cursor-pointer text-left"
                >
                  <div className="w-44 text-sm font-medium truncate">{cat.category}</div>
                  <div className="flex-1 bg-muted/40 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${cat.ragBand === "green" ? "bg-emerald-500" : cat.ragBand === "amber" ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(pct_val, 100)}%` }}
                    />
                  </div>
                  <div className="w-14 text-right text-sm font-mono text-muted-foreground">{pct(cat.attainmentCumPct)}</div>
                  <Badge variant="outline" className={`text-xs w-24 justify-end font-mono ${cc.badge}`}>{fmt(cat.producedToDate)} pcs</Badge>
                  <div className={`w-28 text-right text-sm font-mono font-semibold ${projectedPcs === null ? "text-muted-foreground" : projOk ? "text-emerald-600" : "text-red-500"}`}>
                    {projectedPcs !== null ? (
                      <span title={`${projPct?.toFixed(1)}% of target at current pace`}>
                        {projOk ? "▲" : "▼"} {fmt(projectedPcs)}
                      </span>
                    ) : "–"}
                  </div>
                  <div className="text-xs text-muted-foreground w-24 text-right">{fmt(cat.targetMax)}</div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Warnings banner */}
      {(criticalWarnings > 0 || highWarnings > 0) && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="text-sm">
              {criticalWarnings > 0 && <span className="text-red-600 font-semibold mr-2">{criticalWarnings} critical</span>}
              {highWarnings > 0 && <span className="text-amber-600 font-semibold mr-2">{highWarnings} high</span>}
              <span className="text-muted-foreground">warnings — see Warnings page</span>
            </div>
          </CardContent>
        </Card>
      )}

      {warnings.length === 0 && bundle.dataAvailable && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-4 flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> All KPIs within thresholds — no warnings.
          </CardContent>
        </Card>
      )}

      <LiveMachinePanel
        liveData={liveData}
        isLoading={isLiveLoading}
        isRefetching={isLiveRefetching}
        onRefresh={() => refetchLive()}
      />
    </div>
  );
}

function ragBadge(rating: string) {
  if (rating === "green") return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
  if (rating === "amber") return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-red-500/15 text-red-600 border-red-500/30";
}

function fmtLive(n: number | null | undefined, dec = 1): string {
  if (n === null || n === undefined) return "–";
  return n.toFixed(dec);
}

function LiveMachinePanel({
  liveData,
  isLoading,
  isRefetching,
  onRefresh,
}: {
  liveData: any;
  isLoading: boolean;
  isRefetching: boolean;
  onRefresh: () => void;
}) {
  const machines: [string, PlantLiveMachineMetrics][] = liveData?.by_machine
    ? Object.entries<PlantLiveMachineMetrics>(liveData.by_machine).sort((a, b) => a[0].localeCompare(b[0]))
    : [];
  const period = liveData?.period;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-amber-500" /> Live Machine Performance
            <span className="text-xs font-normal text-muted-foreground ml-1">via prayag-plant.com</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {period && (
              <span className="text-xs text-muted-foreground">
                {period.label} · {period.from} → {period.to}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={isRefetching} className="h-7 gap-1.5 text-xs">
              <RefreshCw className={`h-3 w-3 ${isRefetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-muted-foreground text-sm py-6 text-center">Loading live data…</div>
        ) : machines.length === 0 ? (
          <div className="text-muted-foreground text-sm py-6 text-center">No machine data available for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-xs text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium">Machine</th>
                  <th className="text-center py-2 px-3 font-medium">Headline</th>
                  <th className="text-right py-2 px-3 font-medium">Utilisation</th>
                  <th className="text-right py-2 px-3 font-medium">Output Eff.</th>
                  <th className="text-right py-2 px-3 font-medium">Output (kg)</th>
                  <th className="text-right py-2 px-3 font-medium">Rejection %</th>
                  <th className="text-right py-2 pl-3 font-medium">Run / Ideal hrs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {machines.map(([name, m]) => (
                  <tr key={name} className="hover:bg-muted/20 transition-colors">
                    <td className="py-2 pr-3 font-medium text-foreground">{name}</td>
                    <td className="py-2 px-3 text-center">
                      <Badge variant="outline" className={`text-xs ${ragBadge(m.headline_rating)}`}>
                        {m.headline !== null && m.headline !== undefined ? `${fmtLive(m.headline)}%` : "–"} {m.headline_label}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {m.util_available ? (
                        <span className={m.util_rating === "green" ? "text-emerald-600" : m.util_rating === "amber" ? "text-amber-600" : "text-red-500"}>
                          {fmtLive(m.utilisation)}%
                        </span>
                      ) : <span className="text-muted-foreground">–</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      {m.output_efficiency !== null && m.output_efficiency !== undefined ? `${fmtLive(m.output_efficiency)}%` : "–"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs">
                      {m.good_count !== null && m.good_count !== undefined ? Number(m.good_count).toLocaleString() : "–"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {m.rejection_pct !== null && m.rejection_pct !== undefined ? (
                        <span className={(m.rejection_pct ?? 0) > 5 ? "text-red-500" : (m.rejection_pct ?? 0) > 2 ? "text-amber-600" : "text-emerald-600"}>
                          {fmtLive(m.rejection_pct)}%
                        </span>
                      ) : <span className="text-muted-foreground">–</span>}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-xs text-muted-foreground">
                      {fmtLive(m.actual_hours, 0)} / {fmtLive(m.ideal_hours, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 pt-3 border-t border-border/30 text-xs text-muted-foreground">
              {machines.length} machines · data sourced from prayag-plant.com production sheets
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
